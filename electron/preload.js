// Runs in every frame (nodeIntegrationInSubFrames), always in an isolated
// world: the main frame gets the intro or app bridges, embedded frames get
// the player bridge.

const { contextBridge, ipcRenderer } = require('electron');

if (window !== window.top) {
  playerBridge();
} else if (location.protocol === 'file:') {
  // The intro page.
  contextBridge.exposeInMainWorld('lwedflix', {
    whenAppReady: () => ipcRenderer.invoke('app:when-ready'),
    introFinished: () => ipcRenderer.send('intro:finished'),
  });
} else {
  // The app's side of the player bridge (src/lib/desktopPlayer.ts).
  const subscribe = (channel) => (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
  contextBridge.exposeInMainWorld('lwedflixPlayer', {
    onState: subscribe('player:state'),
    onProblem: subscribe('player:problem'),
    onShortcut: subscribe('player:shortcut'),
    command: (command) => ipcRenderer.send('player:command', command),
  });

  // Hand a stream the embedded player is using to ODM (src/lib/odmBridge.ts).
  // Main only accepts these from the app's own page, never from a player frame.
  contextBridge.exposeInMainWorld('lwedflixOdm', {
    available: () => ipcRenderer.invoke('odm:available'),
    status: () => ipcRenderer.invoke('odm:status'),
    openSite: () => ipcRenderer.invoke('odm:open-site'),
    streams: (origins) => ipcRenderer.invoke('odm:streams', origins),
    download: (id, meta) => ipcRenderer.invoke('odm:download', id, meta),
  });

  // Every popup is denied in the main process, so links leaving the app
  // (user-posted links in posts and comments) are routed to the system
  // browser here instead of silently doing nothing.
  window.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
      event.preventDefault();
      ipcRenderer.send('open-external', url.href);
    },
    true
  );

  // Mouse back/forward buttons, which a bare window doesn't map to history.
  window.addEventListener('mouseup', (event) => {
    if (event.button === 3) history.back();
    if (event.button === 4) history.forward();
  });
}

