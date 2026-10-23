// Lwedflix desktop shell.
//
// The app is a full Next.js server (API routes, server components, a
// server-only TMDB token), so it can't be loaded from files. Instead the
// standalone server staged by scripts/build-server.mjs runs in a utility
// process bound to 127.0.0.1, and the window loads it once the intro has
// played.

const { app, BrowserWindow, Menu, dialog, ipcMain, net: electronNet, screen, session, shell, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const { installAdBlock } = require('./adblock');
const { cleanState, cleanCommand } = require('./playerProtocol');
const { createMacUpdater } = require('./macUpdater');
const { setupOdm } = require('./odm');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Fixed so the origin stays the same across launches: the Supabase session
// lives in localStorage, which is keyed by origin, so a new port would sign
// the user out every time. A random port is only the fallback when this one
// is taken.
const PREFERRED_PORT = 47231;

// How long to keep warming the home page before showing it regardless.
const WARMUP_TIMEOUT_MS = 8000;
const SERVER_START_TIMEOUT_MS = 30000;

// Permissions the app's own pages may use. Embedded players get fullscreen
// and nothing else — no notifications, geolocation, external protocols, etc.
const APP_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

// lwedflix://<page> opens that page, e.g. lwedflix://watch/K7M2QX or
// lwedflix://movie/550 — the links the app shares (src/lib/shareLink.ts,
// which keeps the same allowlist; keep the two in step).
const PROTOCOL = 'lwedflix';
const DEEP_LINK_PATH = /^\/(?:(?:movie|tv|person)\/\d{1,10}|(?:watch|invite|p|u|c)\/[\w.-]{1,64})$/;
const DEEP_LINK_QUERY = /^(\?[\w=&-]{0,100})?$/;

// Runs in the player frame's own world (where the provider's code lives), as
// a user gesture — picture-in-picture refuses to start without one. The
// preload tags the stream's <video> so this finds the right one.
const PICTURE_IN_PICTURE = `(() => {
  const video = document.querySelector('video[data-lwedflix-stream]');
  if (!video) return 'no-video';
  if (document.pictureInPictureElement) return document.exitPictureInPicture().then(() => 'exited');
  video.disablePictureInPicture = false;
  return video.requestPictureInPicture().then(() => 'entered', (err) => 'failed: ' + err.message);
})()`;

const isMac = process.platform === 'darwin';

let mainWindow = null;
let serverProcess = null;
let appOrigin = null;
let appLoaded = false;
let quitting = false;
// Where to land once the app is up, when a link arrived during the intro.
let pendingPath = null;
// The embedded frame whose <video> the player bridge last reported.
let playerFrame = null;

// Players reached through the app shouldn't see an Electron user agent; some
// treat it as a bot. The app's own token (package name) goes too.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|lwedflix)\/\S+/gi, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows and Linux deliver links as a new launch's arguments, macOS as
  // an event (which can fire before the app is ready).
  app.on('second-instance', (_event, argv) => {
    focusWindow();
    openDeepLink(argv.find((arg) => arg.startsWith(`${PROTOCOL}:`)));
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    focusWindow();
    openDeepLink(url);
  });
  openDeepLink(process.argv.find((arg) => arg.startsWith(`${PROTOCOL}:`)));
  app.whenReady().then(start);
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function isAppUrl(url) {
  return appOrigin !== null && (url === appOrigin || url.startsWith(`${appOrigin}/`));
}

function isIntroFrame(frame) {
  return Boolean(frame && frame.url.startsWith('file:'));
}

function isFromAppPage(event) {
  return event.senderFrame === event.sender.mainFrame && isAppUrl(event.senderFrame.url);
}

// lwedflix://movie/550 → /movie/550. Anything off the allowlist is ignored.
function pathFromDeepLink(url) {
  try {
    const { protocol, host, pathname, search } = new URL(url);
    // lwedflix://movie/550 parses with "movie" as the host.
    const path = `/${host}${pathname}`.replace(/\/+$/, '');
    if (protocol === `${PROTOCOL}:` && DEEP_LINK_PATH.test(path) && DEEP_LINK_QUERY.test(search)) {
      return path + search;
    }
  } catch {
    // Not a URL.
  }
  return null;
}

function openDeepLink(url) {
  const target = url && pathFromDeepLink(url);
  if (target) openAppPath(target);
}

function openAppPath(target) {
  if (appLoaded && mainWindow) mainWindow.loadURL(`${appOrigin}${target}`);
  else pendingPath = target;
}

async function start() {
  if (process.platform === 'win32') app.setAppUserModelId('app.lwedflix.desktop');
  // The macOS build declares the scheme in Info.plist; Windows installers
  // don't register it, so the app does on every launch. Skipped in
  // development, where it would register the bare Electron binary.
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  Menu.setApplicationMenu(buildMenu());
  lockDownSession();

  const serverReady = launchServer();
  // Handled before a window exists, so the intro can never ask too early.
  ipcMain.handle('app:when-ready', (event) => {
    if (!isIntroFrame(event.senderFrame)) throw new Error('not the intro');
    return serverReady.then(() => undefined);
  });
  ipcMain.on('intro:finished', (event) => {
    if (isIntroFrame(event.senderFrame)) serverReady.then(showApp, () => {});
  });
  ipcMain.on('open-external', (event, url) => {
    if (!isFromAppPage(event)) return;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Player bridge: the embedded player's frame reports its <video> (see
  // playerBridge() in preload.js), the app page sends commands back. Only
  // the frame that reported most recently is controlled.
  ipcMain.on('player:state', (event, state) => {
    const frame = event.senderFrame;
    if (!mainWindow || event.sender !== mainWindow.webContents || !frame || frame === event.sender.mainFrame) return;
    if (state?.event === 'gone') {
      if (frame !== playerFrame) return;
      playerFrame = null;
      mainWindow.webContents.send('player:state', null);
      return;
    }
    const clean = cleanState(state);
    if (!clean) return;
    playerFrame = frame;
    mainWindow.webContents.send('player:state', clean);
  });
  ipcMain.on('player:command', (event, raw) => {
    if (!isFromAppPage(event) || !playerFrame || playerFrame.isDestroyed() || playerFrame.detached) return;
    const command = cleanCommand(raw);
    if (!command) return;
    if (command.action === 'pip') playerFrame.executeJavaScript(PICTURE_IN_PICTURE, true).catch(() => {});
    else playerFrame.send('player:command', command);
  });

  // From inside the embedded players: a server that can't play the title,
  // and shortcut keys pressed while focus is in the player.
  const fromPlayerFrame = (event) =>
    mainWindow && event.sender === mainWindow.webContents && event.senderFrame && event.senderFrame !== event.sender.mainFrame;
  ipcMain.on('player:problem', (event, problem) => {
    if (!fromPlayerFrame(event)) return;
    const reason = problem?.reason === 'error' ? 'error' : 'unavailable';
    mainWindow.webContents.send('player:problem', { reason });
  });
  ipcMain.on('player:key', (event, key) => {
    if (fromPlayerFrame(event) && key === 'f') mainWindow.webContents.send('player:shortcut', { key });
  });

  createWindow();

  // Watches what the embedded players play and forwards a chosen stream to ODM.
  setupOdm({
    ses: session.defaultSession,
    ipcMain,
    isFromAppPage,
    webContents: mainWindow.webContents,
    openExternal: (url) => shell.openExternal(url),
  });
  setUpUpdates();

  serverReady.then(
    () => {
      // Safety net: if the intro page breaks and never reports back, don't
      // leave the user staring at it.
      setTimeout(showApp, 12000);
    },
    (err) => {
      dialog.showErrorBox(
        'Lwedflix could not start',
        `${err.message}\n\nThe server log is at:\n${path.join(app.getPath('logs'), 'server.log')}`
      );
      app.quit();
    }
  );
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1440, Math.round(width * 0.9)),
    height: Math.min(900, Math.round(height * 0.9)),
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Lwedflix',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    // The app draws its own title bar (src/components/app): macOS keeps its
    // traffic lights, inset into the sidebar's top strip; Windows keeps
    // native buttons over the right end of the 56px toolbar.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 20 } }
      : { titleBarOverlay: { color: '#0a0a0a', symbolColor: '#d4d4d4', height: 56 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Despite the name, this only runs the (sandboxed) preload in
      // subframes too — that's how the player bridge reaches the video.
      nodeIntegrationInSubFrames: true,
      spellcheck: false,
    },
  });

  const contents = mainWindow.webContents;

  // Keep the product name in the title bar rather than each page's <title>.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Embedded players love popups and top-frame redirects to ad pages. The
  // app itself never opens windows (external links go through the preload),
  // and never navigates the main frame off its own origin.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => {
    if (!isAppUrl(event.url)) event.preventDefault();
  });

  // The intro is the first history entry; Back must not return to it.
  contents.on('did-finish-load', () => {
    if (isAppUrl(contents.getURL())) contents.navigationHistory.clear();
  });
  contents.on('did-navigate', () => {
    playerFrame = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'intro', 'intro.html'));
}

