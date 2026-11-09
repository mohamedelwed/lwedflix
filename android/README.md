# Lwedflix for Google TV

The same Lwedflix on Google TV and Android TV (and Fire TV, sideloaded): a
small Android app that shows the hosted web app full screen, with the desktop
app's player bridge, so streams get Lwedflix's own controls, ad blocking,
automatic server switching, *Up next* and watch parties.

## How it works

The desktop app runs its Next.js server locally. A TV can't, so the TV app
loads the **hosted** web app (on Vercel; `LWEDFLIX_TV_URL`) in a WebView and
adds what a browser can't do:

- `assets/shim.js` is injected at document start into every frame. It runs
  `electron/preload.js` **unchanged**, with stand-ins for Electron's
  `contextBridge` and `ipcRenderer`; the build copies the preload,
  `playerProtocol.js` and `adblock.js` in from `electron/`, so both apps
  share one player bridge and one block list.
- `PlayerRelay.kt` routes the bridge's messages the way `electron/main.js`
  does: player states from the embedded player's frame to the app page,
  commands back. The app page re-checks every state (`cleanState`).
- `AdBlock.kt` blocks the same hosts as the desktop app; popups, downloads
  and top-frame redirects away from the app are refused.
- The remote: the web app's `src/components/tv/TvNavigation.tsx` moves focus
  with the arrows and handles Back; media keys go straight to the stream.
  The page is laid out 1280 CSS pixels wide and scaled to the screen.

Not on TV yet: downloads, the mini player, ODM, in-app updates of the APK
itself (the web app updates whenever it's deployed).

## Building

CI builds it (`.github/workflows/android.yml`) — on changes here, by hand
from Actions, and with every release, which attaches `Lwedflix-TV-<version>.apk`.

Locally, with JDK 17, Gradle 8.10+ and the Android SDK:

```sh
cd android
gradle assembleRelease -PlwedflixUrl=https://your-deployment.vercel.app
# → app/build/outputs/apk/release/app-release.apk
```

## Signing key

Android only installs an update over an app signed with the same key, so
make one once and keep it:

```sh
keytool -genkeypair -v -keystore lwedflix-tv.jks -alias lwedflix -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 lwedflix-tv.jks   # → the ANDROID_KEYSTORE_BASE64 secret
```

Then add the repository secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`lwedflix`) and
`ANDROID_KEY_PASSWORD`. Never commit the `.jks`.

## Installing on a TV

1. On the TV: Settings → System → About → click *Android TV OS build* seven
   times to turn on developer options, then allow installs from unknown
   sources for the app you'll install with.
2. Get the APK onto it — the *Send Files to TV* app, a USB stick with a file
   manager, or `adb install Lwedflix-TV-<version>.apk` over the network.
3. Lwedflix appears in the TV's apps row.
