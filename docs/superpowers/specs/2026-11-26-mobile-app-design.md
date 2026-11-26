# Lwedflix Mobile — design

## Intent

A phone app for Lwedflix (Android now, iPhone next year) with the same
features and the same look as the desktop app (1.5.0), synced with it through
the same account. Downloads and offline viewing on the phone are required —
not a later add-on.

One code base; Android and iOS are two builds of it. Android ships first as a
sideloaded APK. The iOS build must compile and run (simulator / dev build) from
the start, but distributing it (Apple developer account, TestFlight) is next
year's work.

## Goals

- Every desktop feature that makes sense on a phone: browse and search
  (movies, TV, anime, people, franchises), title pages, the player with server
  choice and automatic server switching, Lwedflix's own player controls, resume,
  *Up next* with autoplay, watch parties (create, join by code or
  `lwedflix://watch/<CODE>` link, sync, host lock, reactions, chat, invites),
  accounts, friends, messages, posts and comments, notifications, watchlists
  (incl. groups and shared), history, profiles, reviews, Movie Map, downloads
  (single titles and whole seasons) with an offline library and player.
- Sync with desktop through the existing Supabase project: anything a user does
  on one device shows up on the other.
- The same design language: the desktop's colours (`--background #0a0a0a`,
  `--card #141414`, `--border #262626`, `--muted #a1a1aa`, accent
  `#ff9900`), typography, cards, hero, rows, glass panels and motion — adapted
  to touch and a narrow screen, not a new visual identity.

## Non-goals

- Admin / moderation screens (`src/app/admin`) — desktop only.
- ODM (the external download manager bridge) — the phone has its own
  downloader.
- Mini player / picture-in-picture in v1 (may come later via the OS PiP).
- App-store distribution in this project.
- Changing the desktop app's behaviour, except the small shared changes listed
  under "Changes to the desktop app".

## Anti-goals

- A design that drifts into "generic mobile app" — it must look like
  Lwedflix.
- Forked business logic: watch-party sync, progress rules and Supabase access
  must not be re-implemented differently on mobile; share or port faithfully
  so desktop and phone stay interoperable (a phone and a desktop in the same
  party must stay in sync).
- Shipping a private/write-capable secret in the app.

## Approaches considered

1. **WebView shell around the hosted web app** (like upstream's `google-tv`
   branch) plus native downloads. Least work, design stays identical
   automatically. *Not chosen.*
2. **Fully native rebuild in React Native (Expo)** — **chosen** by the user.
   Native screens and navigation; shares TypeScript logic with the desktop
   app; one code base for Android and iOS.
3. **Installable website (PWA)** — ruled out: a browser page can't capture or
   save another site's streams, so downloads are impossible.

Flutter was considered for approach 2 and dropped (our call): the app is React
+ TypeScript, so React Native lets the TMDB, Supabase and party-sync code be
shared instead of rewritten in Dart.

## Decided

- **Stack:** Expo (React Native, TypeScript), Expo Router, dev builds /
  EAS-style native builds (not Expo Go — native modules are needed).
- **Location:** `mobile/` in this repo, on top of upstream 1.5.0 (branch
  `feat/mobile-app`, which starts from `upstream/main`).
- **Backend:** the same Supabase project and schema (`supabase/migrations`).
  Auth via `@supabase/supabase-js` with session stored in secure storage.
- **Player:** the video comes from the servers' embed pages, so the player
  screen hosts them in a `react-native-webview`, with the desktop player
  bridge (`electron/preload.js` + `electron/playerProtocol.js`) injected into
  every frame via a shim that stands in for Electron's `contextBridge` /
  `ipcRenderer` (the same technique as upstream's `android/app/src/main/
  assets/shim.js`). Clean mode hides the server UI; Lwedflix's own controls
  are native RN views over the WebView. Ad hosts are blocked using
  `electron/adblock.js`'s list.
- **Downloads:** native. Streams the player loads are captured (Android:
  request interception in the WebView; iOS: XHR/fetch/`<video src>` hooks
  injected into the frames, since WKWebView doesn't expose subframe requests),
  then saved (HLS → segments + local playlist, or plain file) to app storage
  and played offline in a native video player (`expo-video` or
  `react-native-video`). Desktop's stream ranking (`electron/streams.js`,
  `hls.js`) is the reference for picking the right stream and quality.
  Season downloads queue every episode.
- **Sync of resume positions:** movie resume is localStorage-only today
  (`src/lib/movieProgress.ts`). Add a Supabase table (new migration) and make
  both desktop and mobile write/read it, mirroring how `show_progress` works,
  so stopping on one device resumes on the other.
- **TMDB:** called directly from the app with a **read-only** TMDB token —
  the same exposure the desktop installer already has (`.env.example` notes
  the token ships in the app). No hosted deployment needed.
- **Deep links:** `lwedflix://watch/<CODE>` opens the party on the phone too.
- **Android distribution:** signed release APK built in CI (GitHub Actions),
  attached to releases like the desktop installers.

## Changes to the desktop app

- Movie resume positions synced via Supabase (above).
- Any logic extracted into a shared module so both apps use it (e.g. TMDB
  client, party sync, progress rules) — moved, not changed in behaviour.

## Calls made without the user (to check)

Settled after the builder review, while the user was away:

- **Repo / backend:** ships from the user's fork (`maysalim-sudo/lwedflix`),
  against the Supabase project in the fork's `.env.local`. The new movie-progress
  migration is written but **not applied** — the user applies it. Mobile must
  work if the table is missing (falls back to on-device resume), and older
  desktops simply ignore it.
- **iOS in v1:** must build and run; browsing, accounts, social, the player
  and parties share Android's code and should work. iOS download capture is
  implemented best-effort and unverified until there's an iPhone to test on.
- **Downloads run while the app is open** (screen kept awake while
  downloading). Background downloading (Android foreground service) is later.
- **No APK self-updater in v1:** the app checks GitHub Releases and shows a
  "new version" banner linking to the APK.
- **Minimum Android:** Expo's default (Android 7 / API 24); target the latest.
- **Testing:** no phone is available yet — verified with unit tests,
  typecheck, a debug APK build, and an emulator if the machine allows it.

## Left to the builder

- Screen-by-screen mobile layouts (bottom tab bar vs. drawer, sheet styles),
  within the design language above.
- How code is shared (workspace package vs. path aliases / Metro config).
- Exact libraries for video, storage, and HLS downloading.
- Order of delivery within the feature list, so long as downloads are in v1.
