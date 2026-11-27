import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerVariants } from '../downloads/asking.ts';

const base = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15; wv)', Accept: '*/*', Referer: 'https://player.example/embed/movie/550?x=1' };

test('the player’s own headers come first, unchanged', () => {
  assert.equal(headerVariants(base)[0], base);
});

test('then the page’s origin, the bare site, both, and no Referer', () => {
  const v = headerVariants(base);
  assert.deepEqual(v.slice(1), [
    { ...base, Origin: 'https://player.example' },
    { ...base, Referer: 'https://player.example/' },
    { ...base, Referer: 'https://player.example/', Origin: 'https://player.example' },
    { 'User-Agent': base['User-Agent'], Accept: '*/*' },
  ]);
  // The browser stays the player's in every one.
  assert.ok(v.every((h) => h['User-Agent'] === base['User-Agent']));
});

test('without a page, only with and without', () => {
  const v = headerVariants({ 'User-Agent': 'X', Accept: '*/*' });
  assert.equal(v.length, 2);
});
