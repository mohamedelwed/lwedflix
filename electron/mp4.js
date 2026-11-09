// MP4 boxes, for downloads.
//
// A downloaded stream arrives as fragments: mux.js turns MPEG-TS chunks into
// fragmented MP4 (an init segment, then moof + mdat pairs), and fMP4 HLS
// servers send that shape already. Fragments suit a browser's streaming
// player, but saved as a file they need every fragment read before the
// length is known or a seek can land, and QuickTime rejects mux.js's
// fragment numbering outright. So the samples are copied out of each
// fragment into one ordinary MP4: the media in a single mdat, written as it
// arrives, and an index (moov) built at the end — what ffmpeg writes too.
// It opens and seeks at once everywhere.

const fsp = require('node:fs/promises');

/** The boxes between `start` and `end`: type, extent, and where the body starts. */
function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, start: at, end: at + size, body: at + header });
    at += size;
  }
  return out;
}

const child = (buf, parent, type) => (parent ? boxes(buf, parent.body, parent.end).find((b) => b.type === type) : undefined);

/** Tracks from an init segment (moov): id, timescale, kind, sample description. */
function parseInit(buf) {
  const moov = boxes(buf).find((b) => b.type === 'moov');
  if (!moov) throw new Error('The stream has no init segment.');
  const tracks = [];
  for (const trak of boxes(buf, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = child(buf, trak, 'tkhd');
    const mdia = child(buf, trak, 'mdia');
    const mdhd = child(buf, mdia, 'mdhd');
    const hdlr = child(buf, mdia, 'hdlr');
    const stsd = child(buf, child(buf, child(buf, mdia, 'minf'), 'stbl'), 'stsd');
    if (!tkhd || !mdhd || !hdlr || !stsd) continue;
    const idAt = tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12);
    const scaleAt = mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12);
    tracks.push({
      id: buf.readUInt32BE(idAt),
      timescale: buf.readUInt32BE(scaleAt),
      handler: buf.toString('latin1', hdlr.body + 8, hdlr.body + 12),
      width: buf.readUInt32BE(tkhd.end - 8) >>> 16,
      height: buf.readUInt32BE(tkhd.end - 4) >>> 16,
      stsd: Buffer.from(buf.subarray(stsd.start, stsd.end)),
      defaults: { duration: 0, size: 0, flags: 0 },
    });
  }
  // Per-track defaults a fragment may leave out (mvex/trex).
  const mvex = child(buf, moov, 'mvex');
  for (const trex of mvex ? boxes(buf, mvex.body, mvex.end).filter((b) => b.type === 'trex') : []) {
    const track = tracks.find((t) => t.id === buf.readUInt32BE(trex.body + 4));
    if (track) {
      track.defaults = {
        duration: buf.readUInt32BE(trex.body + 12),
        size: buf.readUInt32BE(trex.body + 16),
        flags: buf.readUInt32BE(trex.body + 20),
      };
    }
  }
  if (tracks.length === 0) throw new Error('The stream has no tracks.');
  return { tracks };
}

/**
 * The sample runs in a chunk of fragments: per run, its track, each sample's
 * size, duration, keyframe flag and composition offset, and the bytes.
 */
