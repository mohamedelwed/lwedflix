// HLS playlists, for downloads: the qualities a master playlist offers, and
// the segments, keys and init segment of a media playlist.

/** `BANDWIDTH=1,CODECS="a,b"` → { BANDWIDTH: '1', CODECS: 'a,b' }. */
function attributes(text) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}

/** `length@offset`; without an offset, the range follows the previous one. */
function byteRange(spec, previousEnd) {
  const [length, offset] = spec.split('@');
  return { length: Number(length), offset: offset !== undefined ? Number(offset) : previousEnd };
}

function parsePlaylist(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('The server sent something that isn’t a playlist.');
  const resolve = (uri) => new URL(uri, baseUrl).href;
  const variants = [];
  const audio = [];
  const segments = [];
  let map = null;
  let key = null;
  let variant = null;
  let duration = 0;
  let range = null;
  let rangeEnd = 0;
  let sequence = 0;
  let discontinuity = false;
  let endList = false;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attributes(line.slice(18));
      const [width, height] = (a.RESOLUTION || '').split('x').map(Number);
      variant = { bandwidth: Number(a.BANDWIDTH) || 0, width: width || 0, height: height || 0, codecs: a.CODECS || '', audio: a.AUDIO || null };
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attributes(line.slice(13));
      if (a.TYPE === 'AUDIO') audio.push({ group: a['GROUP-ID'], uri: a.URI ? resolve(a.URI) : null, name: a.NAME || '' });
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice(22)) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const a = attributes(line.slice(11));
      key = a.METHOD && a.METHOD !== 'NONE'
        ? { method: a.METHOD, uri: a.URI ? resolve(a.URI) : null, iv: a.IV ? Buffer.from(a.IV.replace(/^0x/i, '').padStart(32, '0'), 'hex') : null }
        : null;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = attributes(line.slice(11));
      map = { url: resolve(a.URI), range: a.BYTERANGE ? byteRange(a.BYTERANGE, 0) : null };
    } else if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      range = byteRange(line.slice(17), rangeEnd);
    } else if (line === '#EXT-X-DISCONTINUITY') {
      discontinuity = true;
    } else if (line === '#EXT-X-ENDLIST') {
      endList = true;
    } else if (!line.startsWith('#')) {
      if (variant) {
        variants.push({ ...variant, url: resolve(line) });
        variant = null;
      } else {
        if (range) rangeEnd = range.offset + range.length;
        segments.push({ url: resolve(line), duration, key, sequence: sequence + segments.length, range, discontinuity });
        duration = 0;
        range = null;
        discontinuity = false;
      }
    }
  }
  return {
    master: variants.length > 0,
    variants,
    audio,
    segments,
    map,
    endList,
    duration: segments.reduce((s, seg) => s + seg.duration, 0),
  };
}

/** A variant whose sound isn't in its own stream (which would need muxing in). */
function hasSeparateAudio(variant, playlist) {
  return Boolean(variant.audio && playlist.audio.some((a) => a.group === variant.audio && a.uri));
}

/** The qualities to offer, best first; each with its index into `variants`. */
function qualities(playlist, durationSeconds) {
  return playlist.variants
    .map((v, index) => ({
      index,
      height: v.height,
      label: v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`,
      bytes: durationSeconds > 0 && v.bandwidth > 0 ? Math.round((v.bandwidth / 8) * durationSeconds) : null,
      supported: !hasSeparateAudio(v, playlist),
    }))
    .sort((a, b) => b.height - a.height || (b.bytes ?? 0) - (a.bytes ?? 0));
}

/**
 * The variant to download: the one asked for by index; else the tallest no
 * taller than `maxHeight` (or the smallest, if all are taller); else the best.
 */
function pickVariant(playlist, index, maxHeight) {
  const usable = (v) => v && !hasSeparateAudio(v, playlist);
  if (index !== undefined && index !== null) return usable(playlist.variants[index]) ? playlist.variants[index] : null;
  const best = [...playlist.variants].filter(usable).sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  if (maxHeight) return best.find((v) => v.height && v.height <= maxHeight) ?? best[best.length - 1] ?? null;
  return best[0] ?? null;
}

/** AES-128 IV: the playlist's, else the segment's sequence number. */
function ivFor(segment) {
  if (segment.key?.iv) return segment.key.iv;
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(segment.sequence), 8);
  return iv;
}

/**
 * Where MPEG-TS packets start: servers dress segments up as images or pages
 * (a PNG header in front, an .html name), but three sync bytes 188 apart
 * give the real start away. -1 when there are none.
 */
function tsStart(buf) {
  const limit = Math.min(buf.length - 188, 64 * 1024);
  for (let k = 0; k < limit; k++) {
    if (buf[k] === 0x47 && buf[k + 188] === 0x47 && (k + 376 >= buf.length || buf[k + 376] === 0x47)) return k;
  }
  return -1;
}

module.exports = { attributes, parsePlaylist, qualities, pickVariant, hasSeparateAudio, ivFor, tsStart };
