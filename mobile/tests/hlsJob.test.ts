import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv } from 'node:crypto';
import { saveHls, DownloadError } from '../downloads/hlsJob.ts';
import { boxes } from '../../electron/mp4.js';
import { fragment, initSegment } from '../../tests/fixtures/fmp4.ts';

// The phone's HLS download, end to end under Node: a master playlist (the
// 1080p variant's sound is separate, so 720p is picked), an fMP4 media
// playlist with one AES-128 segment, written through a FileHandle-like
// adapter like engine.ts's.
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

const FILES: Record<string, Buffer | string> = {
  'https://cdn.test/master.m3u8': `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,AUDIO="a"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720.m3u8
`,
  'https://cdn.test/720.m3u8': `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
seg0.png
#EXT-X-KEY:METHOD=AES-128,URI="/key"
#EXTINF:4,
seg1.png
#EXT-X-KEY:METHOD=NONE
#EXTINF:4,
seg2.png
#EXT-X-ENDLIST
`,
  'https://cdn.test/init.mp4': initSegment(),
  'https://cdn.test/key': KEY,
  'https://cdn.test/seg0.png': segments[0],
  'https://cdn.test/seg1.png': encrypt(segments[1], 1),
  'https://cdn.test/seg2.png': segments[2],
};

async function run(overrides: Partial<Parameters<typeof saveHls>[2]> = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lwedflix-hls-'));
  const file = path.join(dir, 'out.mp4');
  const qualities: (string | null)[] = [];
  const progress: number[] = [];
  const result = await saveHls('https://cdn.test/master.m3u8', file, {
    get: async (url) => {
      const body = FILES[url];
      if (body === undefined) throw new Error(`404 ${url}`);
      return new Uint8Array(Buffer.from(body));
    },
    open: (p) => fsp.open(p, 'w'),
    gate: async () => {},
    cancelled: () => false,
    onQuality: (q) => qualities.push(q),
    onDuration: () => {},
    onProgress: (_b, f) => progress.push(f),
    ...overrides,
  });
  return { result, file, qualities, progress };
}

test('saves a stream as one ordinary MP4', async () => {
  const { result, file, qualities, progress } = await run();
  assert.ok(result && result.bytes > 0);
  const out = await fsp.readFile(file);
  assert.deepEqual(boxes(out).map((b: { type: string }) => b.type), ['ftyp', 'mdat', 'moov']);
  assert.deepEqual(qualities, ['720p']);
  assert.equal(progress.length, 3);
  assert.ok(progress.every((p, i) => i === 0 || p > progress[i - 1]));
});

test('a cancelled download leaves nothing finished', async () => {
  const { result } = await run({ cancelled: () => true });
  assert.equal(result, null);
});

test('a segment that keeps failing fails the download with its reason', async () => {
  await assert.rejects(
    run({
      get: async (url) => {
        if (url.endsWith('seg1.png')) throw new DownloadError('The server stopped serving this stream.');
        const body = FILES[url];
        return new Uint8Array(Buffer.from(body!));
      },
    }),
    /stopped serving/
  );
});

test('a stream with nothing playable says so', async () => {
  await assert.rejects(
    run({ get: async () => new Uint8Array(Buffer.from('#EXTM3U\n#EXT-X-ENDLIST\n')) }),
    /nothing in it/
  );
});
