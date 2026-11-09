// Finds the stream of an episode nobody is watching, for downloading a
// whole season. A hidden window plays the episode's server — embedded the
// way the player embeds it, in a session of its own with the ad blocker on —
// presses play, takes the first real stream it loads (streams.js), and
// closes. One at a time, and only when that episode's turn to download
// comes: stream URLs are signed and expire, so they're never fetched early.

const { captureStreams, pickRequestHeaders } = require('./streams');

// Keep in step with PROVIDERS in src/components/VideoPlayer.tsx. vidlink is
// left out: it only serves DASH, which can't be downloaded.
const PROVIDERS = [
  { name: 'vidsrc.me', embed: (kind, id, s, e) => (kind === 'movie' ? `https://vidsrc.me/embed/movie/${id}` : `https://vidsrc.me/embed/tv/${id}/${s}/${e}`) },
  { name: 'vidcore', embed: (kind, id, s, e) => (kind === 'movie' ? `https://vidcore.org/embed/movie/${id}` : `https://vidcore.org/embed/tv/${id}/${s}/${e}`) },
  { name: '2embed', embed: (kind, id, s, e) => (kind === 'movie' ? `https://www.2embed.cc/embed/${id}` : `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`) },
  { name: 'videasy', embed: (kind, id, s, e) => (kind === 'movie' ? `https://player.videasy.to/movie/${id}` : `https://player.videasy.to/tv/${id}/${s}/${e}`) },
];
const WAIT_MS = 45000;
// After the first playlist shows up, a moment for the master playlist (all
// the qualities) to arrive too.
const SETTLE_MS = 2500;

/** Waits, or stops waiting the moment `signal` aborts. */
const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/** Presses the middle of every frame: the play button, on every server tried. */
function pressPlay(win) {
  return Promise.all(win.webContents.mainFrame.framesInSubtree
    .filter((frame) => frame !== win.webContents.mainFrame)
    .map((frame) => frame.executeJavaScript(`(() => {
      const x = innerWidth / 2, y = innerHeight / 2, el = document.elementFromPoint(x, y);
      if (el) for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    })()`, true).catch(() => {})));
}

/**
 * `wrapperUrl(src)` is a page that embeds `src` like the app's player does
 * (/api/player-frame on the app's own server).
 */
function createResolver({ BrowserWindow, ses, wrapperUrl, log = () => {} }) {
  let queue = Promise.resolve();

  async function tryProvider(provider, target, signal) {
    const src = provider.embed(target.mediaType, target.mediaId, target.season ?? 1, target.episode ?? 1);
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 640,
      webPreferences: { session: ses, offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    // Its listeners replace the previous window's: one window at a time.
    const streams = captureStreams({ ses, webContents: win.webContents });
    try {
      await win.loadURL(wrapperUrl(src)).catch(() => {});
      const end = Date.now() + WAIT_MS;
      let presses = 0;
      let firstSeen = 0;
      while (Date.now() < end && !signal?.aborted) {
        await sleep(presses === 0 ? 6000 : 2500, signal);
        if (signal?.aborted) return null;
        const found = streams.list([]).filter((s) => s.supported);
        if (found.length && !firstSeen) firstSeen = Date.now();
        if (found.length && Date.now() - firstSeen >= SETTLE_MS) {
          const best = streams.get(streams.list([]).find((s) => s.supported).id);
          return { url: best.url, kind: best.kind, headers: pickRequestHeaders(best.requestHeaders), frameUrl: best.frameUrl, provider: provider.name };
        }
        if (!found.length && presses < 6) {
          presses++;
          await pressPlay(win);
        }
      }
      return null;
    } finally {
      win.destroy();
    }
  }

  /**
   * The stream for one episode (or movie): the server asked for first, then
   * the rest. Gives up as soon as `signal` aborts (the download was cancelled).
   */
  function resolve(target, preferred, signal) {
    const what = target.mediaType === 'tv' ? `tv ${target.mediaId} S${target.season}E${target.episode}` : `movie ${target.mediaId}`;
    const run = async () => {
      const order = [...PROVIDERS].sort((a, b) => (b.name === preferred) - (a.name === preferred));
      for (const provider of order) {
        if (signal?.aborted) return null;
        try {
          const source = await tryProvider(provider, target, signal);
          if (source) {
            log(`resolved ${what} on ${provider.name}`);
            return source;
          }
        } catch (err) {
          log(`resolver: ${provider.name}: ${err.message}`);
        }
      }
      return null;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return { resolve };
}

module.exports = { createResolver, PROVIDERS };
