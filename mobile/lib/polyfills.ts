// What the shared libraries (../src/lib) expect from a browser, for Hermes.
// Imported first, before anything else, by app/_layout.tsx.
import 'expo-sqlite/localStorage/install'; // a synchronous localStorage, as progress/history use
import 'react-native-url-polyfill/auto';
import { randomUUID } from 'expo-crypto';

const g = globalThis as { crypto?: { randomUUID?: () => string } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.randomUUID) g.crypto.randomUUID = randomUUID as () => string;

// watchHistory.ts asks navigator.onLine before writing; React Native has no
// such flag, so it would queue every entry. Assume online: a failed write
// queues anyway.
const nav = globalThis.navigator as { onLine?: boolean } | undefined;
if (nav && nav.onLine === undefined) {
  try {
    Object.defineProperty(nav, 'onLine', { get: () => true, configurable: true });
  } catch {
    // Read-only navigator: watchHistory falls back to its queue.
  }
}

// watchRoom.ts remembers the title a party was started with in
// sessionStorage: a tab's lifetime there, the app's here.
if (!(globalThis as { sessionStorage?: unknown }).sessionStorage) {
  const items = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

// The desktop's download modules (electron/hls.js, mp4.js) use Node's Buffer.
import { Buffer } from 'buffer';
if (!(globalThis as { Buffer?: unknown }).Buffer) (globalThis as { Buffer?: unknown }).Buffer = Buffer;
