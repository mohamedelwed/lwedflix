// Runs at document start in every frame of the TV app's WebView (the app
// page and the embedded players), like electron/preload.js does on desktop —
// and it runs that same preload, unchanged. The preload talks to Electron
// through `require('electron')`; here `contextBridge` and `ipcRenderer` are
// stand-ins that carry the same messages over `lwedflixNative`, the channel
// PlayerRelay.kt opens into every frame. PlayerRelay does main.js's routing:
// states from the player frame to the app page, commands back.
//
// MainActivity fills in the three placeholders below before injecting this.
//
// Unlike Electron's isolated worlds, this shares the page's own world, so
// the app page re-checks everything coming from a player frame
// (playerProtocol.js's cleanState), as main.js does on desktop.
(() => {
  const native = window.lwedflixNative;
  if (!native || window.__lwedflixBridge) return;
  Object.defineProperty(window, '__lwedflixBridge', { value: true });

  const isAppPage = window === window.top;

  const { cleanState, cleanCommand } = ((module) => {
    // ---- electron/playerProtocol.js ----
    /*__PLAYER_PROTOCOL__*/
    // ----
    return module.exports;
  })({ exports: {} });

  const post = (message) => {
    try {
      native.postMessage(JSON.stringify(message));
    } catch {
      // The frame is going away.
    }
  };

  // What may reach the app page from a player frame (main.js does this on
  // desktop). Anything else is dropped.
  const incoming = {
    'player:state': (state) => (state === null ? null : cleanState(state) ?? undefined),
    'player:problem': (problem) => ({ reason: problem?.reason === 'error' ? 'error' : 'unavailable' }),
    'player:shortcut': () => ({ key: 'f' }),
    'player:command': (command) => command,
  };

  const listeners = new Map();
  const pending = new Map();
  let nextId = 1;

  native.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.t === 'reply') {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.ok) call.resolve(message.v);
      else call.reject(new Error(message.v || 'failed'));
    } else if (message.t === 'event') {
      const filter = incoming[message.c];
      if (!filter) return;
      const payload = filter(message.p);
      if (payload === undefined) return;
      for (const listener of listeners.get(message.c) ?? []) listener({}, payload);
    }
  });

  const ipcRenderer = {
    send(channel, payload) {
      if (channel === 'player:command' && isAppPage) {
        const command = cleanCommand(payload);
        // No picture-in-picture on a TV.
        if (!command || command.action === 'pip') return;
        payload = command;
      }
      post({ t: 'send', c: channel, p: payload });
    },
    invoke(channel, ...args) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ t: 'invoke', id, c: channel, a: args });
      });
    },
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(listener);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
  };

  // Desktop-only bridges stay missing, so the app hides what needs them
  // (downloads, ODM) just as it does in a browser.
  const DESKTOP_ONLY = new Set(['lwedflixDownloads', 'lwedflixOdm']);
  const contextBridge = {
    exposeInMainWorld(name, api) {
      if (DESKTOP_ONLY.has(name)) return;
      Object.defineProperty(window, name, { value: Object.freeze(api), enumerable: false });
    },
  };

  if (isAppPage) {
    // Tells the app it's on a TV (src/lib/tv.ts): remote navigation, no
    // mini player.
    Object.defineProperty(window, 'lwedflixTv', {
      value: Object.freeze({
        platform: 'android-tv',
        shellVersion: '__SHELL_VERSION__',
        showKeyboard: () => post({ t: 'send', c: 'tv:keyboard' }),
      }),
      enumerable: false,
    });

    // The app's layout is made for a desktop window. Laid out 1280 CSS
    // pixels wide and scaled to the screen, it reads from the couch.
    const VIEWPORT = 'width=1280';
    const fixViewport = () => {
      let meta = document.querySelector('meta[name="viewport"]');
      if (!meta && document.head) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.head.append(meta);
      }
      if (meta && meta.content !== VIEWPORT) meta.content = VIEWPORT;
    };
    const viewportWatch = new MutationObserver(fixViewport);
    viewportWatch.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      fixViewport();
      viewportWatch.disconnect();
    });

    // PlayerRelay learns which frame is the app page from its first message.
    post({ t: 'send', c: 'app:hello' });
  }

  const electron = { contextBridge, ipcRenderer };
  // Its own scope: the preload declares `contextBridge` and `ipcRenderer`
  // itself.
  ((require, process) => {
    // ---- electron/preload.js ----
    /*__PRELOAD__*/
    // ----
  })(
    (name) => {
      if (name !== 'electron') throw new Error(`Cannot find module '${name}'`);
      return electron;
    },
    { platform: 'android' }
  );
})();
