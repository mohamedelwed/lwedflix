// ODM bridge.
//
// The player is a third-party iframe (vidsrc, vidcore, 2embed, videasy,
// vidlink), so the page never sees a media URL it could hand over. Instead we
// watch the session's media traffic the way ODM's own browser extension does
// (extension/src/lib/streams.ts in ODM), keep the last few candidates per
// provider frame, and send the one the user picks over ODM's local named pipe.
//
// Nothing is downloaded here: ODM owns the queue, the connections and the
// resume. This file only captures, labels and forwards.

const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

// Ads, thumbnails and previews are under this; a stream is never.
const MIN_VIDEO_BYTES = 2 * 1024 * 1024;
// A signed CDN URL dies quickly; an older entry is worse than nothing.
const STREAM_TTL_MS = 10 * 60 * 1000;
const MAX_PER_FRAME = 20;
const MAX_FRAMES = 12;
const PIPE_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 9000;
// Where the "Get ODM" button sends someone who doesn't have it.
const ODM_SITE = 'https://salimos.cc/odm';

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'video/x-mpegurl',
  'video/mpegurl',
  'application/mpegurl',
]);
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/ogg',
]);
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'];
const SEGMENT_EXTENSIONS = ['.m4s', '.ts', '.m4f', '.cmfv', '.cmfa'];

// Header lookups are case-insensitive on the way in (Chromium sends lower-case
// names, the extension's requests carry the original casing), so normalise.
function header(headers, name) {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

function pathOf(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
}

function numberOf(text) {
  return text !== undefined && /^\s*\d+\s*$/.test(text) ? Number(text) : undefined;
}

/** Total size from `Content-Range: bytes a-b/TOTAL`, else `Content-Length`. */
function responseSize(contentLength, contentRange) {
  const total = numberOf(contentRange?.match(/\/\s*(\d+)\s*$/)?.[1]);
  return total ?? numberOf(contentLength);
}

/** `hls`, `dash` or `file` for a response worth offering; null for everything else. */
function classify(url, contentType, size) {
  const pathname = pathOf(url);
  if (pathname === null) return null;
  if (new URL(url).hostname.toLowerCase().endsWith('googlevideo.com')) return null;

  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (pathname.endsWith('.m3u8') || HLS_TYPES.has(type)) return 'hls';
  if (pathname.endsWith('.mpd') || type === 'application/dash+xml') return 'dash';
  // One segment of a stream is never the whole video. Proxies hide the real
  // name in the query (`px.php?play=…%2Fseg-1-s1080p`), so decode first.
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // A stray % is not worth failing over.
  }
  if (
    SEGMENT_EXTENSIONS.some((e) => pathname.endsWith(e)) ||
    /(^|[/_-])(seg|init|frag|chunk)[-_]?\d/i.test(decoded)
  ) {
    return null;
  }
  const byType = VIDEO_TYPES.has(type);
  const byExtension =
    (type === '' || type === 'application/octet-stream') &&
    VIDEO_EXTENSIONS.some((e) => pathname.endsWith(e));
  if ((byType || byExtension) && size !== undefined && size >= MIN_VIDEO_BYTES) return 'file';
  return null;
}

function formatBytes(bytes) {
  if (bytes === undefined) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function streamLabel(url, size) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return [last, formatBytes(size), u.host].filter(Boolean).join(' · ');
  } catch {
    return url;
  }
}

function extensionOf(url) {
  const pathname = pathOf(url);
  if (!pathname) return undefined;
  return VIDEO_EXTENSIONS.find((e) => pathname.endsWith(e));
}

/** What the player may say about the title, for the file name. */
function titleFor(meta) {
  const title = (meta?.title || '').trim();
  if (!title) return '';
  if (meta?.type === 'tv' && Number.isFinite(meta?.season)) {
    return `${title} - S${String(meta.season).padStart(2, '0')}E${String(meta.episode ?? 1).padStart(2, '0')}`;
  }
  return title;
}

function fileName(meta, stream) {
  const title = titleFor(meta) || 'Video';
  const ext = stream.kind === 'hls' ? '.mp4' : extensionOf(stream.url) ?? '.mp4';
  const raw = `${title}${ext}`;
  // ODM sanitises too; this keeps the request readable before it gets there.
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120) || 'Video.mp4';
}

/** Recent streams, grouped by the frame that asked for them. */
class Registry {
  constructor() {
    // frameKey -> { url, seenAt, items: Map<url, item> }
    this.frames = new Map();
  }

  add({ frameUrl, url, kind, size, mime, requestHeaders }) {
    const key = frameUrl || '';
    const now = Date.now();
    let group = this.frames.get(key);
    if (!group) {
      group = { url: key, seenAt: now, items: new Map() };
      this.frames.set(key, group);
      if (this.frames.size > MAX_FRAMES) {
        const oldest = [...this.frames.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)[0];
        if (oldest) this.frames.delete(oldest[0]);
      }
    }
    group.seenAt = now;

    const existing = group.items.get(url);
    if (existing) {
      existing.capturedAt = now;
      existing.size = size ?? existing.size;
      existing.requestHeaders = requestHeaders ?? existing.requestHeaders;
      return existing;
    }

    const item = {
      id: randomUUID(),
      url,
      kind,
      size,
      mime,
      host: new URL(url).host,
      label: streamLabel(url, size),
      frameUrl: frameUrl || null,
      capturedAt: now,
      requestHeaders: requestHeaders ?? {},
    };
    group.items.set(url, item);
    if (group.items.size > MAX_PER_FRAME) {
      const oldest = [...group.items.entries()].sort((a, b) => a[1].capturedAt - b[1].capturedAt)[0];
      if (oldest) group.items.delete(oldest[0]);
    }
    return item;
  }

