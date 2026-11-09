// ODM bridge (Windows).
//
// Sends a stream the player is using (streams.js) to ODM, a Windows download
// manager, over its local named pipe: ODM then owns the queue, the
// connections and the resume. Everywhere else, and when ODM isn't installed,
// downloads.js downloads it instead.

const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { titleFor, fileName, cookieHeader, pickRequestHeaders } = require('./streams');

const PIPE_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 9000;
// Where the "Get ODM" button sends someone who doesn't have it.
const ODM_SITE = 'https://salimos.cc/odm';

function pipeName() {
  // Same override ODM honours (odm_core::ids::pipe_name_for), so a second
  // instance or a test can use its own pipe.
  const override = process.env.ODM_PIPE_NAME;
  if (override) return override;
  return `\\\\.\\pipe\\odm-${process.env.USERNAME || 'user'}`;
}

/** One request/response over ODM's length-prefixed JSON pipe. */
function ask(request, timeoutMs = PIPE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName());
    let buffered = Buffer.alloc(0);
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('ODM did not answer in time.')), timeoutMs);

    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify(request));
      const frame = Buffer.alloc(4 + body.length);
      frame.writeUInt32LE(body.length, 0);
      body.copy(frame, 4);
      socket.write(frame);
    });
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (length > 1 << 20) return finish(new Error('ODM sent an oversized reply.'));
      if (buffered.length < 4 + length) return;
      try {
        finish(null, JSON.parse(buffered.subarray(4, 4 + length).toString('utf8')));
      } catch {
        finish(new Error('ODM sent a malformed reply.'));
      }
    });
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(new Error('ODM closed the pipe.')));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function odmExecutable() {
  const candidates = [
    process.env.ODM_EXE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ODM', 'ODM.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'ODM', 'ODM.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'ODM', 'ODM.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Whether ODM is on this machine at all — installed, running or not. */
function isInstalled() {
  return odmExecutable() !== null;
}

async function isRunning() {
  try {
    const reply = await ask({ id: 'ping', cmd: 'PING' }, 1200);
    return Boolean(reply?.ok);
  } catch {
    return false;
  }
}

/** True when ODM answers, starting it in the tray first if it isn't up. */
async function ensureRunning() {
  if (await isRunning()) return true;
  const exe = odmExecutable();
  if (!exe) return false;
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    return false;
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(450);
    if (await isRunning()) return true;
  }
  return false;
}

/**
 * The ODM handlers. `isFromAppPage` is the shell's guard: only the app's own
 * origin may ask, never an embedded player.
 */
function setupOdm({ ses, ipcMain, isFromAppPage, streams, openExternal }) {
  // Installed is different from running: without it, the menu offers the site
  // instead of a download that could never start.
  ipcMain.handle('odm:status', async (event) => {
    if (!isFromAppPage(event)) return { installed: false, running: false };
    return { installed: isInstalled(), running: await isRunning() };
  });

  ipcMain.handle('odm:open-site', async (event) => {
    if (!isFromAppPage(event)) return { ok: false };
    try {
      await openExternal?.(ODM_SITE);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('odm:download', async (event, id, meta) => {
    if (!isFromAppPage(event)) return { ok: false, error: 'Not the app.' };
    const stream = streams.get(id);
    if (!stream) {
      return { ok: false, error: 'That stream is no longer listed — press play again.' };
    }
    if (!(await ensureRunning())) {
      return { ok: false, error: 'ODM is not running, and it could not be started.' };
    }

    const headers = pickRequestHeaders(stream.requestHeaders);
    const cookies = await cookieHeader(ses, stream.url);
    // ADD_STREAM has no filename field; ODM names the file from page_title,
    // so the episode has to be in it.
    const title = titleFor(meta) || stream.host;

    try {
      const reply =
        stream.kind === 'hls'
          ? await ask({
              id: randomUUID(),
              cmd: 'ADD_STREAM',
              payload: {
                page_url: stream.frameUrl ?? '',
                page_title: title,
                playlist_url: stream.url,
                headers,
                cookies,
              },
            })
          : await ask({
              id: randomUUID(),
              cmd: 'ADD_DOWNLOAD',
              payload: {
                url: stream.url,
                filename: fileName(meta, stream),
                referrer: stream.frameUrl ?? '',
                headers,
                cookies,
                filesize: stream.size,
                mime: stream.mime,
                source: 'menu',
              },
            });

      if (reply?.ok) {
        return { ok: true, downloadId: reply.payload?.download_id ?? null };
      }
      return {
        ok: false,
        error: reply?.error?.message || 'ODM refused the download.',
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

module.exports = { setupOdm, isInstalled, ODM_SITE };

// Reachable for tests/odm.test.ts; not part of the app's API.
module.exports.__test = { ask, ensureRunning, pipeName, odmExecutable };
