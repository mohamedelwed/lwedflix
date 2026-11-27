import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { parsePlaylist, qualities as hlsQualities } from '@electron/hls';
import type { FileHandleLike } from '@electron/mp4';
import { classify, Registry, titleFor } from '@electron/streams';
import type { DownloadMeta, Quality, StreamOption } from '@shared/lib/downloads';
import type { CapturedStream } from '@/player/types';
import * as Network from 'expo-network';
import { DownloadError, saveHls } from './hlsJob.ts';
import { headerVariants, withPlaylistQuery } from './asking.ts';
import { getSettings, onSettings, WATCHING_SLOW } from './settings';
import { deleteDownload, getDownload, getDownloads, isActive, putDownload, updateDownload, type StoredDownload } from './store';

// Downloads on the phone, as electron/downloads.js does them on desktop:
// what the player streamed is saved as one ordinary MP4 (HLS segments
// decrypted, transmuxed with mux.js and written by electron/mp4.js), or a
// plain video file is fetched as is. Files live in the app's own storage
// and play offline (app/offline/[id].tsx).

const ATTEMPTS = 6;
const GONE = new Set([401, 403, 404, 410, 428]);
/** Times a download refused by its server looks for a fresh stream by itself. */
const FRESH_STREAM_TRIES = 2;
// What the servers see: the player's own browser. Stream links are often
// tied to it, so a download that says it's another browser is refused.
// Until a player reports its user agent (shim.js), a phone browser's.
let userAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv)(\?|#|$)/i;

// ---- Network: Wi-Fi only ------------------------------------------------------

let connected = true;
let onWifi = true;
function noteNetwork(state: { isConnected?: boolean | null; type?: Network.NetworkStateType | null }) {
  connected = state.isConnected !== false;
  onWifi = state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
  pump();
}
try {
  void Network.getNetworkStateAsync().then(noteNetwork, () => {});
  Network.addNetworkStateListener(noteNetwork);
} catch {
  // No network module (tests): always allowed.
}
/** Whether downloads may use the connection right now. */
export const networkAllowed = () => connected && (!getSettings().wifiOnly || onWifi) && !pausedForWatching();
/** Why queued downloads wait, for the list. */
export const waitingReason = (): string | null =>
  !connected ? 'Waiting for a connection' : getSettings().wifiOnly && !onWifi ? 'Waiting for Wi-Fi' : pausedForWatching() ? 'Waiting while you watch' : null;
onSettings(() => pump());

// ---- Speed limit: one budget for all downloads together ----------------------

// ---- Smart speed: something plays in Lwedflix -------------------------------

let watching = false;
/** The player says when it plays (PlayerView); downloads give way as the settings say. */
export function setWatching(playing: boolean) {
  if (watching === playing) return;
  watching = playing;
  pump();
}
const pausedForWatching = () => watching && getSettings().whileWatching === 'pause';

function currentLimit(): number {
  const { speedLimit, whileWatching } = getSettings();
  if (watching && whileWatching === 'slow') return speedLimit ? Math.min(speedLimit, WATCHING_SLOW) : WATCHING_SLOW;
  return speedLimit;
}

let freeAt = 0;
async function throttle(bytes: number) {
  const limit = currentLimit();
  if (!limit) {
    freeAt = 0;
    return;
  }
  const now = Date.now();
  freeAt = Math.max(freeAt, now - 1000) + (bytes * 1000) / limit;
  if (freeAt > now) await sleep(freeAt - now);
}


// ---- Streams the player loaded ---------------------------------------------

const registry = new Registry();

/** Called with every media URL a player frame loads (PlayerView's onStream). */
export function recordStream(stream: CapturedStream) {
  noteUserAgent(stream.ua);
  if (stream.type === 'element') return void recordElementSource(stream);
  let kind = classify(stream.url, stream.type, stream.size || undefined);
  // A <video src> assignment carries no headers; a video-looking URL there is the film.
  if (!kind && !stream.type && !stream.size && VIDEO_EXT.test(stream.url)) kind = 'file';
  if (!kind) return;
  registry.add({ frameUrl: stream.frame, url: stream.url, kind, size: stream.size || undefined, requestHeaders: headersFor(stream.frame) });
}

const probed = new Set<string>();

/**
 * What a <video> plays. Android's WebView plays HLS by itself, so those
 * requests never reach the frame's fetch or XHR: the URL may be all there
 * is. Its name says what it is, or its first bytes do.
 */
async function recordElementSource(stream: CapturedStream) {
  const add = (kind: 'hls' | 'file', size?: number) =>
    registry.add({ frameUrl: stream.frame, url: stream.url, kind, size, requestHeaders: headersFor(stream.frame) });
  if (/\.m3u8(\?|#|$)/i.test(stream.url)) return add('hls');
  if (probed.has(stream.url)) return;
  probed.add(stream.url);
  if (probed.size > 200) probed.clear();
  try {
    const res = await fetch(stream.url, { headers: { ...headersFor(stream.frame), Range: 'bytes=0-1023' } });
    if (!res.ok) return;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const head = Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 32)).toString('utf8');
    if (/^﻿?\s*#EXTM3U/.test(head) || /mpegurl/.test(type)) return add('hls');
    // A whole video, not a segment: "bytes 0-1023/123456789".
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]) || Number(res.headers.get('content-length')) || 0;
    if ((type.startsWith('video/') || VIDEO_EXT.test(stream.url)) && total >= 5 * 1024 * 1024) add('file', total);
  } catch {
    // Unreachable from here: nothing to offer.
  }
}

