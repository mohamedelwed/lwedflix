import { Buffer } from 'buffer';
import muxjs from 'mux.js';
import { ivFor, parsePlaylist, pickVariant, tsStart, type Segment } from '@electron/hls';
import { Mp4Writer, parseFragments, parseInit, type FileHandleLike, type Init } from '@electron/mp4';
import { decryptAes128 } from './aes.ts';

// Saving an HLS stream as one ordinary MP4, as electron/downloads.js does:
// the variant asked for (or the best one, no taller than `maxHeight`),
// segments fetched in parallel and written in order, AES-128 decrypted,
// MPEG-TS transmuxed by mux.js, everything written by electron/mp4.js.
// Free of Expo, so tests run it under Node; engine.ts supplies the network
// and the file.

/** A failure worth telling the user as is. */
export class DownloadError extends Error {}

const WORKERS = 4; // segments fetched at once
const AHEAD = 16; // segments fetched beyond the one being written

export interface HlsJobOptions {
  variant?: number;
  maxHeight?: number | null;
  get(url: string, range?: { offset: number; length: number } | null): Promise<Uint8Array>;
  open(uri: string): Promise<FileHandleLike>;
  /** Resolves at once, or when a paused download is resumed. */
  gate(): Promise<void>;
  cancelled(): boolean;
  onQuality(quality: string | null): void;
  onDuration(seconds: number): void;
  onProgress(bytes: number, fraction: number): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const qualityOfWidth = (width: number) =>
  width >= 3800 ? '2160p' : width >= 1900 ? '1080p' : width >= 1260 ? '720p' : width >= 840 ? '480p' : width >= 600 ? '360p' : null;

/** Writes the stream to `fileUri`. Null when cancelled; throws on failure. */
export async function saveHls(sourceUrl: string, fileUri: string, o: HlsJobOptions): Promise<{ bytes: number } | null> {
  const text = async (url: string) => Buffer.from(await o.get(url)).toString('utf8');
  let quality: string | null = null;
  let playlist = parsePlaylist(await text(sourceUrl), sourceUrl);
  if (playlist.master) {
    const variant = pickVariant(playlist, o.variant, o.maxHeight);
    if (!variant) throw new DownloadError('This server keeps the sound in a separate stream, which Lwedflix can’t download yet. Try another server.');
    quality = variant.height ? `${variant.height}p` : null;
    o.onQuality(quality);
    playlist = parsePlaylist(await text(variant.url), variant.url);
  }
  const segments = playlist.segments;
  if (segments.length === 0 || !(playlist.duration > 0)) throw new DownloadError('The stream has nothing in it. Try another server.');
  o.onDuration(playlist.duration);

  const writer = await Mp4Writer.create(fileUri, o.open);
  let init: Init | null = null;
  const noteQuality = (tracks: Init) => {
    const width = tracks.tracks.find((t) => t.handler === 'vide')?.width ?? 0;
    if (!quality && width) o.onQuality((quality = qualityOfWidth(width)));
  };
  if (playlist.map) {
    init = parseInit(Buffer.from(await o.get(playlist.map.url, playlist.map.range)));
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
    if (!keys.has(segment.key.uri)) keys.set(segment.key.uri, o.get(segment.key.uri));
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
  const signal = () => wake.splice(0).forEach((w) => w());
  const nap = () => Promise.race([new Promise<void>((r) => wake.push(r)), sleep(250)]);

  const worker = async () => {
    while (!failure && !o.cancelled()) {
      await o.gate();
      if (failure || o.cancelled() || next >= segments.length) return;
      if (next - written >= AHEAD) {
        await nap();
        continue;
      }
      const i = next++;
      try {
        ready.set(i, await o.get(segments[i].url, segments[i].range));
      } catch (err) {
        failure ??= err;
      }
      signal();
    }
  };

  const writerLoop = async () => {
    while (!failure && !o.cancelled() && written < segments.length) {
      const bytes = ready.get(written);
      if (!bytes) {
        await nap();
        continue;
      }
      ready.delete(written);
      try {
        await write(segments[written], bytes);
      } catch (err) {
        failure ??= err;
        signal();
        return;
      }
      seconds += segments[written].duration;
      written++;
      o.onProgress(writer.offset, Math.min(0.999, seconds / playlist.duration));
      signal();
    }
  };

  try {
    await Promise.all([...Array.from({ length: WORKERS }, worker), writerLoop()]);
    if (o.cancelled()) {
      await writer.abort();
      return null;
    }
    if (failure) throw failure;
    await writer.finish();
  } catch (err) {
    await writer.abort();
    throw err;
  }
  return { bytes: writer.offset };
}
