// Signs release builds with your own key when one is given, so the APK can
// be installed over an earlier one (Android only updates an app signed with
// the same key). Without the variables, release builds keep Expo's debug
// key, which is fine for trying it out.
//
//   LWEDFLIX_KEYSTORE           path to the .jks
//   LWEDFLIX_KEYSTORE_PASSWORD
//   LWEDFLIX_KEY_ALIAS
//   LWEDFLIX_KEY_PASSWORD
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// lwedflix: release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    gradle = gradle.replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        ${MARK}
        if (System.getenv('LWEDFLIX_KEYSTORE')) {
            release {
                storeFile file(System.getenv('LWEDFLIX_KEYSTORE'))
                storePassword System.getenv('LWEDFLIX_KEYSTORE_PASSWORD')
                keyAlias System.getenv('LWEDFLIX_KEY_ALIAS')
                keyPassword System.getenv('LWEDFLIX_KEY_PASSWORD')
            }
        }
`
    );
    gradle = gradle.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig System.getenv('LWEDFLIX_KEYSTORE') ? signingConfigs.release : signingConfigs.debug"
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