function showApp() {
  if (appLoaded || !mainWindow || !appOrigin) return;
  appLoaded = true;
  mainWindow.loadURL(`${appOrigin}${pendingPath ?? '/'}`);
  pendingPath = null;
}

function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permission === 'fullscreen' || (isAppUrl(details.requestingUrl) && APP_PERMISSIONS.has(permission)));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return permission === 'fullscreen' || (requestingOrigin === appOrigin && APP_PERMISSIONS.has(permission));
  });
  // The players' ads: trackers, popunder scripts and the "download"
  // prompts they throw up.
  installAdBlock(ses);
}

async function launchServer() {
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', 'server-bundle');
  const entry = path.join(serverDir, 'server.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`The bundled server is missing (${entry}). Run \`npm run build:server\` first.`);
  }

  const port = await pickPort();
  const origin = `http://127.0.0.1:${port}`;

  fs.mkdirSync(app.getPath('logs'), { recursive: true });
  const log = fs.createWriteStream(path.join(app.getPath('logs'), 'server.log'));

  serverProcess = utilityProcess.fork(entry, [], {
    cwd: serverDir,
    serviceName: 'Lwedflix Server',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      // Loopback only — never expose the server (or its /api/proxy route)
      // to the local network.
      HOSTNAME: '127.0.0.1',
    },
  });
  serverProcess.stdout.pipe(log);
  serverProcess.stderr.pipe(log);

  let exitCode = null;
  serverProcess.once('exit', (code) => {
    exitCode = code;
    serverProcess = null;
    // After startup, losing the server leaves a window that can't load
    // anything — say so instead of failing silently page by page.
    if (appOrigin && !quitting) {
      dialog.showErrorBox(
        'Lwedflix stopped unexpectedly',
        `The local server exited (code ${code}).\n\nThe server log is at:\n${path.join(app.getPath('logs'), 'server.log')}`
      );
      app.quit();
    }
  });

  // A static file proves the server is accepting requests without paying
  // for a render.
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  for (;;) {
    if (exitCode !== null) throw new Error(`The local server exited during startup (code ${exitCode}).`);
    if (Date.now() > deadline) throw new Error('The local server did not start in time.');
    try {
      const res = await fetch(`${origin}/icon.png`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  appOrigin = origin;

  // Render the home page while the intro is still playing, so the in-memory
  // cache serves it instantly once the window switches over. Best effort:
  // offline or slow TMDB just means the first load renders live.
  await fetch(`${origin}/`, { signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS) }).catch(() => {});
}

function pickPort() {
  const listenOn = (port) =>
    new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => {
        const { port: bound } = probe.address();
        probe.close(() => resolve(bound));
      });
    });
  return listenOn(PREFERRED_PORT).catch(() => listenOn(0));
}

