// Downloads: films and episodes saved to the computer, to watch offline.
//
// The stream comes from what the player is loading (streams.js), with the
// headers its server wants. HLS — what the servers send — is fetched a few
// segments at a time, decrypted when it's AES-128, unpacked from MPEG-TS by
// mux.js, and written as one ordinary MP4 (mp4.js); a plain video file is
// saved as it is. Files go to Downloads/Lwedflix; the list, with each
// title's poster, lives in the app's data folder so the Downloads page works
// offline. The page plays them through lwedflix-media://, which serves only
// files on that list.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { randomUUID, createDecipheriv } = require('node:crypto');
const muxjs = require('mux.js');
const { parsePlaylist, pickVariant, qualities, ivFor, tsStart } = require('./hls');
const { parseInit, parseFragments, Mp4Writer } = require('./mp4');
const { titleFor, pickRequestHeaders } = require('./streams');

const SCHEME = 'lwedflix-media';
const WORKERS = 6; // segments fetched at once, per download
const MIN_WORKERS = 2; // when a server keeps failing
const AHEAD = 24; // segments fetched beyond the one being written
const ATTEMPTS = 8;
const RUNNING = 2; // downloads at once; the rest wait
const ACTIVE = new Set(['queued', 'resolving', 'downloading', 'paused']);
// Qualities a season download can ask for (null: the best there is).
const HEIGHTS = new Set([2160, 1080, 720, 480, 360]);
// A signed URL that has expired answers one of these.
const GONE = new Set([401, 403, 404, 410, 428]);
const STORED = ['id', 'state', 'kind', 'title', 'mediaType', 'mediaId', 'season', 'episode', 'showTitle', 'episodeTitle',
  'posterPath', 'poster', 'quality', 'file', 'bytes', 'totalBytes', 'duration', 'error', 'createdAt', 'finishedAt', 'target'];
const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg' };

/** An error whose message is meant for the person, not the log. */
class DownloadError extends Error {}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

const backoff = (attempt) => Math.min(15000, 800 * 2 ** attempt) + Math.random() * 400;

/** Tries `task` again on failure, backing off; a DownloadError or an abort ends it. */
async function withRetries(task, { signal, onRetry, attempts = ATTEMPTS, retryDelay = backoff }) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (signal?.aborted || err instanceof DownloadError) throw err;
      last = err;
      onRetry?.(err);
      if (attempt < attempts - 1) await delay(retryDelay(attempt), signal);
    }
  }
  throw new DownloadError(`The server kept failing (${last?.message ?? 'no answer'}). Try again later, or try another server.`);
}

function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '';
}

