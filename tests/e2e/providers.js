// Provider probe: embeds each server the way the app does, presses play,
// and reports whether a stream was requested — with the app's ad blocker
// on, as in the app. Run it after changing the blocklist
// (electron/adblock.js) or the server list (src/components/VideoPlayer.tsx,
// whose URLs are repeated below), and compare with --no-block when a
// server stops playing.
//
//   npm run test:providers [-- --no-block] [-- --only=vidsrc.me,vidlink]
//
// Providers come and go, so this reports rather than fails, except when
// nothing streams at all. Known gap: videasy answers "We couldn't find
// that" here although it plays in the app — check it there.

const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { installAdBlock } = require('../../electron/adblock');

const BLOCK = !process.argv.includes('--no-block');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const OUT = path.join(__dirname, 'output', 'providers');
const WATCH_MS = 24000;

const tmdb = (base) => (kind, id, season, episode) => (kind === 'movie' ? `${base}/movie/${id}` : `${base}/tv/${id}/${season}/${episode}`);
const PROVIDERS = {
  'vidsrc.me': tmdb('https://vidsrc.me/embed'),
  vidcore: tmdb('https://vidcore.org/embed'),
  '2embed': (kind, id, season, episode) =>
    kind === 'movie' ? `https://www.2embed.cc/embed/${id}` : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`,
  videasy: tmdb('https://player.videasy.to'),
  vidlink: tmdb('https://vidlink.pro'),
};
const SAMPLES = {
  movie: ['movie', 550], // Fight Club
  tv: ['tv', 1399, 1, 1], // Game of Thrones
  anime: ['tv', 1429, 1, 1], // Attack on Titan
};

const MEDIA_URL = /\.(m3u8|mpd|mp4|m4s|ts)(\?|$)/i;
const MEDIA_TYPE = /mpegurl|dash\+xml|^video\//i;

app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|lwedflix)\/\S+/gi, '');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // The embed sits in an iframe on a local page, as in the app — without a
  // referrer, as in the app: some servers refuse a local one.
  const server = http.createServer((req, res) => {
    const src = decodeURIComponent(req.url.slice(1)).replace(/"/g, '');
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body style="margin:0;background:#000"><iframe src="${src}" style="border:0;width:100vw;height:100vh" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture *; fullscreen" referrerpolicy="no-referrer"></iframe></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const jobs = [];
  let n = 0;
  for (const [provider, build] of Object.entries(PROVIDERS)) {
    if (ONLY && !ONLY.includes(provider)) continue;
    for (const [sample, args] of Object.entries(SAMPLES)) jobs.push(probe(n++, provider, sample, build(...args), port));
  }
  const results = await Promise.all(jobs);
  console.log(`ad blocking ${BLOCK ? 'on' : 'off'}\n`);
  for (const r of results) {
    console.log(
      `${r.stream ? 'PLAYS' : '  -  '}  ${r.provider.padEnd(10)} ${r.sample.padEnd(6)} blocked=${String(r.blocked).padStart(2)} popups=${r.popups} downloads=${r.downloads}  ${r.stream || r.text}`
    );
  }
  server.close();
  app.exit(results.some((r) => r.stream) ? 0 : 1);
});

async function probe(id, provider, sample, url, port) {
  const ses = session.fromPartition(`probe-${id}`);
  const stats = { blocked: 0, popups: 0, downloads: 0 };
  const streams = new Set();
  if (BLOCK) {
    installAdBlock(ses, { onBlock: () => stats.blocked++, onDownload: () => stats.downloads++ });
  } else {
    ses.on('will-download', (e) => {
      stats.downloads++;
      e.preventDefault();
    });
  }
  ses.webRequest.onHeadersReceived((details, callback) => {
    const type = Object.entries(details.responseHeaders || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.[0] || '';
    if (MEDIA_URL.test(details.url) || MEDIA_TYPE.test(type)) streams.add(new URL(details.url).host);
    callback({});
  });

  const win = new BrowserWindow({ width: 1100, height: 640, show: false, webPreferences: { session: ses, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => {
    stats.popups++;
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setAudioMuted(true);
  await win.loadURL(`http://127.0.0.1:${port}/${encodeURIComponent(url)}`).catch(() => {});

  // Click the middle of every frame (the poster's play button) as a user
  // gesture, twice, then let it run.
  const click = () =>
    Promise.all(
      win.webContents.mainFrame.framesInSubtree
        .filter((f) => f !== win.webContents.mainFrame)
        .map((f) =>
          f
            .executeJavaScript(
              `(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
                 if (el) for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
                 document.querySelectorAll('video').forEach((v) => { v.muted = true; v.play().catch(() => {}); }); })()`,
              true
            )
            .catch(() => {})
        )
    );
  await sleep(7000);
  await click();
  await sleep(3000);
  await click();
  await sleep(WATCH_MS - 10000);

  const text = await Promise.all(
    win.webContents.mainFrame.framesInSubtree.map((f) => f.executeJavaScript('document.body ? document.body.innerText.slice(0, 120) : ""').catch(() => ''))
  );
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${provider}-${sample}.png`.replace(/[^\w.-]/g, '_')), shot.resize({ width: 550 }).toPNG());
  win.destroy();
  return {
    provider,
    sample,
    stream: [...streams][0] ?? null,
    ...stats,
    text: text.join(' ').replace(/\s+/g, ' ').trim().slice(0, 70),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
