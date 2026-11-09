# Lwedflix

A desktop app for movies, TV shows and anime, with synced watch parties —
for macOS, Windows and Linux.

- Browse and search through TMDB; stream from embedded players, with a
  choice of servers. A server that says it doesn't have the title, or whose
  play button doesn't start anything within 20 seconds, is swapped for the
  next one automatically.
- **Movie Map** (Discover in the sidebar): about 35,000 films on one map,
  each next to the films most like it. Search flies to a film or lights up a
  theme ("heist", "time travel"); genres, language, decade and *My films*
  (your watchlist and history) dim everything else. Click a film for its
  closest neighbours, and every movie page has *Find similar* to open the
  map on it.
- Movies and episodes resume where you stopped; at the end of an episode,
  *Up next* counts down to the next one (across seasons too) and starts it
  playing — as does picking an episode.
- **Downloads**: the download button in the player saves the movie or
  episode that's playing (pick a quality), and the TV page's *Download*
  saves a whole season or every season. The **Downloads** page (Library in
  the sidebar) shows what's on its way and plays what's saved — offline
  too, with the same controls, resume points, *Up next* and history as
  streaming. Files are ordinary MP4s in `Downloads/Lwedflix`.
- Lwedflix's own player controls on every server: once a stream plays, the
  server's player interface (and its ads) is hidden and replaced with one
  seek bar, volume, speed, subtitles (for streams that carry them), mini
  player, fullscreen and next episode. *Use the server's controls* in the
  settings menu, or the switch under the player, brings a server's own
  menus back.
- Player shortcuts: Space/K play-pause, ←/J and →/L ±10 s, M mute,
  F fullscreen, P mini player (picture-in-picture).
- The players' ad and tracker requests are blocked, and so are the
  "downloads" their ads push.
- On Windows with [ODM](https://salimos.cc/odm) (a download manager)
  installed, a stream can be handed to it instead.
- **Watch parties**: start one from any title and share the code or a
  `lwedflix://watch/<CODE>` link. No account needed. Play, pause and seek in
  anyone's player move everyone's — or only the host's, if the host locks
  it. The host picks episodes (and *Up next* moves everyone on), everyone
  can send emoji reactions over the video, and signed-in members can invite
  friends straight to their messages.
- Accounts (optional) for friends, messages, posts, watchlists and history,
  on Supabase.
- Updates itself from GitHub Releases.

## How it's built

It's a Next.js app run by an Electron shell. The app needs its server — API
routes, server components, and a server-only TMDB token — so it isn't a
static export: `scripts/build-server.mjs` builds Next's standalone server,
the installer ships it, and `electron/main.js` runs it on `127.0.0.1:47231`
while the intro plays.

```
src/               the app: pages (src/app), components, libraries
electron/
  main.js          window, local server, deep links, updates, player relay
  preload.js       the bridges: intro, app, and the player bridge
  playerProtocol.js  what may cross the player bridge (states in, commands out)
  adblock.js       ad/tracker blocklist and download blocking
  streams.js       the streams the embedded players load (for downloads)
  downloads.js     the download queue, saved list, and lwedflix-media://
  hls.js, mp4.js   HLS playlists in; one ordinary MP4 out
  resolver.js      finds an episode's stream unseen, for season downloads
  odm.js           Windows: hand a stream to ODM instead
  macUpdater.js    self-updating on macOS without an Apple Developer ID
  intro/           the launch animation
scripts/           build-server.mjs, make-icon.mjs, release.mjs
  movie-map/       fetch.mjs and build.mjs: the Movie Map's data
tests/             unit tests (node:test); tests/e2e: harnesses run in Electron
.github/workflows  CI, and the release build
build/icon.png     app icon (electron-builder derives .icns/.ico from it)
docs/index.html    the download page (GitHub Pages)
supabase/          database schema, as migrations
```

**The player bridge** is what a website can't do: the preload also runs
inside the embedded players' cross-origin frames (`nodeIntegrationInSubFrames`),
finds the `<video>`, reports its state and applies play/pause/seek. It can
also hide everything in the server's frames except the video ("clean"
mode), which is what lets the app draw its own controls over it. Watch
parties sync through it (`src/lib/partySync.ts`), and progress, resume,
*Up next*, shortcuts, the mini player and automatic server switching work on
every server because of it.