function cleanInt(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** What the page may say about a download; nothing else is kept. */
function cleanMeta(meta) {
  const mediaType = meta?.mediaType === 'tv' ? 'tv' : 'movie';
  const posterPath = typeof meta?.posterPath === 'string' && /^\/[\w-]+\.(jpg|png)$/.test(meta.posterPath) ? meta.posterPath : null;
  return {
    title: cleanText(meta?.title) || 'Untitled',
    mediaType,
    mediaId: cleanInt(meta?.mediaId),
    season: mediaType === 'tv' ? cleanInt(meta?.season) : null,
    episode: mediaType === 'tv' ? cleanInt(meta?.episode) : null,
    showTitle: mediaType === 'tv' ? cleanText(meta?.showTitle) || cleanText(meta?.title) : null,
    episodeTitle: cleanText(meta?.episodeTitle) || null,
    posterPath,
  };
}

/** "Severance - S02E07", without characters no file system takes. */
function baseName(job) {
  const name = titleFor({ title: job.showTitle || job.title, type: job.mediaType, season: job.season, episode: job.episode });
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'Lwedflix download';
}

/**
 * `resolve(target, provider)` finds a stream for a queued episode when its
 * turn comes (resolver.js); without it, only streams the player captured can
 * be downloaded.
 *
 * @param {{
 *   fetch: (url: string, init?: any) => Promise<Response>,
 *   dir: string,
 *   stateDir: string,
 *   onChange?: (list: any[]) => void,
 *   log?: (line: string) => void,
 *   retryDelay?: (attempt: number) => number,
 *   resolve?: ((target: any, provider: any, signal?: AbortSignal) => Promise<any>) | null,
 * }} options
 */
function createDownloads({ fetch, dir, stateDir, onChange = () => {}, log = () => {}, retryDelay = backoff, resolve = null }) {
  const stateFile = path.join(stateDir, 'downloads.json');
  const postersDir = path.join(stateDir, 'posters');
  const jobs = new Map();
  const runs = new Map(); // id -> what a running download needs; never saved
  let running = 0;

  function newRun(source, target, variant) {
    return {
      source, target, variant: Number.isSafeInteger(variant) ? variant : undefined, controller: new AbortController(), request: null,
      paused: false, cancelled: false, waiters: [], failures: 0, samples: [], activeMs: 0, resumedAt: Date.now(), part: null, writer: null,
    };
  }

  // The list from last time. Anything unfinished then can't be picked up:
  // its signed URLs are long dead.
  try {
    for (const saved of JSON.parse(fs.readFileSync(stateFile, 'utf8'))) {
      if (!saved?.id) continue;
      const job = { progress: 0, speed: 0, eta: null, ...saved };
      if (ACTIVE.has(job.state)) {
        if (job.file) fs.rm(`${job.file}.part`, { force: true }, () => {});
        if (job.target && resolve) {
          // A season's episode finds its stream when its turn comes, so it
          // simply goes back in the queue (from the start, if it had begun).
          Object.assign(job, { state: 'queued', file: null, bytes: 0, progress: 0 });
          runs.set(job.id, newRun(null, job.target));
        } else {
          job.state = 'interrupted';
          job.error = 'Lwedflix was closed before this finished.';
        }
      } else if (job.state === 'done') {
        job.progress = 1;
        if (!job.file || !fs.existsSync(job.file)) job.state = 'missing';
      }
      jobs.set(job.id, job);
    }
  } catch {
    // No list yet.
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const data = [...jobs.values()].map((job) => Object.fromEntries(STORED.map((k) => [k, job[k] ?? null])));
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(data, null, 1));
        fs.renameSync(`${stateFile}.tmp`, stateFile);
      } catch (err) {
        log(`couldn't save the list: ${err.message}`);
      }
    }, 300);
  }

  let emitTimer = null;
  let lastEmit = 0;
  function changed(now = false) {
    const emit = () => {
      clearTimeout(emitTimer);
      emitTimer = null;
      lastEmit = Date.now();
      onChange(list());
    };
    if (now) emit();
    else emitTimer ??= setTimeout(emit, Math.max(0, 500 - (Date.now() - lastEmit)));
  }

  /** What the page sees of a download: everything but where the file is. @returns {Record<string, any>} */
  function view(job) {
    const out = Object.fromEntries(STORED.filter((k) => k !== 'file').map((k) => [k, job[k] ?? null]));
    return { ...out, fileName: job.file ? path.basename(job.file) : null, progress: job.progress, speed: job.speed, eta: job.eta };
  }

  function list() {
    return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(view);
  }

  /** A name nothing else uses: on disk, half-written, or reserved by another download. */
  function uniquePath(base, ext) {
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 1; ; n++) {
      const file = path.join(dir, `${base}${n > 1 ? ` (${n})` : ''}${ext}`);
      const taken = fs.existsSync(file) || fs.existsSync(`${file}.part`) || [...jobs.values()].some((j) => j.file === file);
      if (!taken) return file;
    }
  }

  async function savePoster(job) {
    if (!job.posterPath) return;
    try {
      const res = await fetch(`https://image.tmdb.org/t/p/w342${job.posterPath}`);
      if (!res.ok) return;
      await fsp.mkdir(postersDir, { recursive: true });
      await fsp.writeFile(path.join(postersDir, `${job.id}.jpg`), Buffer.from(await res.arrayBuffer()));
      if (!jobs.has(job.id)) return;
      job.poster = `${job.id}.jpg`;
      save();
      changed();
    } catch {
      // The page falls back to the title.
    }
  }

  // ---- Progress -----------------------------------------------------------

  function tick(job, run) {
    const now = Date.now();
    run.samples.push([now, job.bytes]);
    while (run.samples.length > 2 && now - run.samples[0][0] > 8000) run.samples.shift();
    const [then, before] = run.samples[0];
    job.speed = now > then ? Math.round(((job.bytes - before) * 1000) / (now - then)) : 0;
    const active = run.activeMs + (now - run.resumedAt);
    job.eta = job.progress > 0.005 ? Math.round((active * (1 - job.progress)) / job.progress / 1000) : null;
    changed();
  }

  /** Resolves at once, or when a paused download is resumed (or cancelled). */
  function gate(run) {
    return run.paused ? new Promise((resolve) => run.waiters.push(resolve)) : Promise.resolve();
  }

  function get(run, signal) {
    const headers = run.source.headers;
    return (url, range) => withRetries(async (attempt) => {
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
      return Buffer.from(await res.arrayBuffer());
    }, { signal, onRetry: () => run.failures++, retryDelay });
  }

  // ---- HLS ----------------------------------------------------------------

  async function downloadHls(job, run) {
    const signal = run.controller.signal;
    const fetchBytes = get(run, signal);
    let playlist = parsePlaylist((await fetchBytes(run.source.url)).toString('utf8'), run.source.url);
    let bandwidth = 0;
    if (playlist.master) {
      const variant = pickVariant(playlist, run.variant, run.target?.height);
      if (!variant) throw new DownloadError('This server keeps the sound in a separate stream, which Lwedflix can’t download yet. Try another server.');
      job.quality = variant.height ? `${variant.height}p` : null;
      bandwidth = variant.bandwidth;
      playlist = parsePlaylist((await fetchBytes(variant.url)).toString('utf8'), variant.url);
    }
    const { segments } = playlist;
    if (segments.length === 0 || !(playlist.duration > 0)) throw new DownloadError('The stream has nothing in it. Try another server.');
    job.duration = Math.round(playlist.duration);
    if (bandwidth) job.totalBytes = Math.round((bandwidth / 8) * playlist.duration);
    job.file = uniquePath(baseName(job), '.mp4');
    run.part = `${job.file}.part`;
    save();
    changed(true);

    // With one quality on offer there's no label to go by: the picture's own
    // width gives it (by width, so a 1920×800 film is still 1080p).
    const noteQuality = (tracks) => {
      const width = tracks.tracks.find((t) => t.handler === 'vide')?.width ?? 0;
      if (job.quality || !width) return;
      job.quality = width >= 3800 ? '2160p' : width >= 1900 ? '1080p' : width >= 1260 ? '720p' : width >= 840 ? '480p' : width >= 600 ? '360p' : null;
    };
    const writer = await Mp4Writer.create(run.part);
    run.writer = writer;
    let init = null;
    if (playlist.map) {
      init = parseInit(await fetchBytes(playlist.map.url, playlist.map.range));
      writer.setTracks(init);
      noteQuality(init);
    }
    const transmuxer = init ? null : new muxjs.mp4.Transmuxer({ remux: true });
    const produced = [];
    transmuxer?.on('data', (segment) => produced.push(segment));

    const keys = new Map();
    const decrypt = async (segment, bytes) => {
      if (!segment.key) return bytes;
      if (segment.key.method !== 'AES-128' || !segment.key.uri) {
        throw new DownloadError('This stream is protected in a way Lwedflix can’t save. Try another server.');
      }
      if (!keys.has(segment.key.uri)) keys.set(segment.key.uri, fetchBytes(segment.key.uri));
      const decipher = createDecipheriv('aes-128-cbc', await keys.get(segment.key.uri), ivFor(segment));
      return Buffer.concat([decipher.update(bytes), decipher.final()]);
    };
    const write = async (segment, raw) => {
      const bytes = await decrypt(segment, raw);
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
    let next = 0;
    let written = 0;
    let seconds = 0;
    let inFlight = 0;
    let limit = WORKERS;
    let calm = 0;
    let failure = null;
    const ready = new Map();
    const waiting = [];
    const advance = () => waiting.splice(0).forEach((resolve) => resolve());
    let writing = Promise.resolve();
    const drain = () => {
      writing = writing.then(async () => {
        while (!failure && ready.has(written)) {
          const bytes = ready.get(written);
          ready.delete(written);
          await write(segments[written], bytes);
          seconds += segments[written].duration;
          written++;
          job.bytes = writer.offset;
          job.progress = Math.min(0.999, seconds / playlist.duration);
          tick(job, run);
          advance();
        }
      }).catch((err) => {
        failure ??= err;
        advance();
      });
    };
    const worker = async () => {
      while (!failure && !run.cancelled) {
        await gate(run);
        if (failure || run.cancelled || next >= segments.length) return;
        if (next - written >= AHEAD || inFlight >= limit) {
          await Promise.race([new Promise((resolve) => waiting.push(resolve)), delay(250)]);
          continue;
        }
        const i = next++;
        inFlight++;
        const failuresBefore = run.failures;
        try {
          ready.set(i, await fetchBytes(segments[i].url, segments[i].range));
          // Ease off a server that's struggling; come back once it's calm.
          if (run.failures > failuresBefore) {
            limit = Math.max(MIN_WORKERS, limit - 1);
            calm = 0;
          } else if (++calm >= 20 && limit < WORKERS) {
            limit++;
            calm = 0;
          }
          drain();
        } catch (err) {
          failure ??= err;
          advance();
        } finally {
          inFlight--;
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    await writing;
    if (run.cancelled) throw new Error('cancelled');
    if (failure) throw failure;
    await writer.finish();
    run.writer = null;
    await fsp.rename(run.part, job.file);
  }

  // ---- A plain file -------------------------------------------------------

  async function downloadFile(job, run) {
    const ext = path.extname(new URL(run.source.url).pathname).toLowerCase();
    job.file = uniquePath(baseName(job), TYPES[ext]?.startsWith('video/') ? ext : '.mp4');
    run.part = `${job.file}.part`;
    save();
    changed(true);
    let written = 0;
    let breaks = 0;
    for (;;) {
      await gate(run);
      if (run.cancelled) throw new Error('cancelled');
      // Its own signal, so pausing can cut the transfer and resume it later.
      const request = new AbortController();
      run.request = request;
      const stop = () => request.abort();
      run.controller.signal.addEventListener('abort', stop, { once: true });
      let out = null;
      try {
        const res = await withRetries(async (attempt) => {
          const r = await fetch(run.source.url, { headers: written ? { ...run.source.headers, Range: `bytes=${written}-` } : run.source.headers, signal: request.signal });
          if (!r.ok) {
            if (GONE.has(r.status) && attempt >= 1) throw new DownloadError('The server stopped serving this file. Play it again in the player, then download it.');
            throw new Error(`HTTP ${r.status}`);
          }
          return r;
        }, { signal: request.signal, onRetry: () => run.failures++, retryDelay });
        if (written && res.status !== 206) written = 0; // no resuming here: from the top
        const length = Number(res.headers.get('content-length')) || 0;
        if (length) job.totalBytes = written + length;
        out = fs.createWriteStream(run.part, { flags: written ? 'a' : 'w' });
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await once(out, 'drain');
          written += chunk.length;
          job.bytes = written;
          job.progress = job.totalBytes ? Math.min(0.999, written / job.totalBytes) : 0;
          tick(job, run);
        }
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
        out = null;
        break;
      } catch (err) {
        if (out) await new Promise((resolve) => out.end(resolve));
        if (run.cancelled) throw err;
        if (run.paused) continue;
        if (err instanceof DownloadError || ++breaks > ATTEMPTS) throw err;
        await delay(retryDelay(0), run.controller.signal); // a dropped connection: pick up where it broke
      } finally {
        run.controller.signal.removeEventListener('abort', stop);
      }
    }
    await fsp.rename(run.part, job.file);
  }

  // ---- Running ------------------------------------------------------------

  function pump() {
    for (const job of jobs.values()) {
      if (running >= RUNNING) return;
      if (job.state === 'queued' && runs.has(job.id)) void runJob(job);
    }
  }

  async function runJob(job) {
    const run = runs.get(job.id);
    running++;
    job.state = run.source ? 'downloading' : 'resolving';
    run.resumedAt = Date.now();
    changed(true);
    save();
    try {
      if (!run.source) {
        // A season's episode: find its stream now, while it's fresh.
        run.source = resolve ? await resolve(job.target, job.target.provider, run.controller.signal) : null;
        if (run.cancelled) throw new Error('cancelled');
        if (!run.source) throw new DownloadError('No server had a stream for this episode. Try again later, or download it from the player.');
        if (run.source.kind === 'dash') throw new DownloadError('This episode is only on a DASH server, which can’t be downloaded yet.');
        job.kind = run.source.kind === 'hls' ? 'hls' : 'file';
        job.state = 'downloading';
        run.resumedAt = Date.now();
        changed(true);
      }
      if (job.kind === 'hls') await downloadHls(job, run);
      else await downloadFile(job, run);
      job.state = 'done';
      job.progress = 1;
      job.bytes = job.totalBytes = (await fsp.stat(job.file)).size;
      job.finishedAt = Date.now();
      job.eta = null;
      job.speed = 0;
      log(`done: ${job.file}`);
    } catch (err) {
      await run.writer?.abort();
      if (run.part) await fsp.rm(run.part, { force: true });
      if (run.cancelled) {
        jobs.delete(job.id);
        fs.rm(path.join(postersDir, `${job.id}.jpg`), { force: true }, () => {});
      } else {
        job.state = 'failed';
        job.error = err instanceof DownloadError ? err.message : 'Something went wrong while downloading. Try again, or try another server.';
        job.speed = 0;
        job.eta = null;
        log(`failed: ${job.title}: ${err?.stack || err}`);
      }
    } finally {
      running--;
      runs.delete(job.id);
      save();
      changed(true);
      pump();
    }
  }

  function addJob(meta, kind, run, target = null) {
    const id = randomUUID();
    const job = {
      id, state: 'queued', kind, ...cleanMeta(meta), target,
      poster: null, quality: null, file: null, bytes: 0, totalBytes: null, duration: null, error: null,
      progress: 0, speed: 0, eta: null, createdAt: Date.now(), finishedAt: null,
    };
    jobs.set(id, job);
    runs.set(id, run);
    void savePoster(job);
    return job;
  }

  /** Downloads a stream the player captured. */
  function start(source, meta, variant) {
    const job = addJob(meta, source.kind === 'hls' ? 'hls' : 'file', newRun(source, null, variant));
    save();
    changed(true);
    pump();
    return job.id;
  }

  /** Is this episode already downloaded, or on its way? */
  const have = (mediaId, season, episode) => [...jobs.values()].some((j) =>
    j.mediaType === 'tv' && j.mediaId === mediaId && j.season === season && j.episode === episode && (j.state === 'done' || ACTIVE.has(j.state)));

  /**
   * Queues episodes of a show — a season, or all of them — each to find its
   * stream when its turn comes. Episodes already downloaded or queued are
   * skipped.
   */
  function enqueue(show, episodes, options = {}) {
    if (!resolve) return { added: 0, skipped: episodes.length };
    const meta = cleanMeta({ ...show, mediaType: 'tv' });
    const provider = typeof options.provider === 'string' ? options.provider.slice(0, 40) : null;
    const height = HEIGHTS.has(options.height) ? options.height : null;
    let added = 0;
    const seen = new Set();
    for (const ep of episodes) {
      const season = cleanInt(ep?.season);
      const episode = cleanInt(ep?.episode);
      if (season === null || episode === null || !meta.mediaId || seen.has(`${season}-${episode}`) || have(meta.mediaId, season, episode)) continue;
      seen.add(`${season}-${episode}`);
      const target = { mediaType: 'tv', mediaId: meta.mediaId, season, episode, provider, height };
      addJob({ ...meta, season, episode, showTitle: meta.showTitle || meta.title, episodeTitle: ep.episodeTitle }, 'hls', newRun(null, target), target);
      added++;
    }
    save();
    changed(true);
    pump();
    return { added, skipped: episodes.length - added };
  }

  /** Tries a season episode again: it finds a fresh stream. */
  function retry(id) {
    const job = jobs.get(id);
    if (!job?.target || !resolve || runs.has(id) || !['failed', 'interrupted'].includes(job.state)) return;
    Object.assign(job, { state: 'queued', error: null, file: null, bytes: 0, progress: 0, speed: 0, eta: null });
    runs.set(id, newRun(null, job.target));
    save();
    changed(true);
    pump();
  }

  function pause(id) {
    const job = jobs.get(id);
    const run = runs.get(id);
    if (!job || !run || job.state !== 'downloading') return;
    run.paused = true;
    run.activeMs += Date.now() - run.resumedAt;
    run.request?.abort();
    job.state = 'paused';
    job.speed = 0;
    save();
    changed(true);
  }

  function resume(id) {
    const job = jobs.get(id);
    const run = runs.get(id);
    if (!job || !run || job.state !== 'paused') return;
    run.paused = false;
    run.resumedAt = Date.now();
    run.samples = [];
    job.state = 'downloading';
    run.waiters.splice(0).forEach((resolve) => resolve());
    changed(true);
  }

  /** Stops a download and takes it off the list. */
  function cancel(id) {
    const run = runs.get(id);
    if (!run) return;
    run.cancelled = true;
    run.paused = false;
    run.controller.abort(new Error('cancelled'));
    run.request?.abort();
    run.waiters.splice(0).forEach((resolve) => resolve());
    const job = jobs.get(id);
    if (job?.state === 'queued') {
      runs.delete(id);
      jobs.delete(id);
      save();
      changed(true);
    }
  }

  async function remove(id, deleteFile) {
    if (runs.has(id)) return cancel(id);
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (deleteFile && job.file) await fsp.rm(job.file, { force: true });
    await fsp.rm(path.join(postersDir, `${id}.jpg`), { force: true });
    save();
    changed(true);
  }

  /** The qualities a stream comes in, with an estimate of each file's size. */
  async function qualitiesOf(source) {
    if (source.kind !== 'hls') return [];
    const run = { source, failures: 0 };
    const fetchBytes = (url) => withRetries(async () => {
      const res = await fetch(url, { headers: source.headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }, { attempts: 3, onRetry: () => run.failures++, retryDelay });
    const playlist = parsePlaylist((await fetchBytes(source.url)).toString('utf8'), source.url);
    if (!playlist.master) return [];
    let duration = 0;
    const best = pickVariant(playlist);
    if (best) {
      try {
        duration = parsePlaylist((await fetchBytes(best.url)).toString('utf8'), best.url).duration;
      } catch {
        // Sizes stay unknown.
      }
    }
    return qualities(playlist, duration);
  }

  // Season episodes still queued from last time carry on.
  setTimeout(pump, 0);

  return {
    list,
    start,
    enqueue,
    retry,
    pause,
    resume,
    cancel,
    remove,
    qualitiesOf,
    activeCount: () => runs.size,
    fileOf: (id) => (jobs.get(id)?.state === 'done' ? jobs.get(id).file : null),
    posterOf: (id) => (jobs.get(id)?.poster ? path.join(postersDir, jobs.get(id).poster) : null),
  };
}

/** A file, honouring Range so the player can seek. */
async function serveFile(file, request) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  let start = 0;
  let end = stat.size - 1;
  if (match) {
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
    } else if (match[2]) {
      start = Math.max(0, stat.size - Number(match[2]));
    }
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
  }
  const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, {
    status: match ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    },
  });
}

