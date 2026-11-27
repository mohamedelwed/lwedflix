import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { shimFor } from '../player/bridge.ts';

const { BLOCKED_DOMAINS } = createRequire(import.meta.url)('../../electron/adblock.js') as { BLOCKED_DOMAINS: Set<string> };

// The frame script (player/shim.js) in a fake player frame: requests to the
// desktop's blocked ad domains must never go out; everything else must.
function frameHarness() {
  const fetched: string[] = [];
  const sent: string[] = [];
  class FakeXHR {
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      sent.push(this.url);
    }
    addEventListener() {}
    dispatchEvent() {
      return true;
    }
  }
  const top = { postMessage() {} };
  const win: Record<string, unknown> = {
    top,
    fetch: (url: string) => {
      fetched.push(url);
      return Promise.resolve({ headers: { get: () => '' } });
    },
    addEventListener() {},
  };
  win.window = win;
  const context = vm.createContext({
    ...win,
    window: win,
    location: { href: 'https://player.example/embed/1' },
    XMLHttpRequest: FakeXHR,
    URL,
    Promise,
    TypeError,
    setTimeout,
    setInterval: () => 0,
    Event: class {},
    navigator: {},
    document: { getElementsByTagName: () => [] },
    Object,
    String,
    Number,
    Array,
    JSON,
  });
  // The shim checks window.top; in the context, window is the global's `window`.
  context.window = context;
  context.top = top;
  context.fetch = win.fetch;
  try {
    vm.runInContext(shimFor('t0ken', 'android'), context);
  } catch {
    // The desktop preload at the end needs a real page; the hooks are in by then.
  }
  return { context, fetched, sent };
}

test('the blocklist is the desktop one, and not empty', () => {
  assert.ok(BLOCKED_DOMAINS.size > 50);
  assert.ok(shimFor('x', 'android').includes('propellerads.com'));
});

test('fetch to a blocked domain or its subdomain never goes out', async () => {
  const { context, fetched } = frameHarness();
  const blocked = [...BLOCKED_DOMAINS][0];
  await assert.rejects(vm.runInContext(`fetch('https://${blocked}/ad.js')`, context) as Promise<unknown>);
  await assert.rejects(vm.runInContext(`fetch('https://cdn.${blocked}/x')`, context) as Promise<unknown>);
  assert.deepEqual(fetched, []);
});

test('fetch elsewhere goes through', async () => {
  const { context, fetched } = frameHarness();
  await vm.runInContext(`fetch('https://stream.example/master.m3u8')`, context);
  assert.deepEqual(fetched, ['https://stream.example/master.m3u8']);
});

test('XHR to a blocked domain is never sent; others are', () => {
  const { context, sent } = frameHarness();
  const blocked = [...BLOCKED_DOMAINS][1];
  vm.runInContext(
    `var a = new XMLHttpRequest(); a.open('GET', 'https://${blocked}/pixel'); a.send();
     var b = new XMLHttpRequest(); b.open('GET', 'https://stream.example/seg1.ts'); b.send();`,
    context,
  );
  assert.deepEqual(sent, ['https://stream.example/seg1.ts']);
});

test('a domain that only ends like a blocked one is not blocked', async () => {
  const { context, fetched } = frameHarness();
  const blocked = [...BLOCKED_DOMAINS][0];
  await vm.runInContext(`fetch('https://not${blocked}/x')`, context);
  assert.equal(fetched.length, 1);
});
