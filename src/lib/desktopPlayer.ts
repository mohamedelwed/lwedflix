/**
 * The player bridge (electron/preload.js).
 *
 * A preload runs inside the embedded player's cross-origin frames, finds the
 * stream's <video>, reports its state and applies play/pause/seek — the one
 * thing a browser forbids a web page from doing. It only exists inside the
 * app: under `npm run dev` in a browser `window.lwedflixPlayer` is missing,
 * and the player simply isn't synced.
 */

export type PlayerEvent =
  | 'play'
  | 'pause'
  | 'seeked'
  | 'timeupdate'
  | 'progress'
  | 'loadedmetadata'
  | 'ended'
  | 'volumechange'
  | 'ratechange'
  | 'waiting'
  | 'playing'
  /** The subtitle tracks, or which one is showing, changed. */
  | 'tracks'
  /** Asked for with the 'report' command. */
  | 'status';

export interface PlayerState {
  /** The media event behind this report. */
  event: PlayerEvent;
  playing: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  muted: boolean;
  /** 0–1. */
  volume: number;
  /** Playback speed. */
  rate: number;
  /** Seconds: where the buffered stretch around the playhead ends. */
  buffered: number;
  /** Meant to be playing, but waiting for data. */
  buffering: boolean;
  /** Subtitle tracks the stream carries itself (not ones a server draws on its own). */
  tracks: { label: string; language: string }[];
  /** Index into `tracks` of the one showing; -1 for none. */
  track: number;
}

export type PlayerCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'toggle' }
  | { action: 'seek'; time: number }
  /** Relative, in seconds; up to ±600. */
  | { action: 'seekBy'; delta: number }
  | { action: 'toggleMute' }
  /** Ask the player for its state now (a paused one reports nothing on its own). */
  | { action: 'report' }
  | { action: 'setMuted'; muted: boolean }
  /** 0–1; above 0 also unmutes. */
  | { action: 'setVolume'; volume: number }
  /** 0.25–4. */
  | { action: 'setRate'; rate: number }
  /** Index into PlayerState.tracks; -1 turns subtitles off. */
  | { action: 'setTrack'; index: number }
  /** Raise subtitles this many pixels, clear of controls drawn over the video. */
  | { action: 'liftSubtitles'; px: number }
  /**
   * Hide the server's own player UI, leaving only the picture, so the app's
   * controls can stand in for it — or bring it back.
   */
  | { action: 'clean'; on: boolean }
  /** Picture-in-picture: the stream in a small always-on-top window. */
  | { action: 'pip' };

/**
 * The server can't play this title: it said so on screen ('unavailable'), or
 * its video failed before playing ('error').
 */
export interface PlayerProblem {
  reason: 'unavailable' | 'error';
}

/** A shortcut pressed while keyboard focus was inside the player. */
export interface PlayerShortcut {
  key: 'f';
}

export interface DesktopPlayer {
  /**
   * Called on every play, pause, seek and end, and about once a second while
   * playing. `null` means the stream went away (page left, server switched).
   * Returns an unsubscribe function.
   */
  onState(callback: (state: PlayerState | null) => void): () => void;
  onProblem(callback: (problem: PlayerProblem) => void): () => void;
  onShortcut(callback: (shortcut: PlayerShortcut) => void): () => void;
  /** Dropped if no stream has reported yet. */
  command(command: PlayerCommand): void;
  /**
   * The next stream to load starts on its own (Up next): the bridge plays
   * its <video>, pressing the server's play button if it needs one.
   */
  autoplay?(): void;
}

declare global {
  interface Window {
    lwedflixPlayer?: DesktopPlayer;
  }
}

export function getDesktopPlayer(): DesktopPlayer | null {
  return typeof window === 'undefined' ? null : window.lwedflixPlayer ?? null;
}
