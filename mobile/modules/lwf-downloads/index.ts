import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// The download notification and background service (Android). Missing on
// iOS and in tests: every call is then a no-op.

interface LwfDownloadsNative {
  show(title: string, text: string, percent: number, indeterminate: boolean, paused: boolean): void;
  hide(): void;
  notify(key: string, title: string, text: string): void;
  getBrightness(): number;
  setBrightness(value: number): void;
  resetBrightness(): void;
  getVolume(): number;
  setVolume(value: number): number;
  addListener(event: 'onAction', listener: (e: { action: 'pause' | 'resume' | 'cancel' }) => void): EventSubscription;
}

export const LwfDownloads = requireOptionalNativeModule<LwfDownloadsNative>('LwfDownloads');
