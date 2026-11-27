import { useSyncExternalStore } from 'react';

// Download settings, kept on the phone (expo-sqlite's localStorage).
// engine.ts reads them for every decision; the settings screen
// (app/download-settings.tsx) changes them.

export interface DownloadSettings {
  /** Picture height to save; null: the best the server has. 'ask': choose each time. */
  quality: 'ask' | number | null;
  /** How many download at once. */
  parallel: 1 | 2 | 3;
  /** Bytes per second for all downloads together; 0: no limit. */
  speedLimit: number;
  /** Downloads wait for Wi-Fi (and pause when it goes). */
  wifiOnly: boolean;
}

const KEY = 'lwedflix:download-settings';
export const DEFAULT_SETTINGS: DownloadSettings = { quality: 'ask', parallel: 2, speedLimit: 0, wifiOnly: false };

let current: DownloadSettings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): DownloadSettings {
  if (!current) {
    try {
      current = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
      current = { ...DEFAULT_SETTINGS };
    }
  }
  return current!;
}

export function setSettings(patch: Partial<DownloadSettings>) {
  current = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Kept for this session.
  }
  listeners.forEach((l) => l());
}

export function onSettings(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDownloadSettings(): DownloadSettings {
  return useSyncExternalStore(onSettings, getSettings, getSettings);
}