// Inside the embedded players: finds the stream's <video> in whichever
// cross-origin frame the provider renders it, reports its state, and
// applies commands from the app. A website can't do this — browsers wall off
// cross-origin frames — and it's what lets watch parties sync.
function playerBridge() {
  // YouTube trailers and the Gen Z background clip aren't the stream.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return;

  // Anything shorter is an ad or a preview, not the feature.
  const MIN_DURATION_S = 240;
  let video = null;
  let lastProgress = 0;
  let clean = null;

  const report = (type) =>
    ipcRenderer.send('player:state', {
      event: type,
      playing: !video.paused,
      time: video.currentTime,
      duration: video.duration,
      muted: video.muted,
      volume: video.volume,
      rate: video.playbackRate,
      buffered: bufferedUntil(video),
      buffering: !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
      tracks: subtitleTracks(video).map((t) => ({ label: t.label, language: t.language })),
      track: shownTrack(video),
    });

  const EVENTS = ['play', 'pause', 'seeked', 'timeupdate', 'progress', 'loadedmetadata', 'ended', 'volumechange', 'ratechange', 'waiting', 'playing'];
  for (const type of EVENTS) {
    // Media events don't bubble, but a capturing listener on the document
    // still sees them, including from <video> elements created later.
    document.addEventListener(
      type,
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement) || !(target.duration >= MIN_DURATION_S)) return;
        if (type === 'timeupdate' || type === 'progress') {
          if (Date.now() - lastProgress < 1000) return;
          lastProgress = Date.now();
        }
        if (video !== target) adopt(target);
        report(type);
      },
      true
    );
  }

  function adopt(target) {
    video = target;
    // Lets the main process find it from the page's own world (the mini
    // player needs a user gesture there).
    video.dataset.lwedflixStream = '';
    // Subtitles chosen in the server's menu, or ours.
    video.textTracks.addEventListener('change', () => report('tracks'));
    video.textTracks.addEventListener('addtrack', () => report('tracks'));
    // A new <video> (after an ad, say) takes over the cleaned-up frame.
    if (clean) {
      clean.off();
      clean = keepOnly(video);
    }
  }

  window.addEventListener('pagehide', () => {
    if (video) ipcRenderer.send('player:state', { event: 'gone' });
  });

  ipcRenderer.on('player:command', (_event, command) => {
    if (!video) return;
    switch (command.action) {
      case 'report':
        report('status');
        break;
      case 'clean':
        if (command.on && !clean) clean = keepOnly(video);
        if (!command.on && clean) {
          clean.off();
          clean = null;
        }
        break;
      case 'setVolume':
        video.volume = command.volume;
        if (command.volume > 0) video.muted = false;
        break;
      case 'setMuted':
        video.muted = command.muted;
        break;
      case 'setRate':
        video.playbackRate = command.rate;
        break;
      case 'liftSubtitles':
        document.documentElement.style.setProperty('--lwedflix-lift', `${command.px}px`);
        break;
      case 'setTrack':
        subtitleTracks(video).forEach((t, i) => {
          t.mode = i === command.index ? 'showing' : 'disabled';
        });
        break;
      case 'seek':
        video.currentTime = command.time;
        break;
      case 'seekBy':
        video.currentTime = Math.min(Math.max(video.currentTime + command.delta, 0), video.duration);
        break;
      case 'play':
        video.play().catch(() => {});
        break;
      case 'pause':
        video.pause();
        break;
      case 'toggle':
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        break;
      case 'toggleMute':
        video.muted = !video.muted;
        break;
    }
  });

  // A frame further down holds the stream and has been cleaned up: show
  // nothing here but the <iframe> it's in.
  let framed = null;
  window.addEventListener('message', (event) => {
    const on = event.data?.lwedflixClean;
    if (typeof on !== 'boolean') return;
    const frame = [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === event.source);
    if (!frame) return;
    framed?.off();
    framed = on ? keepOnly(frame) : null;
  });

  watchForProblems(() => video !== null);
  forwardShortcuts(() => video);
}

// The app draws its own controls over the player, so the server's have to
// go. Everything in this frame but `keep` — the stream's <video>, or the
// <iframe> leading to it — is hidden, and `keep` fills the frame. The frame
// above is then asked to do the same for the <iframe> this frame is in, and
// so on up to the app. Done with CSS and attributes only, so turning it off
// puts the server's player back exactly as it was.
const CLEAN_CSS = `
  html, body { background: #000 !important; overflow: hidden !important; }
  body * { visibility: hidden !important; pointer-events: none !important; }
  [data-lwedflix-path] {
    transform: none !important; filter: none !important; backdrop-filter: none !important;
    perspective: none !important; contain: none !important; will-change: auto !important;
    clip-path: none !important; mask: none !important; opacity: 1 !important;
  }
  [data-lwedflix-keep] {
    visibility: visible !important; pointer-events: auto !important; opacity: 1 !important;
    position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
    width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important;
    min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important;
    border: 0 !important; transform: none !important; background: #000 !important;
  }
  video[data-lwedflix-keep] { object-fit: contain !important; }
  video[data-lwedflix-keep]::-webkit-media-controls { display: none !important; }
  /* Subtitles rise above the app's controls while they're showing. */
  video[data-lwedflix-keep]::-webkit-media-text-track-container {
    transform: translateY(calc(-1 * var(--lwedflix-lift, 0px))) !important;
    transition: transform 0.25s ease !important;
  }
`;