**Downloads.** The players are third-party frames, so the app never gets a
media URL from them; `electron/streams.js` watches the session's responses
instead (observe-only webRequest events — the capture started as Salim May's
ODM bridge) and keeps each player frame's recent HLS playlists and video
files, with the Referer, Origin and User-Agent their servers want. The
download menu lists the likeliest first (a master playlist, then media
playlists by size — an ad's is short — then files); DASH (vidlink) is
listed but can't be downloaded yet.

`electron/downloads.js` then fetches the HLS segments six at a time
(fewer while a server keeps failing; every request retried with backoff),
decrypts AES-128, unpacks MPEG-TS with mux.js — servers dress segments up
as PNGs or pages, so packets are found by their sync bytes — and
`electron/mp4.js` writes the samples out as one ordinary MP4: the media in a
single mdat as it arrives, the index at the end. (mux.js's own fragmented
output plays in a browser but not as a file: QuickTime rejects its fragment
numbering.) Two downloads run at once. The list, with each title's poster,
lives in the app's data folder; the page plays files and posters through
`lwedflix-media://`, which serves only files on the list and honours Range
for seeking. Quitting with a download running asks first.

A **season download** queues its episodes without playing them:
`electron/resolver.js` finds each one's stream only when its turn comes
(stream URLs are signed and expire), with a hidden window that loads the
episode's server through `/api/player-frame` — embedded as the player
embeds it, in a session of its own with the ad blocker — presses play and
takes the first real stream. Your server is tried first, then the others.
Queued episodes carry on after a restart, and a failed one can be retried.

**Offline**, a download plays with the app's own controls (a
`DesktopPlayer` over a local `<video>`, `src/lib/localPlayer.ts`), and
progress goes to the same places as when streaming: resume points and
episode progress locally (mirrored to the account when there's a
connection), and history through `src/lib/watchHistory.ts`, which queues
entries it can't send and sends them when the connection is back.

**ODM** (Windows): with it installed, the download menu can send a stream to
ODM over its local named pipe (`\\.\pipe\odm-<user>`) instead —
`ADD_STREAM` for HLS, `ADD_DOWNLOAD` for a file, with the player's headers
and cookies (`electron/odm.js`, `src/lib/odmBridge.ts`).

**Autoplay**: when *Up next* (or a picked episode) changes the episode, the
app asks the main process to autoplay the next stream that loads within 30
seconds; the bridge in the server's frame plays its `<video>`, or presses
the server's play button when there's no video yet.

**Watch parties** are live Supabase Realtime channels (`src/lib/watchRoom.ts`);
nothing is stored. Presence carries only who's there, the title and the
host's lock; positions, chat, reactions, episode changes and sync go over
Broadcast, because Realtime closes the channel of a client that sends more
than 5 Presence updates in 30 seconds. Presence updates are coalesced to one
every 6.5 seconds, and each carries a revision, since Realtime keeps every
presence a client has sent rather than only the latest.

**The Movie Map** is drawn from `public/movie-map/map.json`, made offline
and committed:

- `scripts/movie-map/fetch.mjs` downloads every film with at least 50 TMDB
  votes and a 40-minute runtime (genres, keywords, cast, crew, franchise)
  into `.cache/movie-map/` (not committed). It takes about 20 minutes and
  resumes if stopped.
- `scripts/movie-map/build.mjs` turns each film into a weighted vector,
  finds its closest films (PCA candidates plus anything sharing a franchise,
  person or rare keyword, re-ranked exactly; suggestions much less known
  than the film are pushed down), lays the neighbour graph out with UMAP,
  splits the map into named regions with k-means, and writes the JSON
  (about a minute).

`npm run movie-map` runs both. To bring in new films, delete
`.cache/movie-map/ids.json` (the list of films that qualify) and run it
again: films already downloaded are kept.

## Setup

Requires Node 22.18+ (24 recommended; the tests run TypeScript directly).

```bash
npm install
cp .env.example .env.local   # then fill it in
```

`.env.local` needs a TMDB read access token and a Supabase project. To set up
a new Supabase project, apply `supabase/migrations` in order. The TMDB token
is copied into the app at build time (see `RUNTIME_ENV` in
`scripts/build-server.mjs`), so anyone with the installer can read it;
`NEXT_PUBLIC_*` values are baked in as well.

## Develop

```bash
npm run app        # build the server, then open the app
npm start          # open the app with the server from the last build
npm run dev        # the UI alone in a browser (http://localhost:3000), with hot reload
npm run typecheck
npm run lint
```

In the browser (`npm run dev`) there's no player bridge, so playback doesn't
sync and progress isn't tracked; everything else works.

## Test

```bash
npm test                 # unit tests: party sync, links, ad blocking, resume, episodes
npm run build:server     # the end-to-end harnesses run the staged server...
npm run test:e2e         # ...a three-guest watch party with real streams (~1 min)
npm run test:providers   # which servers stream right now, with ad blocking on
```

