// Smoke tests for the ODM bridge that need neither Electron nor ODM running.
// Run with: node electron/odm.test.js
const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

// A pipe of our own: tests must not talk to (or collide with) a running ODM.
process.env.ODM_PIPE_NAME = `\\\\.\\pipe\\odm-test-${process.pid}`;

const { classify, responseSize, fileName, titleFor, isInstalled, ODM_SITE } = require('./odm');
const { Registry, ask, pipeName, odmExecutable } = require('./odm').__test;

test('classify: HLS by extension and by MIME, regardless of size', () => {
  assert.equal(classify('https://cdn.example/a/b.m3u8?token=1', undefined, undefined), 'hls');
  assert.equal(
    classify('https://cdn.example/play?token=1', 'application/vnd.apple.mpegurl', undefined),
    'hls',
  );
  assert.equal(classify('https://cdn.example/a.m3u8', 'text/plain', 10), 'hls');
});

test('classify: DASH is reported, not silently dropped', () => {
  assert.equal(classify('https://cdn.example/a.mpd', undefined, undefined), 'dash');
  assert.equal(classify('https://cdn.example/x', 'application/dash+xml', undefined), 'dash');
});

test('classify: a plain video file needs a video type or extension and 2 MiB', () => {
  const url = 'https://cdn.example/a/b.mp4?sign=x&t=1';
  assert.equal(classify(url, 'video/mp4', 3 * 1024 * 1024), 'file');
  assert.equal(classify(url, 'video/mp4', 1024 * 1024), null);
  assert.equal(classify(url, 'application/octet-stream', 3 * 1024 * 1024), 'file');
  assert.equal(classify('https://cdn.example/file.bin', 'application/octet-stream', 9e9), null);
  assert.equal(classify(url, 'image/jpeg', 9e9), null);
});

test('classify: segments, previews and YouTube never become a download', () => {
  assert.equal(classify('https://cdn.example/seg-001.ts', 'video/mp2t', 9e9), null);
  assert.equal(classify('https://cdn.example/a/seg_12.m4s', 'video/iso.segment', 9e9), null);
  assert.equal(classify('https://cdn.example/seg12.mp4', 'video/mp4', 9e9), null);
  assert.equal(classify('https://rr1.googlevideo.com/a.mp4', 'video/mp4', 9e9), null);
  assert.equal(classify('not a url', 'video/mp4', 9e9), null);
  // A proxy puts the real name in the query: still a segment, not a file.
  const proxy = 'https://colourful.example/px.php?play=https%3A%2F%2Fup.example%2Fvd%2Fabc%2Fseg-1-s1080p-v';
  assert.equal(classify(proxy, 'video/mp4', 4159171), null);
  const init = 'https://colourful.example/px.php?play=https%3A%2F%2Fup.example%2Fvd%2Fabc%2Finit-s1080p-v1';
  assert.equal(classify(init, 'video/mp4', 1210), null);
  // …and its manifest is still HLS.
  const manifest = 'https://colourful.example/px.php?play=https%3A%2F%2Fup.example%2Fvd%2Fabc%2Findex-s1080p';
  assert.equal(classify(manifest, 'application/vnd.apple.mpegurl', 288771), 'hls');
});

test('responseSize: Content-Range total wins over Content-Length', () => {
  assert.equal(responseSize('1024', 'bytes 0-1023/734003200'), 734003200);
  assert.equal(responseSize('1024', undefined), 1024);
  assert.equal(responseSize(undefined, 'bytes 0-1/*'), undefined);
  assert.equal(responseSize('abc', undefined), undefined);
});

test('fileName: movie, episode, and hostile characters', () => {
  const stream = { url: 'https://cdn.example/x.mp4?t=1', kind: 'file' };
  assert.equal(fileName({ title: 'Fight Club' }, stream), 'Fight Club.mp4');
  assert.equal(
    fileName({ title: 'Severance', type: 'tv', season: 2, episode: 7 }, stream),
    'Severance - S02E07.mp4',
  );
  assert.equal(fileName({ title: 'A/B: "C"?' }, stream), 'AB C.mp4');
  assert.equal(fileName({}, stream), 'Video.mp4');
  assert.equal(fileName({ title: 'Film' }, { url: 'https://cdn.example/x.mkv', kind: 'file' }), 'Film.mkv');
  assert.equal(fileName({ title: 'Film' }, { url: 'https://cdn.example/x.m3u8', kind: 'hls' }), 'Film.mp4');
});

test('titleFor: the title ODM names an HLS file from', () => {
  assert.equal(titleFor({ title: 'Fight Club', type: 'movie' }), 'Fight Club');
  assert.equal(titleFor({ title: 'Lupin', type: 'tv', season: 1, episode: 3 }), 'Lupin - S01E03');
  assert.equal(titleFor({ title: 'Lupin', type: 'tv', season: 1 }), 'Lupin - S01E01');
  assert.equal(titleFor({}), '');
  assert.equal(titleFor(undefined), '');
});

