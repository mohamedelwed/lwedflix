import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist, qualities, pickVariant, ivFor, tsStart } from '../electron/hls.js';

const MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=926542,CODECS="mp4a.40.2,avc1.42c01e",RESOLUTION=640x360,FRAME-RATE=24
/pl/360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5520912,CODECS="mp4a.40.2,avc1.42c028",RESOLUTION=1920x1080
1080/index.m3u8?token=a
#EXT-X-STREAM-INF:BANDWIDTH=3018071,RESOLUTION=1280x720
https://other.example/720.m3u8
`;

test('a master playlist lists its qualities, resolved and best first', () => {
  const p = parsePlaylist(MASTER, 'https://cdn.example/hls/master.m3u8');
  assert.equal(p.master, true);
  assert.deepEqual(p.variants.map((v: { url: string }) => v.url), [
    'https://cdn.example/pl/360.m3u8',
    'https://cdn.example/hls/1080/index.m3u8?token=a',
    'https://other.example/720.m3u8',
  ]);
  const q = qualities(p, 600);
  assert.deepEqual(q.map((v: { label: string }) => v.label), ['1080p', '720p', '360p']);
  assert.equal(q[0].index, 1);
  assert.equal(q[0].bytes, Math.round((5520912 / 8) * 600));
  assert.equal(pickVariant(p).height, 1080);
  assert.equal(pickVariant(p, 0).height, 360);
});

test('a variant whose audio is a separate stream is listed but not picked', () => {
  const p = parsePlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="aud"
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
v720.m3u8
`, 'https://cdn.example/m.m3u8');
  assert.deepEqual(qualities(p, 10).map((v: { supported: boolean }) => v.supported), [false, true]);
  assert.equal(pickVariant(p).height, 720);
  assert.equal(pickVariant(p, 0), null);
});

test('a media playlist: segments, durations, keys, init segment and byte ranges', () => {
  const p = parsePlaylist(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:6.0,
seg-1.m4s
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k",IV=0x0102
#EXTINF:5.5,
#EXT-X-BYTERANGE:1000@720
media.mp4
#EXT-X-DISCONTINUITY
#EXTINF:4,
#EXT-X-BYTERANGE:500
media.mp4
#EXT-X-KEY:METHOD=NONE
#EXTINF:2.5,
/abs/last.ts
#EXT-X-ENDLIST
`, 'https://cdn.example/v/index.m3u8');
  assert.equal(p.master, false);
  assert.equal(p.endList, true);
  assert.equal(p.duration, 18);
  assert.deepEqual(p.map, { url: 'https://cdn.example/v/init.mp4', range: { length: 720, offset: 0 } });
  assert.deepEqual(p.segments.map((s: { sequence: number }) => s.sequence), [5, 6, 7, 8]);
  assert.equal(p.segments[0].key, null);
  assert.equal(p.segments[1].key?.uri, 'https://keys.example/k');
  assert.equal(p.segments[1].key?.iv?.toString('hex'), '00000000000000000000000000000102');
  assert.deepEqual(p.segments[1].range, { length: 1000, offset: 720 });
  assert.deepEqual(p.segments[2].range, { length: 500, offset: 1720 }, 'a range without an offset follows the last');
  assert.equal(p.segments[2].discontinuity, true);
  assert.equal(p.segments[3].key, null);
  assert.equal(p.segments[3].url, 'https://cdn.example/abs/last.ts');
});

test('not a playlist at all', () => {
  assert.throws(() => parsePlaylist('<html>nope</html>', 'https://cdn.example/'), /isn’t a playlist/);
});

test('ivFor: the playlist\'s IV, else the sequence number', () => {
  assert.equal(ivFor({ sequence: 258, key: { method: 'AES-128' } }).toString('hex'), '00000000000000000000000000000102');
  const iv = Buffer.alloc(16, 7);
  assert.equal(ivFor({ sequence: 1, key: { iv } }), iv);
});

test('tsStart: finds MPEG-TS behind a disguise, and nothing in something else', () => {
  const ts = Buffer.alloc(188 * 4);
  for (let i = 0; i < 4; i++) ts[i * 188] = 0x47;
  assert.equal(tsStart(ts), 0);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), ts]);
  assert.equal(tsStart(png), 16);
  assert.equal(tsStart(Buffer.from('<html><body>Not found</body></html>'.repeat(20))), -1);
});

test('pickVariant by height: the tallest no taller, else the smallest', () => {
  const p = parsePlaylist(MASTER, 'https://cdn.example/m.m3u8');
  assert.equal(pickVariant(p, undefined, 720).height, 720);
  assert.equal(pickVariant(p, undefined, 1000).height, 720);
  assert.equal(pickVariant(p, undefined, 2160).height, 1080);
  assert.equal(pickVariant(p, undefined, 240).height, 360);
});
