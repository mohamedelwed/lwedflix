import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { parsePlaylist, qualities as hlsQualities } from '@electron/hls';
import type { FileHandleLike } from '@electron/mp4';
import { classify, Registry, titleFor } from '@electron/streams';
import type { DownloadMeta, Quality, StreamOption } from '@shared/lib/downloads';
import type { CapturedStream } from '@/player/types';
import { DownloadError, saveHls } from './hlsJob.ts';
import { deleteDownload, getDownload, getDownloads, isActive, putDownload, updateDownload, type StoredDownload } from './store';

// Downloads on the phone, as electron/downloads.js does them on desktop:
// what the player streamed is saved as one ordinary MP4 (HLS segments
// decrypted, transmuxed with mux.js and written by electron/mp4.js), or a
// plain video file is fetched as is. Files live in the app's own storage
// and play offline (app/offline/[id].tsx).

const RUNNING = 2; // downloads at once; the rest wait
const ATTEMPTS = 6;
const GONE = new Set([401, 403, 404, 410, 428]);
// What the servers see: a phone's browser, like the player's WebView.
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv)(\?|#|$)/i;


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

async function downloadHls(id: string, run: Run) {
  const source = run.source!;
  const signal = run.controller.signal;
  const job = getDownload(id)!;
  const file = new File(root(), `${safeName(job.title)}-${id.slice(0, 8)}.mp4`);
  updateDownload(id, { fileUri: file.uri, fileName: file.name });
  const result = await saveHls(source.url, file.uri, {
    variant: run.variant,
    maxHeight: job.target?.height ?? null,
    get: (url, range) => fetchBytes(url, source.headers, range, signal),
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