function navigate(direction) {
  const history = mainWindow?.webContents.navigationHistory;
  if (!history) return;
  if (direction === 'back' && history.canGoBack()) history.goBack();
  if (direction === 'forward' && history.canGoForward()) history.goForward();
}

// ---- Updates -------------------------------------------------------------
// New versions are GitHub releases (see README). Every platform downloads
// them in the background and installs on restart: Windows and Linux through
// electron-updater, macOS through macUpdater.js — electron-updater only
// installs there when the new version is signed with the same Apple
// Developer ID, which ad-hoc builds don't have. A Mac copy that can't
// replace itself (still on the disk image, say) is offered the download.

const CAN_INSTALL_UPDATES = !isMac;
const FIRST_UPDATE_CHECK_MS = 15_000; // after the intro, not over it
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/mohamedelwed/lwedflix/releases';

let updatesReady = false;
let manualUpdateCheck = false;
// Each version is offered once per session, unless asked for from the menu.
const offeredVersions = new Set();
let macUpdater = null;

function setUpUpdates() {
  // An unpackaged run has no update feed (app-update.yml) to read.
  if (!app.isPackaged) return;

  const log = fs.createWriteStream(path.join(app.getPath('logs'), 'updates.log'), { flags: 'a' });
  const write = (level) => (...args) => log.write(`${new Date().toISOString()} ${level} ${args.join(' ')}\n`);
  autoUpdater.logger = { info: write('info'), warn: write('warn'), error: write('error'), debug: () => {} };
  autoUpdater.autoDownload = CAN_INSTALL_UPDATES;
  autoUpdater.autoInstallOnAppQuit = CAN_INSTALL_UPDATES;

  if (isMac) {
    macUpdater = createMacUpdater({
      fetch: (url) => electronNet.fetch(url),
      log: write('info'),
      workDir: path.join(app.getPath('userData'), 'updates'),
      releasesUrl: RELEASES_URL,
      // Flags this run was started with (a test's --user-data-dir, say)
      // carry over to the relaunch; links don't.
      args: process.argv.slice(1).filter((arg) => arg.startsWith('--')),
    });
    if (macUpdater.blocked) write('info')(`Can't update in place: ${macUpdater.blocked}`);
    reportLastMacInstall(macUpdater.takeLastResult(), write);
    // "Later": the update goes in as the app quits.
    app.on('will-quit', () => macUpdater.install(false));
  }

  autoUpdater.on('update-available', (info) => {
    if (macUpdater && !macUpdater.blocked) {
      if (manualUpdateCheck) showUpdateMessage(`Downloading Lwedflix ${info.version}`, "You'll be asked to restart when it's ready.");
      macUpdater.prepare(info).then(offerRestart, (err) => {
        write('error')(`Update ${info.version} failed: ${err.message}`);
        offerDownload(info);
      });
    } else if (!CAN_INSTALL_UPDATES) {
      offerDownload(info);
    } else if (manualUpdateCheck) {
      showUpdateMessage(`Downloading Lwedflix ${info.version}`, "You'll be asked to restart when it's ready.");
    }
    manualUpdateCheck = false;
  });
  autoUpdater.on('update-downloaded', (info) => offerRestart(info.version));
  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) showUpdateMessage("You're up to date", `Lwedflix ${app.getVersion()} is the latest version.`);
    manualUpdateCheck = false;
  });
  autoUpdater.on('error', (err) => {
    // Being offline is the usual cause; only worth a word if someone asked.
    if (manualUpdateCheck) showUpdateMessage("Couldn't check for updates", err.message);
    manualUpdateCheck = false;
  });

  updatesReady = true;
  setTimeout(() => checkForUpdates(false), FIRST_UPDATE_CHECK_MS);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_EVERY_MS);
}

