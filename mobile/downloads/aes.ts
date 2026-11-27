import aesjs from 'aes-js';

/**
 * AES-128-CBC with PKCS#7 padding, as HLS encrypts segments — what
 * electron/downloads.js does with Node's createDecipheriv, in plain JS.
 */
export function decryptAes128(bytes: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const whole = bytes.length - (bytes.length % 16);
  const cbc = new aesjs.ModeOfOperation.cbc(key, iv);
  const out = cbc.decrypt(bytes.subarray(0, whole));
  const pad = out[out.length - 1];
  const padded = pad > 0 && pad <= 16 && out.subarray(out.length - pad).every((b) => b === pad);
  return padded ? out.subarray(0, out.length - pad) : out;
}