test('Registry: keeps the newest per frame, prunes segments, filters by origin', () => {
  const registry = new Registry();
  const frame = 'https://vidlink.pro/movie/550';
  registry.add({ frameUrl: frame, url: 'https://cdn.example/a.mp4', kind: 'file', size: 5e6 });
  registry.add({ frameUrl: frame, url: 'https://cdn.example/b.m3u8', kind: 'hls' });
  registry.add({ frameUrl: 'https://vidsrc.sh/embed/movie/550', url: 'https://cdn.example/c.mp4', kind: 'file', size: 6e6 });

  const vidlink = registry.list(['https://vidlink.pro']);
  assert.equal(vidlink.length, 2);
  assert.ok(vidlink.every((s) => s.supported));
  assert.equal(registry.list(['https://vidlink.pro', 'https://player.videasy.to']).length, 2);
  // Unknown origin falls back to everything captured.
  assert.equal(registry.list(['https://unknown.example']).length, 3);
  assert.equal(registry.list([]).length, 3);
});

test('Registry: a stream id resolves to the same entry', () => {
  const registry = new Registry();
  const added = registry.add({ frameUrl: 'https://vidlink.pro/x', url: 'https://cdn/a.mp4', kind: 'file', size: 3e6 });
  assert.equal(registry.get(added.id).url, 'https://cdn/a.mp4');
  assert.equal(registry.get('nope'), null);
});

test('Registry: masters come before their variants, then newest first', () => {
  const registry = new Registry();
  const frame = 'https://cdn.example/e/1';
  const media = registry.add({ frameUrl: frame, url: 'https://cdn.example/index.m3u8', kind: 'hls' });
  const master = registry.add({ frameUrl: frame, url: 'https://cdn.example/master.m3u8', kind: 'hls' });
  const listed = registry.list([]);
  assert.equal(listed[0].id, master.id);
  assert.equal(listed.length, 1, 'the variant is the same stream and is hidden');
  assert.ok(!listed.some((s) => s.id === media.id));
});

test('Registry: a master only hides variants on its own host', () => {
  const registry = new Registry();
  const frame = 'https://cdn.example/e/1';
  const master = registry.add({ frameUrl: frame, url: 'https://a.example/master.m3u8', kind: 'hls' });
  const otherHost = registry.add({ frameUrl: frame, url: 'https://b.example/index.m3u8', kind: 'hls' });
  const file = registry.add({ frameUrl: frame, url: 'https://a.example/movie.mp4', kind: 'file', size: 5e6 });
  const ids = registry.list([]).map((s) => s.id);
  assert.ok(ids.includes(master.id));
  assert.ok(ids.includes(otherHost.id), 'a different host may be a different source');
  assert.ok(ids.includes(file.id));
});

test('Registry: clear() forgets everything after the player navigates', () => {
  const registry = new Registry();
  registry.add({ frameUrl: 'https://a/x', url: 'https://cdn/a.mp4', kind: 'file', size: 3e6 });
  assert.equal(registry.list([]).length, 1);
  registry.clear();
  assert.equal(registry.list([]).length, 0);
});

test('isInstalled: follows ODM_EXE and the install locations', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-exe-'));
  const exe = path.join(dir, 'ODM.exe');
  fs.writeFileSync(exe, '');

  const keys = ['ODM_EXE', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    // Sandbox every location so a real install on this machine can't answer.
    process.env.LOCALAPPDATA = path.join(dir, 'none');
    process.env.ProgramFiles = path.join(dir, 'none');
    process.env['ProgramFiles(x86)'] = path.join(dir, 'none');
    process.env.ODM_EXE = path.join(dir, 'missing.exe');
    assert.equal(isInstalled(), false);

    process.env.ODM_EXE = exe;
    assert.equal(odmExecutable(), exe);
    assert.equal(isInstalled(), true);

    // No override, but the LOCALAPPDATA layout has it.
    delete process.env.ODM_EXE;
    fs.mkdirSync(path.join(dir, 'appdata', 'ODM'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'appdata', 'ODM', 'ODM.exe'), '');
    process.env.LOCALAPPDATA = path.join(dir, 'appdata');
    assert.equal(isInstalled(), true);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the ODM site is https', () => {
  assert.match(ODM_SITE, /^https:\/\/salimos\.cc\/odm$/);
});

test('pipe: length-prefixed JSON round trip against a mock ODM', async (t) => {
  const server = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (buffered.length < 4 + length) return;
      const request = JSON.parse(buffered.subarray(4, 4 + length).toString('utf8'));
      const body = Buffer.from(JSON.stringify({
        id: request.id ?? null,
        ok: true,
        payload: { download_id: 'dl-1', saw: request.cmd },
      }));
      const frame = Buffer.alloc(4 + body.length);
      frame.writeUInt32LE(body.length, 0);
      body.copy(frame, 4);
      socket.write(frame);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName(), resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const reply = await ask({ id: 't1', cmd: 'PING' });
  assert.equal(reply.ok, true);
  assert.equal(reply.payload.saw, 'PING');
  assert.equal(reply.payload.download_id, 'dl-1');
});

test('pipe: a missing ODM rejects instead of hanging', async () => {
  await assert.rejects(() => ask({ cmd: 'PING' }, 800));
});
