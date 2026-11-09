import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boxes, parseInit, parseFragments, Mp4Writer } from '../electron/mp4.js';
import { initSegment, fragment } from './fixtures/fmp4.ts';


test('init segment: tracks, timescales, sample descriptions and defaults', () => {
  const init = parseInit(initSegment());
  assert.deepEqual(init.tracks.map((t: { id: number; handler: string; timescale: number }) => [t.id, t.handler, t.timescale]), [[1, 'vide', 90000], [2, 'soun', 44100]]);
  assert.equal(init.tracks[0].width, 640);
  assert.equal(init.tracks[0].height, 360);
  assert.equal(init.tracks[1].defaults.duration, 1024, 'from trex');
  assert.equal(init.tracks[0].stsd.toString('latin1', 4, 8), 'stsd');
});

test('fragments: each run\'s samples and their bytes', () => {
  const init = parseInit(initSegment());
  const video = fragment(1, [{ size: 10, sync: true, cto: 3750 }, { size: 20 }, { size: 30 }], 1);
  const audio = fragment(2, [{ size: 5 }, { size: 6 }], 100);
  const runs = parseFragments(Buffer.concat([video.bytes, audio.bytes]), init);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].samples.map((s: { size: number }) => s.size), [10, 20, 30]);
  assert.deepEqual(runs[0].samples.map((s: { sync: boolean }) => s.sync), [true, false, false]);
  assert.equal(runs[0].samples[0].cto, 3750);
  assert.ok(runs[0].data.equals(video.data));
  assert.deepEqual(runs[1].samples.map((s: { duration: number }) => s.duration), [1024, 1024], 'durations from trex');
  assert.ok(runs[1].data.equals(audio.data));
});

test('a cut-short fragment is an error, not garbage', () => {
  const init = parseInit(initSegment());
  const { bytes } = fragment(1, [{ size: 100, sync: true }], 1);
  assert.throws(() => parseFragments(bytes.subarray(0, bytes.length - 10), init), /cut short/);
});

test('writer: one mdat, then an index that points at every sample', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp4-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'out.mp4');
  const init = parseInit(initSegment());
  const writer = await Mp4Writer.create(file);
  writer.setTracks(init);
  const chunks = [
    fragment(1, [{ size: 10, sync: true, cto: 3750 }, { size: 20 }], 1),
    fragment(2, [{ size: 5 }, { size: 6 }, { size: 7 }], 50),
    fragment(1, [{ size: 30, sync: true }, { size: 40 }], 9),
    fragment(2, [{ size: 8 }], 80),
  ];
  for (const c of chunks) await writer.addRuns(parseFragments(c.bytes, init));
  assert.equal(Math.round(writer.duration * 1000), Math.round((4 * 3750 / 90000) * 1000), 'the longer track: video');
  await writer.finish();

  const out = fs.readFileSync(file);
  const top = boxes(out);
  assert.deepEqual(top.map((b: { type: string }) => b.type), ['ftyp', 'mdat', 'moov']);
  const find = (parent: { body: number; end: number }, ...types: string[]) =>
    types.reduce<{ body: number; end: number; start: number } | undefined>((b, type) => b && boxes(out, b.body, b.end).find((x: { type: string }) => x.type === type), parent as never);
  const moov = top[2];
  const traks = boxes(out, moov.body, moov.end).filter((b: { type: string }) => b.type === 'trak');
  assert.equal(traks.length, 2);

  // Read every sample back through the index and compare with what went in.
  const expected: Record<number, Buffer[]> = { 0: [], 1: [] };
  chunks.forEach((c, n) => expected[n % 2 === 0 ? 0 : 1].push(c.data));
  traks.forEach((trak: { body: number; end: number }, n: number) => {
    const stbl = find(trak, 'mdia', 'minf', 'stbl')!;
    const stsz = find(stbl, 'stsz')!;
    const count = out.readUInt32BE(stsz.body + 8);
    const sizes = Array.from({ length: count }, (_, i) => out.readUInt32BE(stsz.body + 12 + i * 4));
    const co64 = find(stbl, 'co64')!;
    const offsets = Array.from({ length: out.readUInt32BE(co64.body + 4) }, (_, i) => Number(out.readBigUInt64BE(co64.body + 8 + i * 8)));
    const stsc = find(stbl, 'stsc')!;
    const perChunk = out.readUInt32BE(stsc.body + 12);
    const read: Buffer[] = [];
    let sample = 0;
    for (const offset of offsets) {
      let at = offset;
      const bytes = [];
      for (let i = 0; i < perChunk && sample < count; i++, sample++) {
        bytes.push(out.subarray(at, at + sizes[sample]));
        at += sizes[sample];
      }
      read.push(Buffer.concat(bytes));
    }
    assert.ok(Buffer.concat(read).equals(Buffer.concat(expected[n])), `track ${n + 1} samples`);
    // Video keeps its keyframe list and composition offsets; audio needs neither.
    assert.equal(Boolean(find(stbl, 'stss')), n === 0);
    assert.equal(Boolean(find(stbl, 'ctts')), n === 0);
    const stts = find(stbl, 'stts')!;
    assert.equal(out.readUInt32BE(stts.body + 4), 1, 'one duration run per track');
  });
  const mvhd = find(moov, 'mvhd')!;
  assert.equal(out.readUInt32BE(mvhd.body + 12), 1000);
  assert.equal(out.readUInt32BE(mvhd.body + 16), Math.round((4 * 3750 / 90000) * 1000), 'the longer track sets the length');
});
