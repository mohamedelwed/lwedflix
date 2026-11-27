import type { PlayerCommand, PlayerState } from '@shared/lib/desktopPlayer';

export type { PlayerCommand, PlayerState };

export interface PlayableMedia {
  type: 'movie' | 'tv';
  id: number;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  imdbId?: string | null;
  season?: number;
  episode?: number;
  episodeTitle?: string | null;
}

/** A media URL a player frame loaded (shim.js reports them), for downloads. */
export interface CapturedStream {
  url: string;
  type: string;
  size: number;
  /** The frame that loaded it: its URL is the Referer the server wants. */
  frame: string;
  /** The player's browser (its user agent): stream links are often tied to it. */
  ua?: string;
  at: number;
}

export interface PlayerHandle {
  command(command: PlayerCommand): void;
  /** Streams the current server has loaded, newest first. */
  streams(): CapturedStream[];
}
