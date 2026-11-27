// node:crypto for the desktop modules the app reuses (electron/streams.js
// needs randomUUID). Decryption is done in downloads/aes.ts instead.
module.exports = {
  randomUUID: () => globalThis.crypto.randomUUID(),
};