/** The player moved on (new title, episode or server). */
export function clearStreams() {
  registry.clear();
  probed.clear();
}

export function listStreams(): StreamOption[] {
  return registry.list();
}

/** The player's browser, as its frames report it. */
export function noteUserAgent(ua: string | undefined) {
  if (ua && /^Mozilla\//.test(ua)) userAgent = ua;
}

/** What the player itself sends with its requests: its browser, its page. */
function headersFor(frameUrl: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': userAgent, Accept: '*/*' };
  if (frameUrl) headers.Referer = frameUrl;
  return headers;
}


// ---- Files -------------------------------------------------------------------

const root = () => {
  const dir = new Directory(Paths.document, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
};

function safeName(text: string) {
  return (
    text
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Video'
  );
}

/** A file handle the desktop's Mp4Writer can write through (positioned writes). */
async function openForWriting(uri: string): Promise<FileHandleLike> {
  const file = new File(uri);
  if (file.exists) file.delete();
  file.create();
  const handle = file.open();
  return {
    async write(buf, offset, length, position) {
      // Mp4Writer awaits each write before the next, so offsets never interleave.
      handle.offset = position;
      await handle.writeBytes(buf.subarray(offset, offset + length));
      return { bytesWritten: length };
    },
    async close() {
      handle.close();
    },
  };
}

async function savePoster(id: string, posterPath: string | null) {
  if (!posterPath) return;
  try {
    const target = new File(root(), `${id}.jpg`);
    const saved = await File.downloadFileAsync(`https://image.tmdb.org/t/p/w342${posterPath}`, target, { idempotent: true });
    updateDownload(id, { posterUri: saved.uri, poster: saved.uri });
  } catch {
    // The list falls back to the title.
  }
}

// ---- Jobs --------------------------------------------------------------------

interface Source {
  url: string;
  kind: 'hls' | 'file';
  /** What's sent now: the first of `variants` the server accepted. */
  headers: Record<string, string>;
  variants?: Record<string, string>[];
}

interface Run {
  source: Source | null;
  variant?: number;
  controller: AbortController;
  paused: boolean;
  cancelled: boolean;
  waiters: (() => void)[];
  samples: [number, number][];
  startedAt: number;
  resumable?: LegacyFS.DownloadResumable;
  /** The hidden player this download runs in, once found. */
  session?: DownloadSession;
  /** Set once the server refused the app directly: every piece goes through the player. */
  viaPlayer?: boolean;
  /** Set once pieces only load with the playlist's query (its token) added. */
  inheritQuery?: boolean;
}

const runs = new Map<string, Run>();
let running = 0;

/** Finds a title's stream when its download's turn comes (EpisodeResolver). */
export interface ResolveTarget {
  mediaType: 'movie' | 'tv';
  mediaId: number;
  season: number;
  episode: number;
}
/** A hidden player kept open for one download (EpisodeResolver.tsx). */
export interface DownloadSession {
  stream: CapturedStream;
  /** Fetches through the player's own browser: what servers that refuse everyone else accept. */
  fetch(url: string, range?: { offset: number; length: number } | null): Promise<Uint8Array>;
  close(): void;
}
type SessionOpener = (target: ResolveTarget) => Promise<DownloadSession>;
let resolver: SessionOpener | null = null;
export function setSessionOpener(fn: SessionOpener | null) {
  resolver = fn;
  if (fn) pump();
}

function newRun(source: Source | null, variant?: number): Run {
  return { source, variant, controller: new AbortController(), paused: false, cancelled: false, waiters: [], samples: [], startedAt: Date.now() };
}

function newJob(meta: DownloadMeta, kind: 'hls' | 'file', target: StoredDownload['target']): StoredDownload {
  return {
    id: globalThis.crypto.randomUUID(),
    state: 'queued',
    kind,
    title: meta.title,
    mediaType: meta.mediaType,
    mediaId: meta.mediaId,
    season: meta.season ?? null,
    episode: meta.episode ?? null,
    showTitle: meta.showTitle ?? null,
    episodeTitle: meta.episodeTitle ?? null,
    posterPath: meta.posterPath ?? null,
    poster: null,
    quality: null,
    fileName: null,
    bytes: 0,
    totalBytes: null,
    duration: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    progress: 0,
    speed: 0,
    eta: null,
    target,
    fileUri: null,
    posterUri: null,
  };
}

/** The qualities an HLS stream offers (empty for a file or a single-quality stream). */
export async function streamQualities(streamId: string): Promise<Quality[]> {
  const item = registry.get(streamId);
  if (!item || item.kind !== 'hls') return [];
  const asking = { headers: item.requestHeaders };
  const text = Buffer.from(await fetchBytes(item.url, asking)).toString('utf8');
  item.requestHeaders = asking.headers; // what worked, for the download itself
  const playlist = parsePlaylist(text, item.url);
  if (!playlist.master) return [];
  return hlsQualities(playlist, 0).map((q) => ({ ...q, bytes: q.bytes }));
}

export function startDownload(streamId: string, options: { variant?: number; meta: DownloadMeta }): { ok: true; id: string } | { ok: false; error: string } {
  const item = registry.get(streamId);
  if (!item) return { ok: false, error: 'That stream has gone. Play the title again, then download it.' };
  if (item.kind === 'dash') return { ok: false, error: 'This server streams in a format Lwedflix can’t save yet. Try another server.' };
  const job = newJob(options.meta, item.kind, null);
  runs.set(job.id, newRun({ url: item.url, kind: item.kind, headers: item.requestHeaders }, options.variant));
  putDownload(job);
  void savePoster(job.id, job.posterPath);
  pump();
  return { ok: true, id: job.id };
}

/**
 * A movie or an episode that finds its own stream when its turn comes, in
 * an off-screen player: nobody needs to be watching. `later`: kept until
 * started from Downloads (startLater).
 */
export function enqueueTitle(meta: DownloadMeta, options: { height?: number | null; later?: boolean }): { ok: true; id: string } | { ok: false; error: string } {
  const exists = getDownloads().find(
    (d) => d.mediaType === meta.mediaType && d.mediaId === meta.mediaId && (d.season ?? 0) === (meta.season ?? 0) && (d.episode ?? 0) === (meta.episode ?? 0) && (isActive(d) || d.state === 'done')
  );
  if (exists) return { ok: false, error: exists.state === 'done' ? 'It’s already downloaded.' : 'It’s already in your downloads.' };
  const job = newJob(meta, 'hls', { season: meta.season ?? 0, episode: meta.episode ?? 0, height: options.height ?? null });
  job.held = !!options.later;
  runs.set(job.id, newRun(null));
  putDownload(job);
  void savePoster(job.id, job.posterPath);
  pump();
  return { ok: true, id: job.id };
}

/** Starts downloads kept for later (all of them without ids). */
export function startLater(ids?: string[]) {
  for (const d of getDownloads()) {
    if (!d.held || (ids && !ids.includes(d.id))) continue;
    if (!runs.has(d.id)) runs.set(d.id, newRun(null));
    updateDownload(d.id, { held: false });
  }
  pump();
}

/** Queues episodes; each finds its own stream when its turn comes. */
export function enqueueEpisodes(
  show: { title: string; mediaId: number; posterPath?: string | null },
  episodes: { season: number; episode: number; episodeTitle?: string }[],
  options: { height?: number | null; later?: boolean }
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const ep of episodes) {
    const exists = getDownloads().some(
      (d) => d.mediaType === 'tv' && d.mediaId === show.mediaId && d.season === ep.season && d.episode === ep.episode && (isActive(d) || d.state === 'done')
    );
    if (exists) {
      skipped++;
      continue;
    }
    const job = newJob(
      {
        title: titleFor({ title: show.title, type: 'tv', season: ep.season, episode: ep.episode }),
        mediaType: 'tv',
        mediaId: show.mediaId,
        season: ep.season,
        episode: ep.episode,
        showTitle: show.title,
        episodeTitle: ep.episodeTitle,
        posterPath: show.posterPath ?? undefined,
      },
      'hls',
      { season: ep.season, episode: ep.episode, height: options.height ?? null }
    );
    job.held = !!options.later;
    runs.set(job.id, newRun(null));
    putDownload(job);
    void savePoster(job.id, job.posterPath);
    added++;
  }
  pump();
  return { added, skipped };
}

export function pauseDownload(id: string) {
  const run = runs.get(id);
  const job = getDownload(id);
  if (!run || !job || !isActive(job)) return;
  run.paused = true;
  void run.resumable?.pauseAsync().catch(() => {});
  updateDownload(id, { state: 'paused', speed: 0, eta: null });
}

export function resumeDownload(id: string) {
  const run = runs.get(id);
  const job = getDownload(id);
  if (!run || !job || job.state !== 'paused') return;
  run.paused = false;
  run.samples = [];
  run.waiters.splice(0).forEach((w) => w());
  updateDownload(id, { state: run.source || job.target ? (job.bytes > 0 ? 'downloading' : 'queued') : 'queued' });
  if (run.resumable) {
    continueFile(id, run).catch(() => {
      runs.delete(id);
      updateDownload(id, { state: 'failed', error: 'The download failed. Play the title again, then download it.', speed: 0, eta: null });
    });
  }
  pump();
}

export function cancelDownload(id: string) {
  const run = runs.get(id);
  if (run) {
    run.cancelled = true;
    run.controller.abort();
    void run.resumable?.cancelAsync().catch(() => {});
    run.waiters.splice(0).forEach((w) => w());
  }
  removeFiles(id);
  deleteDownload(id);
}

export function removeDownload(id: string) {
  cancelDownload(id);
}

/** Where a download finds a fresh stream: its own title, in the off-screen player. */
const targetOf = (job: StoredDownload): NonNullable<StoredDownload['target']> | null =>
  job.target ?? (job.mediaId ? { season: job.season ?? 0, episode: job.episode ?? 0, height: null } : null);

/** A failed or interrupted download, again, with a fresh stream (stream links expire). */
export function retryDownload(id: string) {
  const job = getDownload(id);
  if (!job || isActive(job) || job.state === 'done') return false;
  const target = targetOf(job);
  if (!target) return false;
  removeFiles(id, true);
  runs.set(id, newRun(null));
  putDownload({ ...job, target, state: 'queued', held: false, tries: 0, error: null, bytes: 0, progress: 0, fileUri: null, finishedAt: null });
  pump();
  return true;
}

function removeFiles(id: string, keepPoster = false) {
  const job = getDownload(id);
  for (const uri of [job?.fileUri, keepPoster ? null : job?.posterUri]) {
    if (!uri) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  }
}

/** On launch: unfinished downloads from last time. Their signed URLs are dead. */
export async function resumeDownloads() {
  for (const job of getDownloads()) {
    if (isActive(job)) {
      if (job.fileUri) removeFiles(job.id, true);
      const target = targetOf(job);
      if (target) {
        // Starts over with a fresh stream.
        runs.set(job.id, newRun(null));
        putDownload({ ...job, target, state: 'queued', bytes: 0, progress: 0, fileUri: null, speed: 0, eta: null });
      } else {
        putDownload({ ...job, state: 'interrupted', error: 'Lwedflix was closed before this finished.', speed: 0, eta: null });
      }
    } else if (job.state === 'done' && job.fileUri && !new File(job.fileUri).exists) {
      putDownload({ ...job, state: 'missing' });
    }
  }
  pump();
}

function pump() {
  if (!networkAllowed()) return;
  while (running < getSettings().parallel) {
    const next = [...getDownloads()].reverse().find((d) => d.state === 'queued' && !d.held && runs.has(d.id) && (runs.get(d.id)!.source || (d.target && resolver)));
    if (!next) return;
    running++;
    void runJob(next.id).finally(() => {
      running--;
      pump();
    });
  }
}

async function runJob(id: string) {
  const run = runs.get(id)!;
  try {
    if (!run.source) {
      const job = getDownload(id)!;
      updateDownload(id, { state: 'resolving' });
      const session = await resolver!({ mediaType: job.mediaType === 'movie' ? 'movie' : 'tv', mediaId: job.mediaId!, season: job.target!.season, episode: job.target!.episode });
      if (run.cancelled) return void session.close();
      run.session = session;
      const found = session.stream;
      noteUserAgent(found.ua);
      const kind = classify(found.url, found.type, found.size || undefined);
      run.source = { url: found.url, kind: kind === 'file' ? 'file' : 'hls', headers: headersFor(found.frame) };
      updateDownload(id, { kind: run.source.kind });
    }
    if (run.cancelled) return;
    updateDownload(id, { state: run.paused ? 'paused' : 'downloading' });
    if (run.source.kind === 'hls') await downloadHls(id, run);
    else await downloadFile(id, run);
  } catch (err) {
    const job = getDownload(id);
    if (run.cancelled || !job) return;
    removeFiles(id, true);
    // Refused or broken off: look for a fresh stream by itself, a couple of times.
    const target = targetOf(job);
    const tries = (job.tries ?? 0) + 1;
    if (target && tries <= FRESH_STREAM_TRIES) {
      runs.set(id, newRun(null));
      updateDownload(id, { target, tries, state: 'queued', bytes: 0, progress: 0, speed: 0, eta: null, fileUri: null });
      return;
    }
    const message = err instanceof DownloadError ? err.message : 'The download failed. Check your connection, then tap retry.';
    updateDownload(id, { state: 'failed', error: message, speed: 0, eta: null, fileUri: null });
  } finally {
    const state = getDownload(id)?.state;
    // A paused download keeps its player; anything else is done with it.
    if (state !== 'paused') {
      run.session?.close();
      run.session = undefined;
    }
    if (state !== 'paused' && state !== 'queued') runs.delete(id);
  }
}

function tick(id: string, run: Run, bytes: number, progress: number) {
  const now = Date.now();
  run.samples.push([now, bytes]);
  while (run.samples.length > 2 && now - run.samples[0][0] > 8000) run.samples.shift();
  const [then, before] = run.samples[0];
  const speed = now > then ? Math.round(((bytes - before) * 1000) / (now - then)) : 0;
  const elapsed = now - run.startedAt;
  const eta = progress > 0.005 ? Math.round((elapsed * (1 - progress)) / progress / 1000) : null;
  updateDownload(id, { bytes, progress, speed, eta });
}

/** Waits while the download is paused, or while it may not use the connection (Wi-Fi only). */
async function gate(run: Run): Promise<void> {
  while (!run.cancelled && (run.paused || !networkAllowed())) {
    if (run.paused) await new Promise<void>((resolve) => run.waiters.push(resolve));
    else await sleep(2000);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the server';
  }
};

/**
 * One request, retried; a refusal tries the other ways of asking first
 * (headerVariants), and the one that works is kept for the rest.
 */
async function fetchBytes(
  url: string,
  asking: { headers: Record<string, string>; variants?: Record<string, string>[] },
  range?: { offset: number; length: number } | null,
  signal?: AbortSignal
): Promise<Uint8Array> {
  asking.variants ??= headerVariants(asking.headers);
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');
    try {
      const res = await fetch(url, {
        headers: range ? { ...asking.headers, Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : asking.headers,
        signal,
      });
      if (!res.ok) {
        if (GONE.has(res.status)) {
          const next = asking.variants[asking.variants.indexOf(asking.headers) + 1];
          if (next) {
            asking.headers = next;
            attempt--; // another way of asking isn't a failed attempt
            continue;
          }
          if (attempt >= 1) throw new DownloadError(`The server refused the download (error ${res.status} from ${hostOf(url)}). Tap retry to try a fresh stream, or download from another server.`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await throttle(bytes.length);
      return bytes;
    } catch (err) {
      if (err instanceof DownloadError) throw err;
      lastError = err;
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed');
}

/**
 * One piece of a download: straight from the server while it lets the app,
 * through the hidden player once it doesn't (and from then on).
 */
async function getPiece(run: Run, url: string, range?: { offset: number; length: number } | null): Promise<Uint8Array> {
  // The player adds the playlist's token to every piece; so do we, once that's what works.
  const tokened = withPlaylistQuery(url, run.source!.url);
  if (run.inheritQuery && tokened) url = tokened;
  if (run.session && run.viaPlayer) return viaPlayer(run, url, range);
  try {
    return await fetchBytes(url, run.source!, range, run.controller.signal);
  } catch (err) {
    if (run.cancelled) throw err;
    if (tokened && !run.inheritQuery) {
      try {
        // Every way of asking again, from the first: the token may be all that was missing.
        const source = run.source!;
        const asking = { headers: (source.variants ?? [source.headers])[0], variants: source.variants };
        const bytes = await fetchBytes(tokened, asking, range, run.controller.signal);
        source.headers = asking.headers;
        run.inheritQuery = true;
        return bytes;
      } catch {
        // Not that either: through the player.
      }
    }
    if (!run.session) throw err;
    run.viaPlayer = true;
    return viaPlayer(run, tokened ?? url, range);
  }
}

async function viaPlayer(run: Run, url: string, range?: { offset: number; length: number } | null): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (run.cancelled) throw new Error('cancelled');
    try {
      const bytes = await run.session!.fetch(url, range);
      await throttle(bytes.length);
      return bytes;
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status ?? 0;
      if (GONE.has(status) && attempt >= 2) {
        throw new DownloadError(`The server refused the download (error ${status} from ${hostOf(url)}), even through the player. Tap retry to try a fresh stream, or try another server.`);
      }
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed');
}

async function downloadHls(id: string, run: Run) {
  const source = run.source!;
  const signal = run.controller.signal;
  const job = getDownload(id)!;
  const file = new File(root(), `${safeName(job.title)}-${id.slice(0, 8)}.mp4`);
  updateDownload(id, { fileUri: file.uri, fileName: file.name });
  const result = await saveHls(source.url, file.uri, {
    variant: run.variant,
    maxHeight: job.target?.height ?? null,
    get: (url, range) => getPiece(run, url, range),
    open: openForWriting,
    gate: () => gate(run),
    cancelled: () => run.cancelled,
    onQuality: (quality) => updateDownload(id, { quality }),
    onDuration: (duration) => updateDownload(id, { duration: Math.round(duration) }),
    onProgress: (bytes, fraction) => tick(id, run, bytes, fraction),
  });
  if (!result) return; // cancelled
  updateDownload(id, { state: 'done', progress: 1, speed: 0, eta: null, finishedAt: Date.now(), bytes: new File(file.uri).size ?? result.bytes, totalBytes: null });
}

async function downloadFile(id: string, run: Run) {
  const source = run.source!;
  const job = getDownload(id)!;
  const ext = source.url.match(VIDEO_EXT)?.[1]?.toLowerCase() ?? 'mp4';
  const file = new File(root(), `${safeName(job.title)}-${id.slice(0, 8)}.${ext}`);
  updateDownload(id, { fileUri: file.uri, fileName: file.name });
  // One byte first, to find the way of asking the server accepts.
  try {
    await fetchBytes(source.url, source, { offset: 0, length: 1 }, run.controller.signal);
  } catch (err) {
    if (!run.session) throw err;
    return downloadFileViaPlayer(id, run, file);
  }
  run.resumable = LegacyFS.createDownloadResumable(source.url, file.uri, { headers: source.headers }, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : null;
    if (total) updateDownload(id, { totalBytes: total });
    tick(id, run, totalBytesWritten, total ? Math.min(0.999, totalBytesWritten / total) : 0);
  });
  await continueFile(id, run, true);
}

/** Starts or resumes a plain file's transfer; settles the job when it ends. */
async function continueFile(id: string, run: Run, first = false) {
  const resumable = run.resumable!;
  const result = first ? await resumable.downloadAsync() : await resumable.resumeAsync();
  if (run.cancelled || run.paused || !result) return; // paused: resumeDownload() calls back in
  if (result.status >= 400) throw new DownloadError('The server stopped serving this file. Play it again in the player, then download it.');
  const size = new File(result.uri).size ?? 0;
  updateDownload(id, { state: 'done', progress: 1, speed: 0, eta: null, finishedAt: Date.now(), bytes: size, totalBytes: size });
}

const FILE_CHUNK = 4 * 1024 * 1024;

/** A plain file the server only gives the player: fetched through it in 4 MB pieces. */
async function downloadFileViaPlayer(id: string, run: Run, file: File) {
  run.viaPlayer = true;
  const handle = await openForWriting(file.uri);
  let offset = 0;
  try {
    for (;;) {
      await gate(run);
      if (run.cancelled) return;
      const piece = await viaPlayer(run, run.source!.url, { offset, length: FILE_CHUNK });
      await handle.write(piece, 0, piece.length, offset);
      offset += piece.length;
      tick(id, run, offset, 0);
      if (piece.length < FILE_CHUNK) break;
    }
  } finally {
    await handle.close();
  }
  updateDownload(id, { state: 'done', progress: 1, speed: 0, eta: null, finishedAt: Date.now(), bytes: offset, totalBytes: offset });
}