function parseFragments(buf, init) {
  const runs = [];
  const top = boxes(buf);
  top.forEach((moof, n) => {
    if (moof.type !== 'moof') return;
    const mdat = top.slice(n + 1).find((b) => b.type === 'mdat' || b.type === 'moof');
    let nextData = mdat?.type === 'mdat' ? mdat.body : moof.end;
    for (const traf of boxes(buf, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(buf, traf, 'tfhd');
      if (!tfhd) continue;
      const flags = buf.readUInt32BE(tfhd.body) & 0xffffff;
      let at = tfhd.body + 4;
      const trackId = buf.readUInt32BE(at);
      at += 4;
      let base = moof.start;
      if (flags & 0x01) {
        base = Number(buf.readBigUInt64BE(at));
        at += 8;
      }
      if (flags & 0x02) at += 4;
      const track = init.tracks.find((t) => t.id === trackId);
      let { duration: defDuration, size: defSize, flags: defFlags } = track?.defaults ?? { duration: 0, size: 0, flags: 0 };
      if (flags & 0x08) { defDuration = buf.readUInt32BE(at); at += 4; }
      if (flags & 0x10) { defSize = buf.readUInt32BE(at); at += 4; }
      if (flags & 0x20) { defFlags = buf.readUInt32BE(at); at += 4; }

      for (const trun of boxes(buf, traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const version = buf[trun.body];
        const tflags = buf.readUInt32BE(trun.body) & 0xffffff;
        let p = trun.body + 4;
        const read = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
        const count = read();
        let start = nextData;
        if (tflags & 0x001) start = base + buf.readInt32BE((p += 4) - 4);
        const firstFlags = tflags & 0x004 ? read() : null;
        const samples = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          const duration = tflags & 0x100 ? read() : defDuration;
          const size = tflags & 0x200 ? read() : defSize;
          const sampleFlags = tflags & 0x400 ? read() : i === 0 && firstFlags !== null ? firstFlags : defFlags;
          let cto = 0;
          if (tflags & 0x800) cto = version === 0 ? read() : buf.readInt32BE((p += 4) - 4);
          // sample_is_non_sync_sample
          samples.push({ duration, size, sync: ((sampleFlags >>> 16) & 1) === 0, cto });
          total += size;
        }
        if (start < 0 || start + total > buf.length) throw new Error('A fragment of the stream is cut short.');
        if (track && samples.length) runs.push({ trackId, samples, data: buf.subarray(start, start + total) });
        nextData = start + total;
      }
    }
  });
  return runs;
}

// ---- Writing --------------------------------------------------------------

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function fullBox(type, version, flags, ...parts) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version << 24) | flags) >>> 0);
  return box(type, vf, ...parts);
}

function u32(...values) {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
}

/** A table of 32-bit values, without spreading 300,000 of them into a call. */
function u32Table(values, signed = false) {
  const b = Buffer.alloc(4 * values.length);
  for (let i = 0; i < values.length; i++) {
    if (signed) b.writeInt32BE(values[i], i * 4);
    else b.writeUInt32BE(values[i] >>> 0, i * 4);
  }
  return b;
}

