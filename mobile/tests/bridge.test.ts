import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { shimFor, wrapperFor, js, WRAPPER_BASE_URL } from '../player/bridge.ts';
import { isAllowedPlayerNavigation } from '../player/navigation.ts';
import { parseRoomCode } from '../lib/party.ts';

// The wrapper page's router (player/wrapper.html) in a fake window: frames
// post to it, it reports to the app (ReactNativeWebView.postMessage), and
// commands from the app go back to the frame that has the <video>.
function wrapperHarness(token: string) {
  const html = wrapperFor(token, 'https://vidsrc.me/embed/movie/550', true);
  const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
  const toApp: { c: string; p: unknown }[] = [];
  const listeners: ((e: unknown) => void)[] = [];
  const iframe = { src: '', addEventListener() {} };
  const win: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (s: string) => toApp.push(JSON.parse(s)) },
    addEventListener: (type: string, l: (e: unknown) => void) => type === 'message' && listeners.push(l),
  };
  const context = vm.createContext({ window: win, document: { getElementById: () => iframe }, Date, JSON, Number, String });
  vm.runInContext(script, context);
  const frame = () => {
    const received: unknown[] = [];
    return { received, postMessage: (m: unknown) => received.push(m) };
  };
  const fromFrame = (source: unknown, data: unknown) => listeners.forEach((l) => l({ data, source }));
  return { win, toApp, iframe, frame, fromFrame };
}

test('the wrapper loads the server and asks for autoplay', () => {
  const h = wrapperHarness('tok');
  assert.equal(h.iframe.src, 'https://vidsrc.me/embed/movie/550');
  const f = h.frame();
  h.fromFrame(f, { lwf: 'tok', t: 'invoke', id: 1, c: 'player:should-autoplay', a: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(f.received[0])), { lwf: 'tok', t: 'reply', id: 1, ok: true, v: true });
});

test('player states are checked and passed on; commands reach the reporting frame', () => {
  const h = wrapperHarness('tok');
  const f = h.frame();
  h.fromFrame(f, { lwf: 'tok', t: 'send', c: 'player:state', p: { event: 'timeupdate', playing: true, time: 12, duration: 100, volume: 9 } });
  const state = h.toApp.find((m) => m.c === 'state' && m.p) as { p: { time: number; volume: number } };
  assert.equal(state.p.time, 12);
  assert.equal(state.p.volume, 1, 'clamped by cleanState');

  (h.win.__lwfCommand as (c: unknown) => void)({ action: 'seek', time: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.received.at(-1))), { lwf: 'tok', t: 'event', c: 'player:command', p: { action: 'seek', time: 30 } });
  (h.win.__lwfCommand as (c: unknown) => void)({ action: 'seek', time: -5 });
  (h.win.__lwfCommand as (c: unknown) => void)({ action: 'pip' });
  assert.equal(f.received.filter((m) => (m as { t: string }).t === 'event').length, 1, 'bad and picture-in-picture commands are dropped');
});

test('messages without the token, and unknown events, are ignored', () => {
  const h = wrapperHarness('tok');
  const before = h.toApp.length;
  const f = h.frame();
  h.fromFrame(f, { lwf: 'wrong', t: 'send', c: 'player:state', p: { event: 'play' } });
  h.fromFrame(f, { lwf: 'tok', t: 'send', c: 'player:state', p: { event: 'hacked' } });
  assert.equal(h.toApp.length, before);
});

test('a frame that goes away clears the state, only if it was the player', () => {
  const h = wrapperHarness('tok');
  const player = h.frame();
  const other = h.frame();
  h.fromFrame(player, { lwf: 'tok', t: 'send', c: 'player:state', p: { event: 'play', playing: true } });
  const n = h.toApp.length;
  h.fromFrame(other, { lwf: 'tok', t: 'send', c: 'player:state', p: { event: 'gone' } });
  assert.equal(h.toApp.length, n);
  h.fromFrame(player, { lwf: 'tok', t: 'send', c: 'player:state', p: { event: 'gone' } });
  assert.deepEqual(h.toApp.at(-1), { c: 'state', p: null });
});

test('captured streams and problems reach the app', () => {
  const h = wrapperHarness('tok');
  const f = h.frame();
  h.fromFrame(f, { lwf: 'tok', t: 'send', c: 'stream', p: { url: 'https://cdn.example/master.m3u8', type: 'application/vnd.apple.mpegurl', size: 900, frame: 'https://vidsrc.sh/x', ua: 'Mozilla/5.0 (Linux; Android 15; wv)' } });
  h.fromFrame(f, { lwf: 'tok', t: 'send', c: 'player:problem', p: { reason: 'nonsense' } });
  assert.deepEqual(h.toApp.find((m) => m.c === 'stream')?.p, { url: 'https://cdn.example/master.m3u8', type: 'application/vnd.apple.mpegurl', size: 900, frame: 'https://vidsrc.sh/x', ua: 'Mozilla/5.0 (Linux; Android 15; wv)' });
  assert.deepEqual(h.toApp.find((m) => m.c === 'problem')?.p, { reason: 'unavailable' });
});

test('the frame shim carries the token and the desktop preload', () => {
  const shim = shimFor('tok', 'android');
  assert.match(shim, /var TOKEN = 'tok'/);
  assert.match(shim, /playerBridge\(\)/, 'electron/preload.js is inlined');
  assert.match(shim, /platform: "android"/);
  assert.equal(js.command({ action: 'play' }), 'window.__lwfCommand && window.__lwfCommand({"action":"play"}); true;');
});

test('only the wrapper may be the top frame; frames load web pages only', () => {
  assert.equal(isAllowedPlayerNavigation(WRAPPER_BASE_URL, true), true);
  assert.equal(isAllowedPlayerNavigation('https://casino.example/', true), false);
  assert.equal(isAllowedPlayerNavigation('https://vidsrc.sh/embed', false), true);
  assert.equal(isAllowedPlayerNavigation('intent://scan#Intent;end', false), false);
  assert.equal(isAllowedPlayerNavigation('market://details?id=x', false), false);
});

test('room codes come from a bare code or a pasted link', () => {
  assert.equal(parseRoomCode('abc234'), 'ABC234');
  assert.equal(parseRoomCode('lwedflix://watch/XYZ789'), 'XYZ789');
  assert.equal(parseRoomCode('https://x.app/watch/QWE456?x=1'), 'QWE456');
  assert.equal(parseRoomCode('ab'), null);
});
