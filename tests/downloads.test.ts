import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv } from 'node:crypto';
import { createDownloads, serveFile, cleanMeta, baseName } from '../electron/downloads.js';
import { boxes } from '../electron/mp4.js';
import { initSegment, fragment } from './fixtures/fmp4.ts';

type Job = { id: string; state: string; error: string | null; fileName: string | null; quality: string | null; progress: number; bytes: number };

// A stand-in server: an fMP4 HLS film (one segment AES-128 encrypted, one
// that fails twice before it answers), a plain video file, and an expired
// stream.
const KEY = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const segments = [
  Buffer.concat([fragment(1, [{ size: 100, sync: true }, { size: 50 }], 1).bytes, fragment(2, [{ size: 20 }, { size: 20 }], 9).bytes]),
  Buffer.concat([fragment(1, [{ size: 120, sync: true }, { size: 60 }], 3).bytes, fragment(2, [{ size: 21 }], 11).bytes]),
  Buffer.concat([fragment(1, [{ size: 90, sync: true }], 5).bytes, fragment(2, [{ size: 22 }, { size: 23 }], 13).bytes]),
];
const encrypt = (data: Buffer, sequence: number) => {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sequence), 8);
  const c = createCipheriv('aes-128-cbc', KEY, iv);
  return Buffer.concat([c.update(data), c.final()]);
};
const FILE = Buffer.alloc(3 * 1024 * 1024, 7);

function startServer() {
  const hits: Record<string, number> = {};
  const seen: Record<string, string | undefined> = {};
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    hits[url] = (hits[url] ?? 0) + 1;
    seen[url] = req.headers.referer;
    const send = (type: string, body: Buffer | string, status = 200) => {
      res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (url === '/master.m3u8') {
      return send('application/vnd.apple.mpegurl', `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,AUDIO="a"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720.m3u8
`);
    }
    if (url === '/720.m3u8') {
      return send('application/vnd.apple.mpegurl', `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
seg0.png
#EXT-X-KEY:METHOD=AES-128,URI="/key"
#EXTINF:4,
seg1.png
#EXT-X-KEY:METHOD=NONE
#EXTINF:2,
seg2.png
#EXT-X-ENDLIST
`);
    }
    if (url === '/init.mp4') return send('video/mp4', initSegment());
    if (url === '/key') return send('application/octet-stream', KEY);
    if (url === '/seg0.png') return send('image/png', segments[0]);
    if (url === '/seg1.png') return hits[url] <= 2 ? send('text/plain', 'busy', 503) : send('image/png', encrypt(segments[1], 1));
    if (url === '/seg2.png') return send('image/png', segments[2]);
    if (url === '/expired.m3u8') {
      return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\ngone.png\n#EXT-X-ENDLIST\n');
    }
    if (url === '/gone.png') return send('text/plain', 'expired', 403);
    if (url === '/slow.m3u8') {
      return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nslow.png\n#EXT-X-ENDLIST\n');
    }
    if (url === '/slow.png') return; // never answers
    if (url === '/movie.mp4') return send('video/mp4', FILE);
    if (url.startsWith('/w342/')) return send('image/jpeg', Buffer.from('poster'));
    send('text/plain', 'not found', 404);
  });
  return new Promise<{ base: string; hits: typeof hits; seen: typeof seen; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ base: `http://127.0.0.1:${port}`, hits, seen, close: () => { server.closeAllConnections(); server.close(); } });
    }));
}

function setup(t: { after: (fn: () => void) => void }, base: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Downloads');
  const stateDir = path.join(root, 'state');
  // Posters come from TMDB in the app; here, from the stand-in.
  const fetchVia = (url: string, init?: RequestInit) => fetch(url.replace('https://image.tmdb.org/t/p', base), init);
  const make = () => createDownloads({ fetch: fetchVia, dir, stateDir, retryDelay: () => 5 });
  return { dir, stateDir, make };
}

function until(manager: { list: () => object[] }, id: string, states: string[], ms = 10000): Promise<Job> {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    (function check() {
      const job = (manager.list() as Job[]).find((j) => j.id === id);
      if (job && states.includes(job.state)) return resolve(job);
      if (Date.now() > end) return reject(new Error(`still ${job?.state ?? 'gone'}`));
      setTimeout(check, 20);
    })();
  });
}

const headers = { Referer: 'https://player.example/' };

