import { LwfDownloads } from '@/modules/lwf-downloads';

// The player's brightness and volume swipes (GestureLayer.tsx): this
// screen's brightness, and the phone's media volume. Without the native
// module (iOS for now, tests) they do nothing and report middle values.

/** 0–1: the player's own brightness if set, otherwise the phone's. */
export function getBrightness(): number {
  try {
    return LwfDownloads?.getBrightness() ?? 0.5;
  } catch {
    return 0.5;
  }
}

/** This screen only; the phone's brightness setting is untouched. */
export function setBrightness(value: number): void {
  try {
    LwfDownloads?.setBrightness(value);
  } catch {
    // Not now.
  }
}

/** Back to the phone's own brightness (the player closed or left fullscreen). */
export function resetBrightness(): void {
  try {
    LwfDownloads?.resetBrightness();
  } catch {
    // Nothing to undo.
  }
}

/** The phone's media volume, 0–1. */
export function getVolume(): number {
  try {
    return LwfDownloads?.getVolume() ?? 0.5;
  } catch {
    return 0.5;
  }
}

/** Sets the media volume; returns what the phone actually took. */
export function setVolume(value: number): number {
  try {
    return LwfDownloads?.setVolume(value) ?? value;
  } catch {
    return getVolume();
  }
}
