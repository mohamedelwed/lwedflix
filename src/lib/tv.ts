/**
 * The TV app (android/): the hosted app in a WebView, with the desktop
 * shell's player bridge. Its injected script (android/app/src/main/assets/
 * shim.js) sets `window.lwedflixTv`; anywhere else it's missing.
 */

import { useSyncExternalStore } from 'react';

export interface TvShell {
  platform: 'android-tv';
  /** The installed TV app's version. */
  shellVersion: string;
  /** Opens the on-screen keyboard for the focused text field. */
  showKeyboard?(): void;
}

declare global {
  interface Window {
    lwedflixTv?: TvShell;
    /**
     * Called by the TV app when Back is pressed; true if the page handled it
     * (closed something), false to let the app go back a page.
     */
    __lwedflixTvBack?: () => boolean;
  }
}

export function getTvShell(): TvShell | null {
  return typeof window === 'undefined' ? null : window.lwedflixTv ?? null;
}

const noSubscribe = () => () => {};

/** Whether this is the TV app. Always false while rendering on the server. */
export function useIsTv(): boolean {
  return useSyncExternalStore(noSubscribe, () => getTvShell() !== null, () => false);
}
