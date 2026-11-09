import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { isInstalled, ODM_SITE, __test } from '../electron/odm.js';

const { ask, pipeName, odmExecutable } = __test;

// A pipe of our own, so the tests never reach a running ODM. On macOS and
// Linux (CI) a Unix socket stands in for the Windows named pipe.
process.env.ODM_PIPE_NAME = process.platform === 'win32'
  ? `\\\\.\\pipe\\odm-test-${process.pid}`
  : path.join(os.tmpdir(), `odm-test-${process.pid}.sock`);

test('isInstalled: follows ODM_EXE and the install locations', () => {
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
      const body = Buffer.from(JSON.stringify({ id: request.id ?? null, ok: true, payload: { download_id: 'dl-1', saw: request.cmd } }));
      const frame = Buffer.alloc(4 + body.length);
      frame.writeUInt32LE(body.length, 0);
      body.copy(frame, 4);
      socket.write(frame);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName(), () => resolve());
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const reply = await ask({ id: 't1', cmd: 'PING' });
  assert.equal(reply.ok, true);
  assert.equal(reply.payload.saw, 'PING');
  assert.equal(reply.payload.download_id, 'dl-1');
});

test('pipe: a missing ODM rejects instead of hanging', async () => {
  const saved = process.env.ODM_PIPE_NAME;
  process.env.ODM_PIPE_NAME = `${saved}-absent`;
  try {
    await assert.rejects(() => ask({ cmd: 'PING' }, 800));
  } finally {
    process.env.ODM_PIPE_NAME = saved;
  }
});