test('HLS: the playable quality, decrypted and retried, saved as one MP4 with its poster', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const { dir, stateDir, make } = setup(t, server.base);
  const downloads = make();
  const id = downloads.start({ url: `${server.base}/master.m3u8`, kind: 'hls', headers }, { title: 'Sintel', mediaType: 'movie', mediaId: 45745, posterPath: '/poster.jpg' });
  const job = await until(downloads, id, ['done', 'failed']);
  assert.equal(job.error, null);
  assert.equal(job.state, 'done');
  assert.equal(job.quality, '720p', 'the 1080p variant needs a separate audio stream');
  assert.equal(job.fileName, 'Sintel.mp4');
  assert.equal(server.hits['/seg1.png'], 3, 'two failures, then it answered');
  assert.equal(server.seen['/seg0.png'], headers.Referer, 'the player\'s headers go along');

  const out = fs.readFileSync(path.join(dir, 'Sintel.mp4'));
  assert.deepEqual(boxes(out).map((b: { type: string }) => b.type), ['ftyp', 'mdat', 'moov']);
  const mdat = boxes(out)[1];
  const media = out.subarray(mdat.body, mdat.end);
  const expected = Buffer.concat(segments.flatMap((s) => {
    const parts = boxes(s).filter((b: { type: string }) => b.type === 'mdat');
    return parts.map((b: { body: number; end: number }) => s.subarray(b.body, b.end));
  }));
  assert.ok(media.equals(expected), 'every sample, decrypted, in order');
  assert.equal(job.bytes, out.length);
  assert.ok(!fs.existsSync(path.join(dir, 'Sintel.mp4.part')));

  // The poster arrives alongside.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(fs.readFileSync(path.join(stateDir, 'posters', `${id}.jpg`), 'utf8'), 'poster');
});

test('a second download of the same title gets its own name', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const { dir, make } = setup(t, server.base);
  const downloads = make();
  const meta = { title: 'Severance', mediaType: 'tv', mediaId: 95396, season: 2, episode: 7, showTitle: 'Severance' };
  const a = downloads.start({ url: `${server.base}/movie.mp4`, kind: 'file', headers }, meta);
  const b = downloads.start({ url: `${server.base}/movie.mp4`, kind: 'file', headers }, meta);
  await until(downloads, a, ['done']);
  await until(downloads, b, ['done']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Severance - S02E07 (2).mp4', 'Severance - S02E07.mp4']);
  assert.ok(fs.readFileSync(path.join(dir, 'Severance - S02E07.mp4')).equals(FILE));
});

test('an expired stream fails with something to do about it', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const { dir, make } = setup(t, server.base);
  const downloads = make();
  const id = downloads.start({ url: `${server.base}/expired.m3u8`, kind: 'hls', headers }, { title: 'Gone' });
  const job = await until(downloads, id, ['done', 'failed']);
  assert.equal(job.state, 'failed');
  assert.match(job.error!, /Play it again/);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing half-written left behind');
});

test('cancelling stops it, takes it off the list and cleans up', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const { dir, make } = setup(t, server.base);
  const downloads = make();
  const id = downloads.start({ url: `${server.base}/slow.m3u8`, kind: 'hls', headers }, { title: 'Slow' });
  await until(downloads, id, ['downloading']);
  await new Promise((r) => setTimeout(r, 150));
  downloads.cancel(id);
  for (let i = 0; i < 100 && downloads.list().length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(downloads.list(), []);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(downloads.activeCount(), 0);
});

test('the list survives a restart; what was unfinished comes back interrupted', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const { stateDir, make } = setup(t, server.base);
  const first = make();
  const done = first.start({ url: `${server.base}/movie.mp4`, kind: 'file', headers }, { title: 'Kept' });
  await until(first, done, ['done']);
  await new Promise((r) => setTimeout(r, 500)); // the list is saved after a short pause
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'downloads.json'), 'utf8'));
  saved.push({ ...saved[0], id: 'unfinished', state: 'downloading', file: '/nowhere/x.mp4' });
  fs.writeFileSync(path.join(stateDir, 'downloads.json'), JSON.stringify(saved));

  const second = make();
  const states = Object.fromEntries((second.list() as Job[]).map((j) => [j.id, j.state]));
  assert.equal(states[done], 'done');
  assert.equal(states.unfinished, 'interrupted');
  assert.ok(second.fileOf(done));
  assert.equal(second.fileOf('unfinished'), null);
});

test('serveFile: Range requests, for seeking', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serve-')), 'a.mp4');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, Buffer.from('0123456789'));
  const range = await serveFile(file, new Request('lwedflix-media://file/x', { headers: { range: 'bytes=2-5' } }));
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(range.headers.get('content-type'), 'video/mp4');
  assert.equal(await range.text(), '2345');
  const tail = await serveFile(file, new Request('lwedflix-media://file/x', { headers: { range: 'bytes=-3' } }));
  assert.equal(await tail.text(), '789');
  const whole = await serveFile(file, new Request('lwedflix-media://file/x'));
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), '0123456789');
  assert.equal((await serveFile(file, new Request('lwedflix-media://file/x', { headers: { range: 'bytes=20-' } }))).status, 416);
  assert.equal((await serveFile(`${file}.missing`, new Request('lwedflix-media://file/x'))).status, 404);
});