`npm test` runs in CI on every push and pull request. The other two need a
display, the network and live providers, so they're run by hand — after
changing the player bridge, watch parties or `electron/adblock.js`
(compare `npm run test:providers -- --no-block` when a server stops
playing). Screenshots land in `tests/e2e/output/`.

## Build installers

```bash
npm run dist:mac     # release/Lwedflix-<v>-arm64.dmg, Lwedflix-<v>.dmg (Intel), and .zip for updates
npm run dist:win     # release/Lwedflix-Setup-<v>.exe
npm run dist:linux   # release/Lwedflix-<v>.AppImage, lwedflix_<v>_amd64.deb
npm run dist         # all of them
```

All of these build on a Mac.

- **macOS** builds are ad-hoc signed, not notarized. On first launch, macOS
  blocks the app: System Settings → Privacy & Security → *Open Anyway*.
- **Windows** installers are unsigned; SmartScreen asks once (*More info →
  Run anyway*).
- **Linux**: the AppImage runs on most distros (`chmod +x`, then open), but
  not on Ubuntu 24.04+ without extra setup — use the .deb there
  (`sudo apt install ./lwedflix_<v>_amd64.deb`), which installs the AppArmor
  profile Ubuntu needs, an app-menu entry and the `lwedflix://` handler. The
  .deb is gzip-compressed because xz isn't available on macOS. x64 only; add
  `arm64` to the `linux` targets for ARM machines.

## Release an update

Installed apps check this repo's GitHub Releases 15 seconds after launch and
every 6 hours (also *Check for Updates…* in the menu).

**From GitHub Actions** (each installer built on its own OS):

1. Once: add the repository secrets `TMDB_ACCESS_TOKEN`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and optionally
   `YOUTUBE_API_KEY` (Settings → Secrets and variables → Actions).
2. Bump `version` in `package.json` and push.
3. Actions → *Release* → *Run workflow*.

**From your Mac:**

1. Bump `version` in `package.json`.
2. Create a GitHub token with write access to this repo's contents and
   `export GH_TOKEN=<token>`.
3. `npm run release` (`scripts/release.mjs`).

Either way, release `v<version>` is created as a draft, every platform's
installers and `latest*.yml` update feeds are uploaded into it, and it's
published once they're all up. A version that's already published is
refused. The draft comes first because uploads run in parallel: with no
release to upload into, each one creates its own, leaving duplicate
releases for one tag.

Every platform downloads updates in the background and installs them on
restart (or when the app quits). Windows and the Linux AppImage do it
silently; the Linux .deb asks for the password, since it's a system package.
A downloaded update never shows the "unknown publisher" or "could not
verify" warnings: those only apply to files a browser downloaded, so each
person sees them once, on first install.

macOS is handled by `electron/macUpdater.js` rather than electron-updater,
which only installs updates signed with the same Apple Developer ID as the
running app (ad-hoc builds have none). It downloads the release's zip for
the Mac, checks it against the sha512 in `latest-mac.yml`, unpacks it,
verifies its version and signature, and swaps it in once the app has quit.
That needs a copy it can write to: one run from the disk image, or from
where macOS put it after download, is offered the download instead.

To check it by hand: build a copy with an older version (`npx
electron-builder --mac dir --arm64 -c.extraMetadata.version=1.0.0`, then
copy `app-update.yml` from a release build into its `Contents/Resources`
and re-sign it with `codesign --force --deep -s -`), run it with
`--user-data-dir=<a scratch folder>`, and quit it once `updates.log` says
"Ready to install".

With an Apple Developer ID ($99/year) instead: set `mac.identity` to it,
re-enable `hardenedRuntime`, add notarization, and set `CAN_INSTALL_UPDATES`
in `electron/main.js` to `true` on macOS, which hands updates back to
electron-updater.

## Download page

`docs/index.html` shows the launch video (`docs/assets/lwedflix-demo.mp4`),
detects the visitor's system (including Apple Silicon vs Intel where the
browser allows), and puts the matching installer from the latest release on
its main button — nothing downloads until it's clicked. Publish it with
GitHub Pages: Settings → Pages → Deploy from a branch → `main`, folder
`/docs`. It's then at https://mohamedelwed.github.io/lwedflix/.

The video is made with the `/brag-slim` skill: its sources (page captures,
composition, soundtrack) are in `brag-output/`, which isn't committed.

## Logs

The bundled server logs to `server.log`, updates to `updates.log`,
downloads to `downloads.log`, in the
app's log folder: `~/Library/Logs/Lwedflix` on macOS, `%APPDATA%\Lwedflix\logs`
on Windows, `~/.config/Lwedflix/logs` on Linux.

## Note on this codebase

The app uses Next.js 16, whose APIs differ from older versions — see
`AGENTS.md`.
