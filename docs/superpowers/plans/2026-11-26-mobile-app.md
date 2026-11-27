# Lwedflix Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android + iOS app in `mobile/` with the desktop app's features and look, synced through the same Supabase project, with downloads and offline viewing.

**Architecture:** Expo (SDK 58) + Expo Router app. The desktop's pure TypeScript libraries in `src/lib` are imported directly (Metro `watchFolders`); platform-specific pieces use React Native's `.native.ts` resolution (`supabase.native.ts`, `tmdbConfig.native.ts`), which Next.js ignores. `localStorage` is provided by `expo-sqlite/localStorage/install`, so progress/history modules run unchanged. The player is a `react-native-webview` showing a small local wrapper page that iframes the server; the desktop bridge (`electron/preload.js` + `playerProtocol.js`) is injected into every frame through a shim, and the wrapper page routes states/commands between frames and React Native. Downloads hook the frames' fetch/XHR/`<video>` to capture stream URLs, then a JS port of the desktop pipeline (`hls.js` parsing, mux.js transmux, `mp4.js` writer) saves an ordinary MP4 with `expo-file-system`.

**Tech Stack:** Expo 58, React Native 0.88, Expo Router, react-native-webview 14, expo-video, expo-file-system, expo-sqlite (localStorage), @supabase/supabase-js, mux.js, buffer, aes-js, react-native-reanimated, lucide-react-native.

**Spec:** `docs/superpowers/specs/2026-11-26-mobile-app-design.md`

## Global Constraints

- Colours: background `#0a0a0a`, card `#141414`, border `#262626`, muted `#a1a1aa`, accent `#ff9900`, foreground `#ffffff`.
- Same Supabase project and schema as desktop; no service-role key in the app. TMDB token read-only.
- Party messages must stay wire-compatible with desktop (`src/lib/watchRoom.ts`, `src/lib/partySync.ts` are shared, not forked).
- Deep link scheme `lwedflix`, `lwedflix://watch/<CODE>`.
- Android minSdk 24. Bundle id / package `app.lwedflix.mobile`.
- No changes to desktop behaviour except Task 2 (movie progress sync) and the moves in Task 1.
- Admin pages, ODM, mini player: out of scope.

## Review Focus

- Signed-out user: every screen that needs an account shows a sign-in prompt instead of crashing (Supabase returns no user).
- Supabase `movie_progress` table missing (migration not applied): resume still works on-device, no error toasts.
- Player frame never reports (server dead): automatic switch to the next server after 20 s, as desktop.
- Download of an AES-128 encrypted HLS stream and of a plain MP4 file both produce a playable file; a 403 mid-download marks it `failed`, not stuck.
- Offline (airplane mode): app opens to Downloads and plays saved files; TMDB failures show an offline state, not a red screen.

---

### Task 1: Scaffold `mobile/` and share `src/lib`

**Files:**
- Create: `mobile/` (create-expo-app, tabs removed), `mobile/app.config.ts`, `mobile/metro.config.js`, `mobile/theme.ts`
- Create: `src/lib/supabase.native.ts`, `src/lib/tmdbConfig.ts`, `src/lib/tmdbConfig.native.ts`
- Modify: `src/lib/tmdb.ts` (read `BASE_URL`, `ACCESS_TOKEN` from `./tmdbConfig`)

**Interfaces:**
- Produces: `theme` (`colors`, `radius`, `font`), `@shared/*` → `../src/*` alias; `supabase` client with AsyncStorage-backed session on native; `app.config.ts` maps `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TMDB_ACCESS_TOKEN` into `extra`.

- [ ] Scaffold, add deps, metro `watchFolders: [repoRoot]`, `nodeModulesPaths` to mobile first.
- [ ] `npx tsc --noEmit` in root and `mobile/` pass; root `npm test` still passes.
- [ ] Commit.

### Task 2: Movie resume syncs through Supabase

**Files:**
- Create: `supabase/migrations/0021_movie_progress.sql` (`movie_progress(user_id uuid, movie_id int, watched real, duration real, updated_at timestamptz, pk(user_id, movie_id))`, RLS own rows only)
- Modify: `src/lib/movieProgress.ts` — add `syncMovieProgress(movieId)` and `hydrateMovieProgress(movieId): Promise<boolean>`, mirroring `episodeProgress.ts` (localStorage stays the source of truth for reads; newer `updated_at` wins; errors swallowed).
- Test: `tests/movieProgress.test.ts`

- [ ] Test: `mergeMovieProgress(local, remote)` keeps the entry with the later `updatedAt`; missing remote keeps local.
- [ ] Implement, call hydrate from the movie player on desktop and mobile.
- [ ] `npm test` passes. Commit.

### Task 3: Design system and navigation shell