/** [value, value, value, other] → [[3, value], [1, other]]. */
function runLength(values) {
  const out = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

function trak(track, movieTimescale) {
  const video = track.handler === 'vide';
  const mediaDuration = track.durations.reduce((s, d) => s + d, 0);
  const movieDuration = Math.round((mediaDuration / track.timescale) * movieTimescale);

  const tkhd = fullBox('tkhd', 0, 3,
    u32(0, 0, track.id, 0, movieDuration, 0, 0),
    Buffer.from([0, 0, 0, 0, video ? 0 : 1, 0, 0, 0]), // layer, alternate group, volume, reserved
    MATRIX,
    u32(video ? track.width << 16 : 0, video ? track.height << 16 : 0));
  const mdhd = fullBox('mdhd', 0, 0, u32(0, 0, track.timescale, mediaDuration), Buffer.from([0x55, 0xc4, 0, 0])); // "und"
  const hdlr = fullBox('hdlr', 0, 0, u32(0), Buffer.from(track.handler, 'latin1'), u32(0, 0, 0),
    Buffer.from(video ? 'VideoHandler\0' : 'SoundHandler\0', 'latin1'));
  const mediaHeader = video ? fullBox('vmhd', 0, 1, Buffer.alloc(8)) : fullBox('smhd', 0, 0, Buffer.alloc(4));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

  const stts = runLength(track.durations);
  const tables = [
    track.stsd,
    fullBox('stts', 0, 0, u32(stts.length), u32Table(stts.flat())),
  ];
  if (track.ctos.some((c) => c !== 0)) {
    const negative = track.ctos.some((c) => c < 0);
    const ctts = runLength(track.ctos);
    const flat = ctts.flat();
    tables.push(fullBox('ctts', negative ? 1 : 0, 0, u32(ctts.length), u32Table(flat, negative)));
  }
  if (video && track.syncs.length < track.sizes.length) {
    tables.push(fullBox('stss', 0, 0, u32(track.syncs.length), u32Table(track.syncs)));
  }
  // Chunks with the same sample count share an stsc entry.
  const stsc = [];
  track.chunks.forEach((chunk, n) => {
    if (stsc.length === 0 || stsc[stsc.length - 1][1] !== chunk.count) stsc.push([n + 1, chunk.count, 1]);
  });
  tables.push(fullBox('stsc', 0, 0, u32(stsc.length), u32Table(stsc.flat())));
  tables.push(fullBox('stsz', 0, 0, u32(0, track.sizes.length), u32Table(track.sizes)));
  const offsets = Buffer.alloc(8 * track.chunks.length);
  track.chunks.forEach((chunk, n) => offsets.writeBigUInt64BE(BigInt(chunk.offset), n * 8));
  tables.push(fullBox('co64', 0, 0, u32(track.chunks.length), offsets));

  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', mediaHeader, dinf, box('stbl', ...tables))));
}

function moov(tracks) {
  const timescale = 1000;
  const duration = Math.max(0, ...tracks.map((t) => Math.round((t.durations.reduce((s, d) => s + d, 0) / t.timescale) * timescale)));
  const mvhd = fullBox('mvhd', 0, 0,
    u32(0, 0, timescale, duration, 0x00010000),
    Buffer.from([1, 0, 0, 0]), // volume 1.0, reserved
    Buffer.alloc(8),
    MATRIX,
    Buffer.alloc(24),
    u32(Math.max(...tracks.map((t) => t.id)) + 1));
  return box('moov', mvhd, ...tracks.map((t) => trak(t, timescale)));
}

/** Writes an MP4 from sample runs as they come: media first, index last. */
class Mp4Writer {
  static async create(file) {
    const writer = new Mp4Writer(await fsp.open(file, 'w'));
    await writer.write(box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2avc1mp41', 'latin1')));
    writer.mdatStart = writer.offset;
    const header = Buffer.alloc(16); // 64-bit size, filled in at the end
    header.writeUInt32BE(1);
    header.write('mdat', 4, 'latin1');
    await writer.write(header);
    return writer;
  }

  constructor(handle) {
    this.handle = handle;
    this.offset = 0;
    this.tracks = null;
  }

  async write(buf) {
    let done = 0;
    while (done < buf.length) {
      const { bytesWritten } = await this.handle.write(buf, done, buf.length - done, this.offset + done);
      done += bytesWritten;
    }
    this.offset += buf.length;
  }

  /** The tracks the runs belong to: the first init segment seen. */
  setTracks(init) {
    if (this.tracks) return;
    this.tracks = new Map(init.tracks.map((t) => [t.id, { ...t, sizes: [], durations: [], ctos: [], syncs: [], chunks: [] }]));
  }

  async addRuns(runs) {
    for (const run of runs) {
      const track = this.tracks?.get(run.trackId);
      if (!track) continue;
      track.chunks.push({ offset: this.offset, count: run.samples.length });
      for (const s of run.samples) {
        track.sizes.push(s.size);
        track.durations.push(s.duration);
        track.ctos.push(s.cto);
        if (s.sync) track.syncs.push(track.sizes.length);
      }
      await this.write(run.data);
    }
  }

  /** Seconds of media written so far (the longest track). */
  get duration() {
    if (!this.tracks) return 0;
    return Math.max(0, ...[...this.tracks.values()].map((t) => t.durations.reduce((s, d) => s + d, 0) / t.timescale));
  }

  async finish() {
    const tracks = [...(this.tracks?.values() ?? [])].filter((t) => t.sizes.length > 0);
    if (tracks.length === 0) throw new Error('Nothing was downloaded.');
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(this.offset - this.mdatStart));
    await this.handle.write(size, 0, 8, this.mdatStart + 8);
    await this.write(moov(tracks));
    await this.handle.close();
  }

  async abort() {
    await this.handle.close().catch(() => {});
  }
}

module.exports = { boxes, parseInit, parseFragments, Mp4Writer };