test('what the page says about a download is checked', () => {
  const meta = cleanMeta({ title: '  Dune\u0007 ', mediaType: 'movie', mediaId: 438631, season: 3, posterPath: '../../etc/passwd' });
  assert.equal(meta.title, 'Dune');
  assert.equal(meta.season, null, 'a movie has no season');
  assert.equal(meta.posterPath, null);
  assert.equal(cleanMeta({ mediaType: 'tv', title: 'Lupin', season: 1, episode: 3, posterPath: '/abc_D-1.jpg' }).posterPath, '/abc_D-1.jpg');
  assert.equal(cleanMeta({ mediaId: -4 }).mediaId, null);
  assert.equal(baseName({ title: 'A/B: "C"?', mediaType: 'movie' }), 'AB C');
  assert.equal(baseName({ title: 'x', showTitle: 'Lupin', mediaType: 'tv', season: 1, episode: 3 }), 'Lupin - S01E03');
});

test('a season: each episode finds its stream in turn; done ones are skipped; a failure can be retried', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-season-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const asked: string[] = [];
  let episode2Fails = true;
  const resolve = async (target: { season: number; episode: number }, provider: string) => {
    asked.push(`S${target.season}E${target.episode}@${provider}`);
    if (target.episode === 2 && episode2Fails) return null;
    return { url: `${server.base}/master.m3u8`, kind: 'hls', headers };
  };
  const downloads = createDownloads({ fetch, dir: path.join(root, 'Downloads'), stateDir: path.join(root, 'state'), retryDelay: () => 5, resolve });
  const show = { title: 'Lupin', mediaId: 96677, posterPath: '/lupin.jpg' };
  const first = downloads.enqueue(show, [{ season: 1, episode: 1, episodeTitle: 'Chapter 1' }], { provider: 'vidcore', height: 1080 });
  assert.deepEqual(first, { added: 1, skipped: 0 });
  const list = () => downloads.list() as Job[];
  await until(downloads, list()[0].id, ['done']);

  const second = downloads.enqueue(show, [
    { season: 1, episode: 1 }, // already downloaded
    { season: 1, episode: 2 },
    { season: 1, episode: 3, episodeTitle: 'Chapter 3' },
    { season: 1, episode: 3 }, // listed twice
  ], { provider: 'vidcore', height: 360 });
  assert.deepEqual(second, { added: 2, skipped: 2 });
  const byEpisode = (n: number) => list().find((j) => (j as unknown as { episode: number }).episode === n)!;
  const e2 = await until(downloads, byEpisode(2).id, ['done', 'failed']);
  const e3 = await until(downloads, byEpisode(3).id, ['done', 'failed']);
  assert.equal(e2.state, 'failed');
  assert.match(e2.error!, /No server had a stream/);
  assert.equal(e3.state, 'done');
  assert.equal(e3.fileName, 'Lupin - S01E03.mp4');
  assert.equal(e3.quality, '720p', 'the smallest there is, when even that is taller than asked');
  assert.deepEqual(asked, ['S1E1@vidcore', 'S1E2@vidcore', 'S1E3@vidcore']);

  episode2Fails = false;
  downloads.retry(e2.id);
  assert.equal((await until(downloads, e2.id, ['done', 'failed'])).state, 'done');
  assert.deepEqual(fs.readdirSync(path.join(root, 'Downloads')).sort(), ['Lupin - S01E01.mp4', 'Lupin - S01E02.mp4', 'Lupin - S01E03.mp4']);
});

test('queued season episodes are still queued after a restart', async (t) => {
  const server = await startServer();
  t.after(server.close);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-restart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = { dir: path.join(root, 'Downloads'), stateDir: path.join(root, 'state'), retryDelay: () => 5 };
  // The app "quits" while the first episode is still looking for its stream.
  const stuck = createDownloads({ fetch, ...dirs, resolve: () => new Promise(() => {}) });
  stuck.enqueue({ title: 'Dark', mediaId: 70523 }, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], {});
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual((stuck.list() as Job[]).map((j) => j.state), ['resolving', 'resolving'], 'two run at once');

  const again = createDownloads({ fetch, ...dirs, resolve: async () => ({ url: `${server.base}/master.m3u8`, kind: 'hls', headers }) });
  const ids = (again.list() as Job[]).map((j) => j.id);
  for (const id of ids) assert.equal((await until(again, id, ['done', 'failed'])).state, 'done');
});

test('cancelling an episode that is still finding its stream stops the search', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let aborted = false;
  // A search that only ends when it's told to.
  const resolve = (_target: unknown, _provider: unknown, signal?: AbortSignal) =>
    new Promise((done) => signal?.addEventListener('abort', () => { aborted = true; done(null); }));
  const downloads = createDownloads({ fetch, dir: path.join(root, 'Downloads'), stateDir: path.join(root, 'state'), retryDelay: () => 5, resolve });
  downloads.enqueue({ title: 'Dark', mediaId: 70523 }, [{ season: 1, episode: 1 }], {});
  const [job] = downloads.list() as Job[];
  await until(downloads, job.id, ['resolving']);
  downloads.cancel(job.id);
  for (let i = 0; i < 50 && downloads.list().length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(aborted, true, 'the resolver was told to stop');
  assert.deepEqual(downloads.list(), []);
});
