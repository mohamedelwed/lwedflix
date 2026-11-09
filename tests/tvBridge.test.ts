// The TV app's injected script (android/app/src/main/assets/shim.js) runs
// electron/preload.js unchanged inside the WebView. These assemble it the way
// MainActivity.kt does and run it against a fake page, to catch a preload
// change that breaks the TV app (a new require, a clashing name) without a TV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const script = read('android/app/src/main/assets/shim.js')
  .replace('/*__PLAYER_PROTOCOL__*/', () => read('electron/playerProtocol.js'))
  .replace('/*__PRELOAD__*/', () => read('electron/preload.js'))
  .replace('__SHELL_VERSION__', '9.9.9');

type Listener = (event: { data: string }) => void;

interface BridgedWindow {
  lwedflixPlayer: {
    command(command: Record<string, unknown>): void;
    onState(callback: (state: unknown) => void): () => void;
  };
  lwedflixDownloads?: unknown;
  lwedflixOdm?: unknown;
  lwedflixTv: { platform: string; shellVersion: string };
}

function fakePage({ top }: { top: boolean }) {
  const posted: Record<string, unknown>[] = [];
  const nativeListeners: Listener[] = [];
  const native = {
    postMessage: (data: string) => posted.push(JSON.parse(data)),
    addEventListener: (_type: string, listener: Listener) => nativeListeners.push(listener),
  };
  const noop = () => {};
  const document = {
    readyState: 'complete',
    head: null,
    body: { innerText: '' },
    documentElement: { style: { setProperty: noop } },
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window: Record<string, unknown> = {
    lwedflixNative: native,
    addEventListener: noop,
    document,
    location: { protocol: 'https:', hostname: top ? 'lwedflix.vercel.app' : 'vidsrc.me', origin: 'https://lwedflix.vercel.app', href: 'https://lwedflix.vercel.app/' },
  };
  window.window = window;
  window.top = top ? window : {};
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    HTMLMediaElement: { HAVE_FUTURE_DATA: 3 },
    HTMLVideoElement: class {},
    HTMLElement: class {},
    Element: class {},
    URL,
    // Unref'd, so the preload's long timers don't hold the test run open.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms).unref(),
    clearTimeout,
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms).unref(),
    clearInterval,
  });
  // `window.x` and bare `x` are the same thing in a page.
  vm.runInContext('for (const k of Object.keys(window)) globalThis[k] ??= window[k];', context);
  const deliver = (message: unknown) => nativeListeners.forEach((l) => l({ data: JSON.stringify(message) }));
  const run = () => {
    vm.runInContext(script, context);
    // Properties the shim defines on `window` live on the fake object.
    return window;
  };
  return { posted, deliver, run };
}

test('app page: player bridge exposed, desktop-only bridges left out, TV announced', () => {
  const page = fakePage({ top: true });
  const window = page.run() as unknown as BridgedWindow;
  assert.equal(typeof window.lwedflixPlayer?.command, 'function');
  assert.equal(window.lwedflixDownloads, undefined);
  assert.equal(window.lwedflixOdm, undefined);
  assert.equal(window.lwedflixTv.platform, 'android-tv');
  assert.equal(window.lwedflixTv.shellVersion, '9.9.9');
  assert.deepEqual(page.posted[0], { t: 'send', c: 'app:hello' });
});

test('app page: commands are checked, and picture-in-picture is dropped', () => {
  const page = fakePage({ top: true });
  const player = (page.run() as unknown as BridgedWindow).lwedflixPlayer;
  page.posted.length = 0;
  player.command({ action: 'seek', time: 42, extra: 'x' });
  player.command({ action: 'seek', time: -1 });
  player.command({ action: 'pip' });
  player.command({ action: 'eval', code: '1' });
  assert.deepEqual(page.posted, [{ t: 'send', c: 'player:command', p: { action: 'seek', time: 42 } }]);
});

test('app page: states from a player frame are cleaned before the app sees them', () => {
  const page = fakePage({ top: true });
  const player = (page.run() as unknown as BridgedWindow).lwedflixPlayer;
  const seen: unknown[] = [];
  player.onState((state: unknown) => seen.push(state));
  page.deliver({ t: 'event', c: 'player:state', p: { event: 'play', playing: true, time: 5, duration: 100, volume: 7, tracks: [] } });
  page.deliver({ t: 'event', c: 'player:state', p: { event: 'not-an-event' } });
  page.deliver({ t: 'event', c: 'player:state', p: null });
  assert.equal(seen.length, 2);
  assert.equal((seen[0] as { volume: number }).volume, 1);
  assert.equal(seen[1], null);
});

test('player frame: asks whether to autoplay and follows commands', async () => {
  const page = fakePage({ top: false });
  page.run();
  const ask = page.posted.find((m) => m.t === 'invoke') as { id: number; c: string };
  assert.equal(ask.c, 'player:should-autoplay');
  page.deliver({ t: 'reply', id: ask.id, ok: true, v: false });
  // No <video> yet, so a command is ignored rather than throwing.
  page.deliver({ t: 'event', c: 'player:command', p: { action: 'play' } });
});
