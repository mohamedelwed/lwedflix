// Puts the desktop app's ad and tracker blocklist (electron/adblock.js) in
// the Android app's assets, where the patched WebView reads it
// (patches/react-native-webview+*.patch, LwfAdBlock.java). One list for both
// apps: change it in electron/adblock.js, and the next build has it.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');
const { BLOCKED_DOMAINS } = require('../../electron/adblock.js');

module.exports = function withAdBlock(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'lwf-blocked-domains.txt'), [...BLOCKED_DOMAINS].join('\n') + '\n');
      return cfg;
    },
  ]);
};
