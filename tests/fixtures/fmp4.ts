// Just enough fragmented MP4 to stand in for mux.js's output, or for a
// server's fMP4 HLS: an init segment (video track 1, audio track 2) and
// moof + mdat fragments.

export function box(type: string, ...parts: Buffer[]) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

export function full(type: string, version: number, flags: number, ...parts: Buffer[]) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version << 24) | flags) >>> 0);
  return box(type, vf, ...parts);
}

export function u32(...values: number[]) {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((x, i) => b.writeInt32BE(x | 0, i * 4));
  return b;
}

export function initSegment() {
  const trak = (id: number, handler: string, timescale: number, width: number, height: number) =>
    box('trak',
      full('tkhd', 0, 3, u32(0, 0, id, 0, 0, 0, 0), Buffer.alloc(8), Buffer.alloc(36), u32(width << 16, height << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0, 0, timescale, 0), Buffer.alloc(4)),
        full('hdlr', 0, 0, u32(0), Buffer.from(handler, 'latin1'), u32(0, 0, 0), Buffer.from('h\0')),
        box('minf', box('stbl', full('stsd', 0, 0, u32(1), box(handler === 'vide' ? 'avc1' : 'mp4a', Buffer.alloc(8, id)))))));
  return Buffer.concat([
    box('ftyp', Buffer.from('isom', 'latin1'), u32(0)),
    box('moov',
      full('mvhd', 0, 0, Buffer.alloc(96)),
      trak(1, 'vide', 90000, 640, 360),
      trak(2, 'soun', 44100, 0, 0),
      box('mvex', full('trex', 0, 0, u32(2, 1, 1024, 0, 0)))),
  ]);
}

export interface Sample { size: number; duration?: number; sync?: boolean; cto?: number }

/** One moof + mdat for one track; `data` is the sample bytes it carries. */
export function fragment(trackId: number, samples: Sample[], fill: number) {
  const video = trackId === 1;
  const flags = 0x001 | 0x200 | (video ? 0x100 | 0x400 | 0x800 : 0);
  const entries = samples.map((s) => (video ? u32(s.duration ?? 3750, s.size, s.sync ? 0x02000000 : 0x01010000, s.cto ?? 0) : u32(s.size)));
  const build = (offset: number) =>
    box('moof',
      full('mfhd', 0, 0, u32(1)),
      box('traf',
        full('tfhd', 0, 0x020000, u32(trackId)),
        full('tfdt', 1, 0, Buffer.alloc(8)),
        full('trun', 1, flags, u32(samples.length, offset), ...entries)));
  const moof = build(build(0).length + 8);
  const data = Buffer.concat(samples.map((s, i) => Buffer.alloc(s.size, (fill + i) & 0xff)));
  return { bytes: Buffer.concat([moof, box('mdat', data)]), data };
}