/** IPC for the app's page, and lwedflix-media:// for its <video> and <img>. */
function setupDownloads({ ipcMain, isFromAppPage, streams, ses, webContents, shell, downloadsDir, stateDir, log, resolver = null }) {
  const downloads = createDownloads({
    fetch: (url, init) => ses.fetch(url, init),
    dir: downloadsDir,
    stateDir,
    log,
    resolve: resolver ? (target, provider, signal) => resolver.resolve(target, provider, signal) : null,
    onChange: (list) => {
      if (!webContents.isDestroyed()) webContents.send('downloads:changed', list);
    },
  });
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => (isFromAppPage(event) ? fn(...args) : null));
  const sourceOf = (stream) => ({ url: stream.url, kind: stream.kind, headers: pickRequestHeaders(stream.requestHeaders), frameUrl: stream.frameUrl });

  handle('downloads:streams', (origins) => streams.list(Array.isArray(origins) ? origins.filter((o) => typeof o === 'string') : []));
  handle('downloads:qualities', async (streamId) => {
    const stream = streams.get(streamId);
    if (!stream) return [];
    try {
      return await downloads.qualitiesOf(sourceOf(stream));
    } catch {
      return [];
    }
  });
  handle('downloads:start', (streamId, options) => {
    const stream = streams.get(streamId);
    if (!stream) return { ok: false, error: 'That stream is no longer listed — press play again.' };
    if (stream.kind === 'dash') return { ok: false, error: 'This server uses DASH, which can’t be downloaded yet. Try another server.' };
    return { ok: true, id: downloads.start(sourceOf(stream), options?.meta, options?.variant) };
  });
  handle('downloads:list', () => downloads.list());
  handle('downloads:pause', (id) => downloads.pause(id));
  handle('downloads:resume', (id) => downloads.resume(id));
  // A season, or a whole show: each episode finds its stream when its turn comes.
  handle('downloads:enqueue', (show, episodes, options) =>
    downloads.enqueue(show ?? {}, Array.isArray(episodes) ? episodes.slice(0, 500) : [], options ?? {}));
  handle('downloads:retry', (id) => downloads.retry(id));
  handle('downloads:cancel', (id) => downloads.cancel(id));
  handle('downloads:remove', (id, deleteFile) => downloads.remove(id, deleteFile === true));
  handle('downloads:reveal', (id) => {
    const file = downloads.fileOf(id);
    if (file) shell.showItemInFolder(file);
  });
  handle('downloads:open-folder', async () => {
    await fsp.mkdir(downloadsDir, { recursive: true });
    await shell.openPath(downloadsDir);
  });

  // lwedflix-media://file/<id> and lwedflix-media://poster/<id>: only files
  // on the list, by their unguessable id.
  ses.protocol.handle(SCHEME, (request) => {
    const { host, pathname } = new URL(request.url);
    const id = decodeURIComponent(pathname.slice(1));
    const file = host === 'file' ? downloads.fileOf(id) : host === 'poster' ? downloads.posterOf(id) : null;
    return file ? serveFile(file, request) : new Response('Not found', { status: 404 });
  });

  return downloads;
}

module.exports = { SCHEME, setupDownloads, createDownloads, serveFile, cleanMeta, baseName, DownloadError };
