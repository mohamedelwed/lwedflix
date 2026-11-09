// What the embedded players play.
//
// The player is a third-party iframe (vidsrc, vidcore, 2embed, videasy,
// vidlink), so the page never sees a media URL. Instead the session's media
// traffic is watched the way ODM's browser extension does it
// (extension/src/lib/streams.ts in ODM): each HLS playlist, DASH manifest or
// video file a player frame loads is kept, newest first, with the request
// headers its server wants (Referer, Origin, User-Agent). Downloads
// (downloads.js) and, on Windows, ODM (odm.js) take a stream from here.

const { randomUUID } = require('node:crypto');

// Ads, thumbnails and previews are under this; a stream is never.
const MIN_VIDEO_BYTES = 2 * 1024 * 1024;
// A signed CDN URL dies quickly; an older entry is worse than nothing.
const STREAM_TTL_MS = 10 * 60 * 1000;
const MAX_PER_FRAME = 20;
const MAX_FRAMES = 12;

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
// A feature's media playlist runs to 100 KB and more; a pre-roll ad's is a
// few KB. Only a hint for ordering: a master playlist is small too.
const SHORT_PLAYLIST_BYTES = 16 * 1024;
const QUALITY = /(?:^|[^\d])(4320|2160|1440|1080|720|576|480|360|240)p/i;
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

/** "1080p" when the URL names a resolution (`index-s1080p`, `/720p/`). */
function qualityOf(url) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep the raw URL
  }
  const match = decoded.match(QUALITY);
  return match ? `${match[1]}p` : null;
}

const isMaster = (item) => item.kind === 'hls' && /master/i.test(item.url);

/**
 * Most likely to be the film first: a master playlist (ODM picks the best
 * variant), then media playlists by size (an ad's is short), then files by
 * size, then DASH, which ODM can't download yet.
 */
function rank(item) {
  if (isMaster(item)) return 0;
  if (item.kind === 'hls') return item.size !== undefined && item.size < SHORT_PLAYLIST_BYTES ? 3 : 1;
  if (item.kind === 'file') return 2;
  return 4;
}

/** What the menu shows for a stream: what it is, then where it's from. */
function describe(item) {
  const quality = qualityOf(item.url);
  const title = isMaster(item)
    ? 'Stream · every quality'
    : item.kind === 'hls'
      ? `Stream${quality ? ` · ${quality}` : ''}`
      : item.kind === 'file'
        ? `Video file${quality ? ` · ${quality}` : ''}`
        : 'DASH stream';
  const detail = [item.kind === 'file' ? formatBytes(item.size) : '', item.host].filter(Boolean).join(' · ');
  return { title, detail, quality };
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

  /**
   * @param {{ frameUrl?: string | null, url: string, kind: string, size?: number, mime?: string, requestHeaders?: Record<string, string> }} stream
   */
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
    const masterHosts = new Set(pool.filter(isMaster).map((item) => item.host));
    const distinct = pool.filter(
      (item) => !(item.kind === 'hls' && !isMaster(item) && masterHosts.has(item.host)),
    );
    const listed = distinct
      .sort((a, b) => rank(a) - rank(b) || (b.size ?? 0) - (a.size ?? 0) || b.capturedAt - a.capturedAt)
      .slice(0, 12);
    const best = listed.find((item) => item.kind !== 'dash');
    return listed.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      ...describe(item),
      size: item.size,
      host: item.host,
      ageMs: Date.now() - item.capturedAt,
      supported: item.kind !== 'dash',
      best: item === best,
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

/** The cookies the provider's session set, for a fetch made outside it. */
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
 * Starts watching the session. Returns the registry the IPC handlers read.
 * Switching server or episode reloads the player iframe, which clears it:
 * streams from the previous one are no longer what is playing.
 */
function captureStreams({ ses, webContents }) {
  const streams = new Registry();
  const sent = new Map(); // url -> picked request headers

  // Only a top-level frame (the player) counts — ad frames navigate
  // constantly inside it, and the trailer iframe is YouTube.
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
  //
  // Both listeners only observe. The blocking events (onBeforeSendHeaders,
  // onHeadersReceived) would hold every request in the session for a round
  // trip to this process, and Electron keeps one listener per event, so they
  // would also fight any other code that needs them.
  ses.webRequest.onSendHeaders(
    { urls: ['<all_urls>'] },
    (details) => {
      const picked = pickRequestHeaders(details.requestHeaders);
      if (Object.keys(picked).length > 0) {
        if (sent.size > 400) sent.clear();
        sent.set(details.url, picked);
      }
    },
  );

  ses.webRequest.onResponseStarted(
    { urls: ['<all_urls>'] },
    (details) => {
      if (details.statusCode >= 400) return;
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
    },
  );

  return streams;
}

module.exports = {
  captureStreams,
  classify,
  responseSize,
  fileName,
  titleFor,
  formatBytes,
  cookieHeader,
  pickRequestHeaders,
  Registry,
  qualityOf,
};
