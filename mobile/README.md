# Lwedflix for phones

The Lwedflix app for Android (and, from the same code, iPhone): browse and
search, the player with Lwedflix's own controls and automatic server
switching, *Up next*, watch parties with the desktop app, accounts, friends,
messages, posts, watchlists, history, the Movie Map, and **downloads** you
can watch offline.

It uses the same Supabase project as the desktop app, so the account is the
same everywhere: watchlist, history, friends, messages, and where you stopped
in a movie or an episode follow you between the phone and the computer.
Phones and computers can be in the same watch party.

## How it's built

An [Expo](https://expo.dev) app (React Native, TypeScript, Expo Router),
sharing as much as it can with the desktop app instead of copying it:

- **`../src/lib`** is imported as is (`@shared/...`): TMDB, Supabase,
  watch parties (`watchRoom.ts`, `partySync.ts`), progress, history,
  friends, messages, posts, the Movie Map's data. Where the phone needs
  something else, a `.native.ts` file sits next to the web one
  (`supabase.native.ts`, `tmdbConfig.native.ts`); React Native picks it and
  Next.js ignores it. `lib/polyfills.ts` gives the shared code the browser
  bits it expects (`localStorage`, `sessionStorage`, `crypto.randomUUID`,
  `Buffer`).
- **The player** (`player/`) is a WebView showing a small page of ours
  (`player/wrapper.html`) that embeds the server. The desktop's player
  bridge, `../electron/preload.js`, runs unchanged in every frame through
  `player/shim.js`, and the wrapper page routes its messages as
  `electron/main.js` does (states checked with `playerProtocol.js`'s
  `cleanState`, commands with `cleanCommand`). Once a stream plays, the
  server's own interface is hidden and the app's controls (`PlayerView.tsx`)
  are drawn over it. `scripts/build-bridge.mjs` inlines the desktop files
  into `player/bridge.generated.ts`; it runs on `npm install` and before
  every start.
  - Android only runs injected scripts in the top frame, so
    `patches/react-native-webview+*.patch` registers the shim as a
    document-start script for every frame
    (`WebViewCompat.addDocumentStartJavaScript`). patch-package applies it on
    install.
- **Downloads** (`downloads/`): the shim reports the media URLs each frame
  loads; `engine.ts` ranks them with `../electron/streams.js` and saves
  them with the desktop's own pipeline — `../electron/hls.js` to read
  playlists, mux.js to turn MPEG-TS into MP4 fragments, `../electron/mp4.js`
  to write one ordinary MP4 — writing through `expo-file-system`. Plain video
  files download as they are. Season downloads find each episode's stream
  in an off-screen player (`EpisodeResolver.tsx`) when its turn comes, as
  `electron/resolver.js` does.
- **The Movie Map** draws its 35,000 films on a canvas in a WebView
  (`map/canvasPage.ts`); search and the film panel are native.

```
app/          screens (Expo Router): tabs, title pages, party, social, map…
components/   shared UI, in the desktop's design tokens (theme.ts)
player/       the player and its bridge
downloads/    download engine, store, episode resolver
lib/          auth, watchlist, badges, polyfills
plugins/      Expo config plugins (release signing)
shims/        Node built-ins for the reused desktop modules
tests/        node:test unit tests (npm test)
```

## Developing

Needs Node 24, JDK 17 and the Android SDK (or Xcode for iOS). The app reads
`../.env.local` — the same file the desktop app uses.

```sh
npm install --legacy-peer-deps
npm run android        # builds and runs a dev build on a phone or emulator
npm test               # unit tests
npm run typecheck
```

Expo Go can't run it (it needs native modules); use the dev build above.

## Building an APK

CI does it: **Actions → Mobile** runs on every change to the app and keeps the
APK as an artifact; run it by hand with a release tag to attach the APK to
that release. Locally:

```sh
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

### Signing key

Android installs an update only over an app signed with the same key. Make
one once and keep it safe (never commit it):

```sh
keytool -genkeypair -v -keystore lwedflix.jks -alias lwedflix -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 lwedflix.jks   # → the ANDROID_KEYSTORE_BASE64 secret
```

Repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Locally, set
`LWEDFLIX_KEYSTORE` (the path), `LWEDFLIX_KEYSTORE_PASSWORD`,
`LWEDFLIX_KEY_ALIAS` and `LWEDFLIX_KEY_PASSWORD` before `assembleRelease`.

The app doesn't update itself; the profile screen says when a newer APK is
on GitHub Releases and links to it.

## iPhone

The same code builds for iOS (`npx expo run:ios` on a Mac). Distribution
needs an Apple developer account. Downloads on iPhone rely on the frames'
own requests (the shim hooks `fetch`, `XMLHttpRequest` and `<video src>`),
which is how Android works too; it hasn't been tried on an iPhone yet.

## Database

Movie resume positions sync through `movie_progress`
(`../supabase/migrations/0021_movie_progress.sql`). Until that migration is
applied, resuming a movie stays on the device; nothing else depends on it.