  prune(now = Date.now()) {
    for (const [key, group] of this.frames) {
      for (const [url, item] of group.items) {
        if (now - item.capturedAt > STREAM_TTL_MS) group.items.delete(url);
      }
      const latest = Math.max(0, ...[...group.items.values()].map((i) => i.capturedAt));
      if (group.items.size === 0 && now - latest > STREAM_TTL_MS) this.frames.delete(key);
    }
  }

  /** The player navigated (new episode, new server): nothing older is current. */
  clear() {
    this.frames.clear();
  }

  /** Streams whose frame is one of `origins`; with no match, everything recent. */
  list(origins) {
    this.prune();
    const wanted = (origins ?? []).map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return null;
      }
    }).filter(Boolean);

    const all = [];
    for (const group of this.frames.values()) {
      const frameOrigin = (() => {
        try {
          return group.url ? new URL(group.url).origin : null;
        } catch {
          return null;
        }
      })();
      const matches = wanted.length === 0 || (frameOrigin !== null && wanted.includes(frameOrigin));
      if (!matches) continue;
      for (const item of group.items.values()) all.push(item);
    }
    const pool = all.length > 0 ? all : [...this.frames.values()].flatMap((g) => [...g.items.values()]);
    // A master playlist and the media playlists it names are one stream. When
    // both were captured, keep the master (ODM picks the best variant from it)
    // and hide the variants, so the menu does not offer duplicates.
    const masterHosts = new Set(
      pool.filter((item) => item.kind === 'hls' && /master/i.test(item.url)).map((item) => item.host),
    );
    const distinct = pool.filter(
      (item) => !(item.kind === 'hls' && !/master/i.test(item.url) && masterHosts.has(item.host)),
    );
    const rank = (item) => (item.kind === 'hls' && /master/i.test(item.url) ? 0 : 1);
    return distinct
      .sort((a, b) => rank(a) - rank(b) || b.capturedAt - a.capturedAt)
      .slice(0, 12)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        size: item.size,
        host: item.host,
        ageMs: Date.now() - item.capturedAt,
        supported: item.kind !== 'dash',
      }));
  }

  get(id) {
    this.prune();
    for (const group of this.frames.values()) {
      for (const item of group.items.values()) if (item.id === id) return item;
    }
    return null;
  }
}

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

/** The cookies ODM itself doesn't have: the ones the provider's session set. */
async function cookieHeader(ses, url) {
  try {
    const cookies = await ses.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

function pickRequestHeaders(requestHeaders) {
  const picked = {};
  for (const name of ['Referer', 'Origin', 'User-Agent']) {
    const value = header(requestHeaders, name);
    if (value) picked[name] = value;
  }
  return picked;
}

/**
 * Wires capture + IPC. `isFromAppPage` is the shell's guard: only the app's own
 * origin may ask, never an embedded player.
 */
function setupOdm({ ses, ipcMain, isFromAppPage, webContents, openExternal }) {
  const streams = new Registry();
  const sent = new Map(); // url -> picked request headers

  // Switching server or episode reloads the player iframe; streams from the
  // previous one are no longer what is playing. Only a top-level frame
  // (the player) counts — ad frames navigate constantly inside it, and the
  // trailer iframe is YouTube.
  if (webContents) {
    webContents.on(
      'did-frame-navigate',
      (_event, url, _code, _status, isMainFrame, frameProcessId, frameRoutingId) => {
        if (isMainFrame) return;
        let host;
        try {
          host = new URL(url).hostname.toLowerCase();
        } catch {
          return;
        }
        if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host.endsWith('googlevideo.com')) return;
        const frame = webContents.mainFrame.frames.find(
          (f) => f.processId === frameProcessId && f.routingId === frameRoutingId,
        );
        if (!frame || frame.parent !== webContents.mainFrame) return;
        streams.clear();
      },
    );
  }

  // No `types` filter: the filter enum has no `other`, and some players fetch
  // media as `other`. Classification drops everything irrelevant.
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const picked = pickRequestHeaders(details.requestHeaders);
      if (Object.keys(picked).length > 0) {
        if (sent.size > 400) sent.clear();
        sent.set(details.url, picked);
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  ses.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const size = responseSize(
        header(details.responseHeaders, 'content-length'),
        header(details.responseHeaders, 'content-range'),
      );
      const kind = classify(
        details.url,
        header(details.responseHeaders, 'content-type'),
        size,
      );
      if (kind) {
        streams.add({
          frameUrl: details.frame?.url ?? null,
          url: details.url,
          kind,
          size,
          mime: header(details.responseHeaders, 'content-type'),
          requestHeaders: sent.get(details.url) ?? {},
        });
      }
      callback({ responseHeaders: details.responseHeaders });
    },
  );

  ipcMain.handle('odm:available', () => isRunning());

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

  ipcMain.handle('odm:streams', (event, origins) => {
    if (!isFromAppPage(event)) return [];
    return streams.list(Array.isArray(origins) ? origins : []);
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

module.exports = { setupOdm, classify, responseSize, fileName, titleFor, isInstalled, ODM_SITE };

// Reachable for the tests in `npm run test:odm`; not part of the app's API.
module.exports.__test = { Registry, ask, ensureRunning, pipeName, pickRequestHeaders, odmExecutable };

