/**
 * Downloads (electron/downloads.js, through electron/preload.js).
 *
 * The player's Download button saves what the embedded player is streaming,
 * and the Downloads page lists and plays what's saved — offline too: files
 * and posters are served by the app itself at lwedflix-media://. Only exists
 * inside the app; under `npm run dev` in a browser `window.lwedflixDownloads`
 * is missing and both say so.
 */

import { useSyncExternalStore } from 'react';

export type StreamKind = 'hls' | 'dash' | 'file';

/** A stream the player loaded, as the Download menu lists it. */
export interface StreamOption {
  id: string;
  kind: StreamKind;
  /** `<last path segment> · <size> · <host>`. */
  label: string;
  /** What it is, for people: "Stream · 1080p", "Video file", "DASH stream". */
  title: string;
  /** Size (files only) and host. */
  detail: string;
  quality: string | null;
  size?: number;
  host: string;
  /** How long ago it was captured; signed URLs go stale. */
  ageMs: number;
  /** DASH is listed but can't be downloaded yet. */
  supported: boolean;
  /** The one most likely to be the film itself (listed first). */
  best: boolean;
}

/** A quality an HLS stream comes in. */
export interface Quality {
  /** What to pass back to start(). */
  index: number;
  label: string;
  height: number;
  /** Estimated file size. */
  bytes: number | null;
  /** False when its sound is a separate stream, which can't be saved yet. */
  supported: boolean;
}

export type DownloadState = 'queued' | 'resolving' | 'downloading' | 'paused' | 'done' | 'failed' | 'interrupted' | 'missing';

export interface Download {
  id: string;
  state: DownloadState;
  kind: 'hls' | 'file';
  title: string;
  mediaType: 'movie' | 'tv';
  mediaId: number | null;
  season: number | null;
  episode: number | null;
  showTitle: string | null;
  episodeTitle: string | null;
  posterPath: string | null;
  /** Set once the poster is saved locally; see posterUrl(). */
  poster: string | null;
  quality: string | null;
  fileName: string | null;
  bytes: number;
  totalBytes: number | null;
  /** Seconds of video. */
  duration: number | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  /** 0–1. */
  progress: number;
  /** Bytes a second. */
  speed: number;
  /** Seconds left, roughly. */
  eta: number | null;
  /** Set for an episode queued from a season: it finds its own stream, so it can be retried. */
  target: { season: number; episode: number; height: number | null } | null;
}

export interface DownloadMeta {
  title: string;
  mediaType: 'movie' | 'tv';
  mediaId: number;
  season?: number;
  episode?: number;
  showTitle?: string;
  episodeTitle?: string;
  posterPath?: string;
}

export interface DownloadsBridge {
  streams(origins: string[]): Promise<StreamOption[]>;
  qualities(streamId: string): Promise<Quality[]>;
  start(streamId: string, options: { variant?: number; meta: DownloadMeta }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  list(): Promise<Download[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** Queues episodes (a season, or all of them); each finds its stream when its turn comes. */
  enqueue(
    show: { title: string; mediaId: number; posterPath?: string },
    episodes: { season: number; episode: number; episodeTitle?: string }[],
    options: { height?: number | null; provider?: string },
  ): Promise<{ added: number; skipped: number }>;
  retry(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string, deleteFile: boolean): Promise<void>;
  reveal(id: string): Promise<void>;
  openFolder(): Promise<void>;
  onChange(callback: (downloads: Download[]) => void): () => void;
}

declare global {
  interface Window {
    lwedflixDownloads?: DownloadsBridge;
  }
}

export function getDownloadsBridge(): DownloadsBridge | null {
  return typeof window === 'undefined' ? null : window.lwedflixDownloads ?? null;
}

/** Where a downloaded file plays from. */
export const mediaUrl = (id: string) => `lwedflix-media://file/${encodeURIComponent(id)}`;
export const posterUrl = (id: string) => `lwedflix-media://poster/${encodeURIComponent(id)}`;

export const isActive = (d: Download) => d.state === 'queued' || d.state === 'resolving' || d.state === 'downloading' || d.state === 'paused';

// One subscription for the whole page: the sidebar's badge, the Downloads
// page and the player's button all read the same list.
let snapshot: { list: Download[]; loaded: boolean } = { list: [], loaded: false };
const SERVER_SNAPSHOT = { list: [] as Download[], loaded: false };
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function publish(list: Download[]) {
  snapshot = { list: Array.isArray(list) ? list : [], loaded: true };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const bridge = getDownloadsBridge();
    if (bridge) {
      unsubscribe = bridge.onChange(publish);
      bridge.list().then(publish).catch(() => {});
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
    }
  };
}

const noSubscribe = () => () => {};
const hasBridge = () => getDownloadsBridge() !== null;

/** The download list, kept up to date; `available` is false outside the app. */
export function useDownloads() {
  const available = useSyncExternalStore(noSubscribe, hasBridge, () => false);
  const { list, loaded } = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  return { available, downloads: list, loaded };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 && unit > 1 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/** "S01E03". */
export const episodeCode = (d: Pick<Download, 'season' | 'episode'>) =>
  `S${String(d.season ?? 1).padStart(2, '0')}E${String(d.episode ?? 1).padStart(2, '0')}`;