**Files:** `mobile/components/{MovieCard,ContentRow,HeroSection,GlassHeader,Button,Chip,Skeleton,EmptyState}.tsx`, `mobile/app/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx` (Home, Movies, TV, Anime, Search, Downloads; profile in header).

- [ ] Components match desktop (poster 2:3 radius 8, orange accent, glass header blur).
- [ ] Commit.

### Task 4: Browse screens

**Files:** `mobile/app/(tabs)/{index,movies,tv,anime,search}.tsx`, `mobile/app/movie/[id].tsx`, `mobile/app/tv/[id].tsx`, `mobile/app/person/[id].tsx`, `mobile/components/{FilterBar,EpisodePicker,FranchiseRow,ContinueWatching,WatchlistButton}.tsx`

**Interfaces:** Consumes `src/lib/tmdb.ts` functions as-is.

- [ ] Home: hero (trending[0]), Continue watching, Trending, Popular movies, Popular TV, Anime rows.
- [ ] Commit.

### Task 5: Player with the bridge

**Files:**
- Create: `mobile/player/servers.ts` (same server list/order as `src/components/VideoPlayer.tsx`), `mobile/player/bridgeScript.ts` (generated: shim + `electron/playerProtocol.js` + `electron/preload.js`, by `mobile/scripts/build-bridge.mjs`), `mobile/player/wrapperHtml.ts`, `mobile/player/PlayerView.tsx`, `mobile/player/Controls.tsx`, `mobile/player/usePlayer.ts`
- Test: `mobile/tests/bridge.test.ts` (shim routes a state from a child frame to `ReactNativeWebView.postMessage` after `cleanState`; drops unknown events)

**Interfaces:**
- Produces: `usePlayer(): { state: PlayerState | null; command(c: PlayerCommand): void; onProblem; onEnded }`; `<PlayerView media={{type, id, season?, episode?}} startAt? onStreamsChanged? />`.

- [ ] Auto server switch on `problem` or 20 s silence; resume via `getMovieResume` / show progress; progress writes every 5 s; Up next at end.
- [ ] Commit.

### Task 6: Watch parties

**Files:** `mobile/app/watch/[code].tsx`, `mobile/components/party/{PartyBar,Reactions,PartyChat}.tsx`; deep link handling in `_layout.tsx`.

**Interfaces:** Consumes `src/lib/watchRoom.ts`, `src/lib/partySync.ts` with `usePlayer` as the player.

- [ ] Commit.

### Task 7: Accounts and social

**Files:** `mobile/app/{login,signup,profile,friends,messages,notifications,watchlist,history}.tsx`, `mobile/app/u/[username].tsx`, `mobile/app/p/[id].tsx`, components for posts/comments/DMs.

**Interfaces:** Consumes `src/lib/{session,friends,posts,dm,notifications,watchlist,watchlistGroups,profile,watchHistory}.ts`.

- [ ] Commit.

### Task 8: Downloads

**Files:**
- Create: `mobile/downloads/capture.ts` (injected hook source: patches `fetch`, `XMLHttpRequest.open`, `HTMLMediaElement.src` in frames; posts `{t:'stream', url, type}` up), `mobile/downloads/streams.ts` (classify/rank reusing `electron/streams.js` rules), `mobile/downloads/engine.ts` (queue, 2 running, retries, pause/resume/cancel), `mobile/downloads/hlsJob.ts` (parsePlaylist/pickVariant from `electron/hls.js`, AES via aes-js, mux.js transmux, `Mp4Writer` port on `expo-file-system` FileHandle), `mobile/downloads/store.ts` (index in sqlite kv), `mobile/app/(tabs)/downloads.tsx`, `mobile/app/offline/[id].tsx` (expo-video), `mobile/components/DownloadButton.tsx`, `SeasonDownloadButton.tsx`
- Test: `mobile/tests/streams.test.ts`, `mobile/tests/hlsJob.test.ts` (fixture TS segments → valid MP4 boxes; 403 → `failed`)

**Interfaces:** `Download` type identical to `src/lib/downloads.ts`.

- [ ] Commit.

### Task 9: Movie Map

**Files:** `mobile/app/map.tsx` (Skia or SVG canvas on `public/movie-map/map.json`, pinch/pan, film panel).

- [ ] Commit.

### Task 10: Android build and CI

**Files:** `.github/workflows/mobile.yml` (expo prebuild + `./gradlew assembleRelease`, attach APK on release), `mobile/README.md`, update banner `mobile/components/UpdateBanner.tsx` (GitHub Releases latest vs `expo-application` version).

- [ ] `npx expo prebuild -p android && cd android && ./gradlew assembleDebug` succeeds locally.
- [ ] Commit.
