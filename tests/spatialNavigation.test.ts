import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, pickFirst, pickNext, type Box } from '../src/lib/spatialNavigation.ts';

const box = (left: number, top: number, width = 100, height = 150): Box => ({ left, top, right: left + width, bottom: top + height });

// Two rows of cards, 120px apart, and a sidebar link on the left.
const row1 = [0, 1, 2, 3].map((i) => ({ item: `r1c${i}`, box: box(300 + i * 120, 100) }));
const row2 = [0, 1, 2, 3].map((i) => ({ item: `r2c${i}`, box: box(300 + i * 120, 300) }));
const sidebar = [{ item: 'home', box: box(20, 120, 180, 30) }];
const all = [...row1, ...row2, ...sidebar];

test('moves along a row', () => {
  assert.equal(pickNext(row1[1].box, all, 'right'), 'r1c2');
  assert.equal(pickNext(row1[1].box, all, 'left'), 'r1c0');
});

test('moves straight down and up, not diagonally', () => {
  assert.equal(pickNext(row1[2].box, all, 'down'), 'r2c2');
  assert.equal(pickNext(row2[3].box, all, 'up'), 'r1c3');
});

test('left from the first card reaches the sidebar', () => {
  assert.equal(pickNext(row1[0].box, all, 'left'), 'home');
});

test('nothing that way gives null', () => {
  assert.equal(pickNext(row1[3].box, all, 'right'), null);
  assert.equal(pickNext(row1[0].box, all.filter((c) => c.item !== 'home'), 'up'), null);
  assert.equal(distance(box(0, 0), box(0, 0), 'down'), null);
});

test('prefers a nearby in-line target over a closer diagonal one', () => {
  const from = box(0, 0, 100, 40);
  const inLine = { item: 'below', box: box(0, 200, 100, 40) };
  const diagonal = { item: 'diagonal', box: box(400, 60, 100, 40) };
  assert.equal(pickNext(from, [diagonal, inLine], 'down'), 'below');
});

test('first focus goes to the top-left-most candidate', () => {
  assert.equal(pickFirst(all), 'r1c0');
  assert.equal(pickFirst([]), null);
});