function keepOnly(keep) {
  const style = document.createElement('style');
  style.textContent = CLEAN_CSS;
  (document.head || document.documentElement).append(style);

  // Players re-render; the marks are put back on whatever is there now.
  const mark = () => {
    keep.setAttribute('data-lwedflix-keep', '');
    for (let el = keep.parentElement; el; el = el.parentElement) el.setAttribute('data-lwedflix-path', '');
  };
  mark();
  const timer = setInterval(mark, 1000);

  const restore = [];
  if (keep instanceof HTMLVideoElement) {
    if (keep.controls) {
      keep.controls = false;
      restore.push(() => (keep.controls = true));
    }
    // Subtitles a server draws itself (track mode 'hidden') are hidden
    // along with the rest; the browser draws the same track instead.
    for (const track of subtitleTracks(keep)) {
      if (track.mode !== 'hidden') continue;
      track.mode = 'showing';
      restore.push(() => {
        if (track.mode === 'showing') track.mode = 'hidden';
      });
    }
  }

  const tellParent = (on) => {
    if (window.parent !== window.top) window.parent.postMessage({ lwedflixClean: on }, '*');
  };
  tellParent(true);

  return {
    off() {
      clearInterval(timer);
      style.remove();
      for (const el of document.querySelectorAll('[data-lwedflix-keep], [data-lwedflix-path]')) {
        el.removeAttribute('data-lwedflix-keep');
        el.removeAttribute('data-lwedflix-path');
      }
      restore.forEach((undo) => undo());
      tellParent(false);
    },
  };
}

function subtitleTracks(video) {
  return [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
}

/** The track on screen: one the browser draws, else one the server draws itself. */
function shownTrack(video) {
  const tracks = subtitleTracks(video);
  const showing = tracks.findIndex((t) => t.mode === 'showing');
  return showing !== -1 ? showing : tracks.findIndex((t) => t.mode === 'hidden');
}

/** Where the buffered stretch the playhead is in ends. */
function bufferedUntil(video) {
  const { buffered, currentTime } = video;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.5 && currentTime <= buffered.end(i)) return buffered.end(i);
  }
  return currentTime;
}

// A server that can't play a title says so in its own words, often before
// any <video> exists ("We couldn't find that"). Report it once, so the app
// can try the next server instead of leaving the viewer at an error.
function watchForProblems(hasStream) {
  const UNAVAILABLE =
    /couldn['’]?t find|could not find|not available|unavailable|no (video )?sources?\b|(video|media|file) (not found|was deleted|has been removed)|failed to load/i;
  let reported = false;
  const send = (reason) => {
    if (reported || hasStream()) return;
    reported = true;
    observer.disconnect();
    ipcRenderer.send('player:problem', { reason });
  };

  // A video that fails before it ever plays is the same problem.
  document.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLVideoElement && !(event.target.currentTime > 0)) send('error');
    },
    true
  );

  let pending = false;
  const check = () => {
    pending = false;
    const text = document.body?.innerText ?? '';
    if (text.length < 2000 && UNAVAILABLE.test(text)) send('unavailable');
  };
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(check, 500);
  });
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    check();
    // Error screens appear early; a page still fine after this long is just a page.
    setTimeout(() => observer.disconnect(), 30000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

// The app's player shortcuts, for when keyboard focus is inside the player.
// Handled here only in the frame that holds the stream — anywhere else the
// provider's own keys (say, Space to start playback) keep working.
function forwardShortcuts(getVideo) {
  window.addEventListener(
    'keydown',
    (event) => {
      const video = getVideo();
      if (!video || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      } else if (key === 'arrowleft' || key === 'j') {
        video.currentTime = Math.max(video.currentTime - 10, 0);
      } else if (key === 'arrowright' || key === 'l') {
        video.currentTime = Math.min(video.currentTime + 10, video.duration);
      } else if (key === 'm') {
        video.muted = !video.muted;
      } else if (key === 'p') {
        // A keypress here is the user gesture picture-in-picture needs.
        video.disablePictureInPicture = false;
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else video.requestPictureInPicture().catch(() => {});
      } else if (key === 'f') {
        // Fullscreen belongs to the app's player frame, not this one.
        ipcRenderer.send('player:key', 'f');
      } else {
        return;
      }
      // Ours alone: the provider's player would otherwise act on it too
      // (Space toggling twice is no toggle at all).
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
}
