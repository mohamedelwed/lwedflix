import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillScale, fromPerceived, isVertical, levelAfterSwipe, nextSkip, swipeZone, tapZone, toPerceived } from '../player/gestures.ts';

test('thirds for taps, 40/20/40 for swipes', () => {
  assert.equal(tapZone(10, 900), 'left');
  assert.equal(tapZone(450, 900), 'center');
  assert.equal(tapZone(890, 900), 'right');
  assert.equal(swipeZone(100, 1000), 'brightness');
  assert.equal(swipeZone(500, 1000), null);
  assert.equal(swipeZone(900, 1000), 'volume');
});

test('a full-height swipe up goes from 0 to 1, clamped', () => {
  assert.equal(levelAfterSwipe(0, -400, 400), 1);
  assert.equal(levelAfterSwipe(0.5, 100, 400), 0.25);
  assert.equal(levelAfterSwipe(0.9, -400, 400), 1);
  assert.equal(levelAfterSwipe(0.1, 400, 400), 0);
});

test('double-taps on one side add up; the other side or a pause starts over', () => {
  const a = nextSkip(null, 'right', 0);
  assert.equal(a.total, 10);
  const b = nextSkip(a, 'right', 500);
  assert.equal(b.total, 20);
  assert.equal(nextSkip(b, 'left', 900).total, -10);
  assert.equal(nextSkip(b, 'right', 2000).total, 10);
});

test('fill scale for 16:9 on a 20:9 phone, and never below 1', () => {
  assert.ok(Math.abs(fillScale(2400, 1080) - 1.25) < 0.001);
  assert.equal(fillScale(1600, 900), 1);
});

test('vertical only when clearly vertical', () => {
  assert.equal(isVertical(2, 30), true);
  assert.equal(isVertical(30, 30), false);
  assert.equal(isVertical(0, 8), false);
});

// Review focus: a double-tap at a zone's very edge on a small player is still a skip side.
test('the edges of a small player count as skip sides', () => {
  assert.equal(tapZone(0, 360), 'left');
  assert.equal(tapZone(119, 360), 'left');
  assert.equal(tapZone(241, 360), 'right');
  assert.equal(tapZone(360, 360), 'right');
});

// Review focus: scrubbing (horizontal) is never a brightness/volume swipe.
test('a mostly horizontal drag is not vertical', () => {
  assert.equal(isVertical(120, 40), false);
  assert.equal(isVertical(40, 39), false);
});

// A swipe often starts a little diagonal (dx 10, dy 14 when it activates): still a swipe.
test('a slightly diagonal start counts as vertical', () => {
  assert.equal(isVertical(10, 14), true);
  assert.equal(isVertical(40, 59), true);
});

test('brightness swipes run on the curve eyes see, and come back exactly', () => {
  for (const v of [0, 0.1, 0.25, 0.5, 0.9, 1]) assert.ok(Math.abs(fromPerceived(toPerceived(v)) - v) < 1e-9);
  // A dim backlight looks brighter than its number: the swipe gives the low end more room.
  assert.ok(toPerceived(0.1) > 0.3);
  assert.equal(toPerceived(-1), 0);
  assert.equal(fromPerceived(2), 1);
});
