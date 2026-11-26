import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import aesjs from 'aes-js';
import muxjs from 'mux.js';
import { ivFor, parsePlaylist, pickVariant, qualities as hlsQualities, tsStart, type Segment } from '@electron/hls';
import { Mp4Writer, parseFragments, parseInit, type FileHandleLike, type Init } from '@electron/mp4';
import { classify, Registry, titleFor } from '@electron/streams';
import type { DownloadMeta, Quality, StreamOption } from '@shared/lib/downloads';
import type { CapturedStream } from '@/player/types';
import { deleteDownload, getDownload, getDownloads, isActive, putDownload, updateDownload, type StoredDownload } from './store';

// Downloads on the phone, as electron/downloads.js does them on desktop:
// what the player streamed is saved as one ordinary MP4 (HLS segments
// decrypted, transmuxed with mux.js and written by electron/mp4.js), or a
// plain video file is fetched as is. Files live in the app's own storage
// and play offline (app/offline/[id].tsx).

const RUNNING = 2; // downloads at once; the rest wait
const WORKERS = 4; // segments fetched at once, per download
const AHEAD = 16; // segments fetched beyond the one being written
const ATTEMPTS = 6;
const GONE = new Set([401, 403, 404, 410, 428]);
// What the servers see: a phone's browser, like the player's WebView.
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv)(\?|#|$)/i;

class DownloadError extends Error {}

// ---- Streams the player loaded ---------------------------------------------

const registry = new Registry();

/** Called with every media URL a player frame loads (PlayerView's onStream). */
export function recordStream(stream: CapturedStream) {
  let kind = classify(stream.url, stream.type, stream.size || undefined);
  // A <video src> assignment carries no headers; a video-looking URL there is the film.
  if (!kind && !stream.type && !stream.size && VIDEO_EXT.test(stream.url)) kind = 'file';
  if (!kind) return;
  registry.add({ frameUrl: stream.frame, url: stream.url, kind, size: stream.size || undefined, requestHeaders: headersFor(stream.frame) });
}

/** The player moved on (new title, episode or server). */
export function clearStreams() {
  registry.clear();
}

export function listStreams(): StreamOption[] {
  return registry.list();
}

function headersFor(frameUrl: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*' };
  if (frameUrl) {
    try {
      headers.Referer = frameUrl;
      headers.Origin = new URL(frameUrl).origin;
    } catch {
      // No usable frame URL: send without.
    }
  }
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
      handle.offset = position;
      handle.writeBytes(buf.subarray(offset, offset + length));
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
  headers: Record<string, string>;
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
}

const runs = new Map<string, Run>();
let running = 0;

/** Finds the stream for a season's episode when its turn comes (EpisodeResolver). */
type Resolver = (target: { mediaId: number; season: number; episode: number }) => Promise<CapturedStream>;
let resolver: Resolver | null = null;
export function setEpisodeResolver(fn: Resolver | null) {
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
  const text = Buffer.from(await fetchBytes(item.url, item.requestHeaders)).toString('utf8');
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

/** Queues episodes; each finds its own stream when its turn comes. */
export function enqueueEpisodes(
  show: { title: string; mediaId: number; posterPath?: string | null },
  episodes: { season: number; episode: number; episodeTitle?: string }[],
  options: { height?: number | null }
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
  if (run.resumable) void continueFile(id, run);
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

/** A failed or interrupted download, again: a season's episode finds a fresh stream. */
export function retryDownload(id: string) {
  const job = getDownload(id);
  if (!job || isActive(job) || job.state === 'done') return false;
  if (!job.target) return false; // a stream's signed URL is long dead: play it again instead
  removeFiles(id, true);
  runs.set(id, newRun(null));
  putDownload({ ...job, state: 'queued', error: null, bytes: 0, progress: 0, fileUri: null, finishedAt: null });
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
      if (job.target) {
        runs.set(job.id, newRun(null));
        putDownload({ ...job, state: 'queued', bytes: 0, progress: 0, fileUri: null, speed: 0, eta: null });
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
  while (running < RUNNING) {
    const next = [...getDownloads()].reverse().find((d) => d.state === 'queued' && runs.has(d.id) && (runs.get(d.id)!.source || (d.target && resolver)));
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
      const found = await resolver!({ mediaId: job.mediaId!, season: job.target!.season, episode: job.target!.episode });
      const kind = classify(found.url, found.type, found.size || undefined);
      run.source = { url: found.url, kind: kind === 'file' ? 'file' : 'hls', headers: headersFor(found.frame) };
      updateDownload(id, { kind: run.source.kind });
    }
    if (run.cancelled) return;
    updateDownload(id, { state: run.paused ? 'paused' : 'downloading' });
    if (run.source.kind === 'hls') await downloadHls(id, run);
    else await downloadFile(id, run);
  } catch (err) {
    if (run.cancelled || !getDownload(id)) return;
    removeFiles(id, true);
    const message = err instanceof DownloadError ? err.message : 'The download failed. Check your connection, then play the title again and download it.';
    updateDownload(id, { state: 'failed', error: message, speed: 0, eta: null, fileUri: null });
  } finally {
    if (getDownload(id)?.state !== 'paused') runs.delete(id);
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

function gate(run: Run): Promise<void> {
  return run.paused ? new Promise((resolve) => run.waiters.push(resolve)) : Promise.resolve();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBytes(url: string, headers: Record<string, string>, range?: { offset: number; length: number } | null, signal?: AbortSignal): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');
    try {
      const res = await fetch(url, {
        headers: range ? { ...headers, Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : headers,
        signal,
      });
      if (!res.ok) {
        if (GONE.has(res.status) && attempt >= 1) {
          throw new DownloadError('The server stopped serving this stream. Play it again in the player, then download it.');
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof DownloadError) throw err;
      lastError = err;
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed');
}

function decryptAes128(bytes: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const cbc = new aesjs.ModeOfOperation.cbc(Array.from(key), Array.from(iv));
  const out = cbc.decrypt(bytes.length % 16 === 0 ? bytes : bytes.subarray(0, bytes.length - (bytes.length % 16)));
  const pad = out[out.length - 1];
  return pad > 0 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
}

const qualityOfWidth = (width: number) =>
  width >= 3800 ? '2160p' : width >= 1900 ? '1080p' : width >= 1260 ? '720p' : width >= 840 ? '480p' : width >= 600 ? '360p' : null;

async function downloadHls(id: string, run: Run) {
  const source = run.source!;
  const signal = run.controller.signal;
  const get = (url: string, range?: { offset: number; length: number } | null) => fetchBytes(url, source.headers, range, signal);

  let playlist = parsePlaylist(Buffer.from(await get(source.url)).toString('utf8'), source.url);
  if (playlist.master) {
    const job = getDownload(id)!;
    const variant = pickVariant(playlist, run.variant, job.target?.height);
    if (!variant) throw new DownloadError('This server keeps the sound in a separate stream, which Lwedflix can’t download yet. Try another server.');
    updateDownload(id, { quality: variant.height ? `${variant.height}p` : null });
    playlist = parsePlaylist(Buffer.from(await get(variant.url)).toString('utf8'), variant.url);
  }
  const segments = playlist.segments;
  if (segments.length === 0 || !(playlist.duration > 0)) throw new DownloadError('The stream has nothing in it. Try another server.');

  const job = getDownload(id)!;
  const file = new File(root(), `${safeName(job.title)}-${id.slice(0, 8)}.mp4`);
  updateDownload(id, { duration: Math.round(playlist.duration), fileUri: file.uri, fileName: file.name });

  const writer = await Mp4Writer.create(file.uri, openForWriting);
  let init: Init | null = null;
  const noteQuality = (tracks: Init) => {
    const width = tracks.tracks.find((t) => t.handler === 'vide')?.width ?? 0;
    if (!getDownload(id)?.quality && width) updateDownload(id, { quality: qualityOfWidth(width) });
  };
  if (playlist.map) {
    init = parseInit(Buffer.from(await get(playlist.map.url, playlist.map.range)));
    writer.setTracks(init);
    noteQuality(init);
  }
  const transmuxer = init ? null : new muxjs.mp4.Transmuxer({ remux: true });
  const produced: { initSegment: Uint8Array; data: Uint8Array }[] = [];
  transmuxer?.on('data', (segment: { initSegment: Uint8Array; data: Uint8Array }) => produced.push(segment));

  const keys = new Map<string, Promise<Uint8Array>>();
  const decrypt = async (segment: Segment, bytes: Uint8Array) => {
    if (!segment.key) return bytes;
    if (segment.key.method !== 'AES-128' || !segment.key.uri) throw new DownloadError('This stream is protected in a way Lwedflix can’t save. Try another server.');
    if (!keys.has(segment.key.uri)) keys.set(segment.key.uri, get(segment.key.uri));
    return decryptAes128(bytes, await keys.get(segment.key.uri)!, ivFor(segment));
  };
  const write = async (segment: Segment, raw: Uint8Array) => {
    const bytes = Buffer.from(await decrypt(segment, raw));
    if (!transmuxer) return writer.addRuns(parseFragments(bytes, init));
    const start = tsStart(bytes);
    if (start < 0) throw new DownloadError('The server sent something that isn’t video. Try another server.');
    transmuxer.push(bytes.subarray(start));
    transmuxer.flush();
    for (const out of produced.splice(0)) {
      if (!init) {
        init = parseInit(Buffer.from(out.initSegment));
        writer.setTracks(init);
        noteQuality(init);
      }
      await writer.addRuns(parseFragments(Buffer.from(out.data), init));
    }
  };

  // Fetched in parallel, written in order.
  const ready = new Map<number, Uint8Array>();
  let next = 0;
  let written = 0;
  let seconds = 0;
  let failure: unknown = null;
  const wake: (() => void)[] = [];
  const signalAll = () => wake.splice(0).forEach((w) => w());

  const worker = async () => {
    while (!failure && !run.cancelled) {
      await gate(run);
      if (failure || run.cancelled || next >= segments.length) return;
      if (next - written >= AHEAD) {
        await Promise.race([new Promise<void>((r) => wake.push(r)), sleep(250)]);
        continue;
      }
      const i = next++;
      try {
        ready.set(i, await get(segments[i].url, segments[i].range));
        signalAll();
      } catch (err) {
        failure ??= err;
        signalAll();
        return;
      }
    }
  };

  const writerLoop = async () => {
    while (!failure && !run.cancelled && written < segments.length) {
      const bytes = ready.get(written);
      if (!bytes) {
        await Promise.race([new Promise<void>((r) => wake.push(r)), sleep(250)]);
        continue;
      }
      ready.delete(written);
      try {
        await write(segments[written], bytes);
      } catch (err) {
        failure ??= err;
        signalAll();
        return;
      }
      seconds += segments[written].duration;
      written++;
      tick(id, run, writer.offset, Math.min(0.999, seconds / playlist.duration));
      signalAll();
    }
  };

  try {
    await Promise.all([...Array.from({ length: WORKERS }, worker), writerLoop()]);
    if (run.cancelled) {
      await writer.abort();
      return;
    }
    if (failure) throw failure;
    await writer.finish();
  } catch (err) {
    await writer.abort();
    throw err;
  }
  updateDownload(id, { state: 'done', progress: 1, speed: 0, eta: null, finishedAt: Date.now(), bytes: new File(file.uri).size ?? writer.offset, totalBytes: null });
}

async function downloadFile(id: string, run: Run) {
  const source = run.source!;
  const job = getDownload(id)!;
  const ext = source.url.match(VIDEO_EXT)?.[1]?.toLowerCase() ?? 'mp4';
  const file = new File(root(), `${safeName(job.title)}-${id.slice(0, 8)}.${ext}`);
  updateDownload(id, { fileUri: file.uri, fileName: file.name });
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
