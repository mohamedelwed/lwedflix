# Lwedflix

A desktop app for movies, TV shows and anime, with synced watch parties —
for macOS, Windows and Linux.

- Browse and search through TMDB; stream from embedded players, with a
  choice of servers. A server that says it doesn't have the title, or whose
  play button doesn't start anything within 20 seconds, is swapped for the
  next one automatically.
- Movies and episodes resume where you stopped; at the end of an episode,
  *Up next* counts down to the next one (across seasons too).
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
  macUpdater.js    self-updating on macOS without an Apple Developer ID
  intro/           the launch animation
scripts/           build-server.mjs, make-icon.mjs, release.mjs
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

**Watch parties** are live Supabase Realtime channels (`src/lib/watchRoom.ts`);
nothing is stored. Presence carries only who's there, the title and the
host's lock; positions, chat, reactions, episode changes and sync go over
Broadcast, because Realtime closes the channel of a client that sends more
than 5 Presence updates in 30 seconds. Presence updates are coalesced to one
every 6.5 seconds, and each carries a revision, since Realtime keeps every
presence a client has sent rather than only the latest.

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

The bundled server logs to `server.log`, updates to `updates.log`, in the
app's log folder: `~/Library/Logs/Lwedflix` on macOS, `%APPDATA%\Lwedflix\logs`
on Windows, `~/.config/Lwedflix/logs` on Linux.

## Note on this codebase

The app uses Next.js 16, whose APIs differ from older versions — see
`AGENTS.md`.
