import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { decryptAes128 } from '../downloads/aes.ts';

test('decrypts an HLS segment as Node does', () => {
  for (const size of [0, 1, 15, 16, 188 * 7, 100_003]) {
    const key = randomBytes(16);
    const iv = randomBytes(16);
    const plain = randomBytes(size);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const out = decryptAes128(new Uint8Array(encrypted), new Uint8Array(key), new Uint8Array(iv));
    assert.deepEqual(Buffer.from(out), plain, `size ${size}`);
  }
});
