import { useSyncExternalStore } from 'react';

// The player's own settings, kept on the phone (the settings panel's More tab).

export interface PlayerSettings {
  /** Double-tap to skip and the brightness/volume swipes. */
  gestures: boolean;
}

const KEY = 'lwedflix:player-settings';
const DEFAULTS: PlayerSettings = { gestures: true };
let current: PlayerSettings | null = null;
const listeners = new Set<() => void>();

export function getPlayerSettings(): PlayerSettings {
  if (!current) {
    try {
      current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
      current = { ...DEFAULTS };
    }
  }
  return current!;
}

export function setPlayerSettings(patch: Partial<PlayerSettings>) {
  current = { ...getPlayerSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Kept for this session.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function usePlayerSettings(): PlayerSettings {
  return useSyncExternalStore(subscribe, getPlayerSettings, getPlayerSettings);
}
