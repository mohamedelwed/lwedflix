import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getMovieResume, setMovieProgress } from '../src/lib/movieProgress.ts';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
});

beforeEach(() => store.clear());

test('resumes where you stopped', () => {
  setMovieProgress(550, 1500, 8348);
  assert.equal(getMovieResume(550), 1500);
  assert.equal(getMovieResume('550'), 1500);
  assert.equal(getMovieResume(551), undefined);
});

test('starts from the top when barely started or into the credits', () => {
  setMovieProgress(1, 45, 6000);
  assert.equal(getMovieResume(1), undefined);
  setMovieProgress(2, 5700, 6000);
  assert.equal(getMovieResume(2), undefined);
});

test('writes only every few seconds of change', () => {
  setMovieProgress(550, 1500, 8348);
  setMovieProgress(550, 1503, 8348);
  assert.equal(getMovieResume(550), 1500);
  setMovieProgress(550, 1506, 8348);
  assert.equal(getMovieResume(550), 1506);
});

test('ignores nonsense and keeps the newest 200 titles', () => {
  setMovieProgress(3, 100, 0);
  setMovieProgress(3, Number.NaN, 6000);
  assert.equal(getMovieResume(3), undefined);
  for (let id = 1000; id < 1205; id++) setMovieProgress(id, 600, 6000);
  assert.equal(Object.keys(JSON.parse(store.get('lwedflix:movie-progress')!)).length, 200);
  assert.equal(getMovieResume(1204), 600);
});

test('survives corrupt storage', () => {
  store.set('lwedflix:movie-progress', '{nope');
  assert.equal(getMovieResume(550), undefined);
  setMovieProgress(550, 1500, 8348);
  assert.equal(getMovieResume(550), 1500);
});

test('merging keeps the newer entry', async () => {
  const { mergeMovieProgress } = await import('../src/lib/movieProgress.ts');
  const older = { watched: 100, duration: 6000, at: 1 };
  const newer = { watched: 900, duration: 6000, at: 2 };
  assert.equal(mergeMovieProgress(older, newer), newer);
  assert.equal(mergeMovieProgress(newer, older), newer);
  assert.equal(mergeMovieProgress(older, undefined), older);
  assert.equal(mergeMovieProgress(undefined, newer), newer);
});

test('a hydrated entry is stored and listeners hear only local writes', async () => {
  const { putMovieEntry, getMovieEntry, onMovieProgress } = await import('../src/lib/movieProgress.ts');
  const heard: string[] = [];
  const stop = onMovieProgress((id) => heard.push(id));
  putMovieEntry(7, { watched: 300, duration: 6000, at: 5 });
  assert.equal(getMovieEntry(7)?.watched, 300);
  assert.equal(getMovieResume(7), 300);
  setMovieProgress(8, 400, 6000);
  stop();
  setMovieProgress(9, 400, 6000);
  assert.deepEqual(heard, ['8']);
});