function checkForUpdates(manual) {
  if (!updatesReady) {
    if (manual) showUpdateMessage('Updates unavailable', 'Updates only work in the installed app.');
    return;
  }
  manualUpdateCheck = manual;
  if (manual) offeredVersions.clear();
  // Failures arrive through the 'error' event.
  autoUpdater.checkForUpdates().catch(() => {});
}

function showMessageBox(options) {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

function showUpdateMessage(message, detail) {
  showMessageBox({ type: 'info', buttons: ['OK'], message, detail });
}

async function offerRestart(version) {
  if (offeredVersions.has(version)) return;
  offeredVersions.add(version);
  const { response } = await showMessageBox({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Lwedflix ${version} is ready`,
    detail: 'Restart to finish updating. Choose Later and it installs the next time you quit.',
  });
  if (response !== 0) return;
  if (macUpdater?.readyVersion === version) {
    macUpdater.install(true);
    app.quit();
  } else {
    autoUpdater.quitAndInstall();
  }
}

// Whether the swap after the last quit worked (it runs once the app is gone,
// so this launch is the first to know).
function reportLastMacInstall(result, write) {
  if (!result) return;
  if (result === 'ok') {
    write('info')(`Updated to ${app.getVersion()}`);
    return;
  }
  write('error')(`Last update didn't install: ${result}`);
  app.whenReady().then(() =>
    showUpdateMessage(
      "Lwedflix couldn't finish updating",
      'It will try again with the next update. You can also download the latest version from the Lwedflix releases page.'
    )
  );
}

async function offerDownload({ version, files = [] }) {
  if (offeredVersions.has(version)) return;
  offeredVersions.add(version);
  const { response } = await showMessageBox({
    type: 'info',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Lwedflix ${version} is available`,
    detail:
      `You have ${app.getVersion()}. Open the download and drag Lwedflix into Applications to replace this version.` +
      (macUpdater?.blocked ? ` (Lwedflix can't update itself here because ${macUpdater.blocked}.)` : ''),
  });
  if (response !== 0) return;
  // Straight to this Mac's DMG (the Apple Silicon one is named -arm64) when
  // the release lists it; otherwise the release page.
  const dmg = files.find(
    (file) => file.url.endsWith('.dmg') && file.url.includes('-arm64') === (process.arch === 'arm64')
  );
  shell.openExternal(dmg ? `${RELEASES_URL}/download/v${version}/${dmg.url}` : `${RELEASES_URL}/tag/v${version}`);
}

function buildMenu() {
  const checkForUpdatesItem = { label: 'Check for Updates…', click: () => checkForUpdates(true) };
  return Menu.buildFromTemplate([
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Join Watch Party…', accelerator: 'CmdOrCtrl+J', click: () => openAppPath('/watch') },
        ...(isMac ? [] : [checkForUpdatesItem]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => navigate('back') },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => navigate('forward') },
      ],
    },
    { role: 'windowMenu' },
  ]);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => serverProcess?.kill());
