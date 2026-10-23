# Download with ODM — implementation plan

Status: **implemented on this branch** (`feat/odm-download-bridge`).
Target: Lwedflix 1.1.0 (`electron/` + `src/components/VideoPlayer.tsx`).

Files: `electron/odm.js` (capture, classifier, pipe client, IPC),
`electron/odm.test.js` (`npm run test:odm`), `src/lib/odmBridge.ts` (types),
plus wiring in `electron/main.js`, `electron/preload.js` and the overlay in
`src/components/VideoPlayer.tsx`.

## Verified on 2026-10-23

- Harness (real Electron session + real preload + fake provider iframe + mock
  ODM pipe): 19/19 checks — capture, classification, both payloads, framing.
- Real player UI (`next dev`, real vidcore iframe): 8/8 checks — iframe, button,
  menu, captured HLS listed once, video playing.
- Real ODM 0.1.0: `ADD_STREAM` accepted a live vidcore manifest and downloaded
  `init.mp4` + segments (2.2 MB before pausing), with `Referer` from the frame.
- `PING` against the running app answers `{"version":"0.1.0"}`.

## Goal

While a title is playing in Lwedflix, one click sends the stream that is
actually playing to ODM, which downloads it with its own queue, multi-connection
engine and resume support.

## Why this shape

- Playback is an `<iframe>` from a third-party server (`vidsrc.me`, `vidcore`,
  `2embed`, `videasy`, `vidlink`). `yt-dlp` does not resolve any of them
  (verified: `ERROR: Unsupported URL`), so ODM cannot take a page URL.
- The media URLs are signed and short-lived (a stale one answers `428`), so a
  URL must be captured from live traffic and handed over immediately.
- ODM already accepts downloads from any local process over a per-user named
  pipe — no extension, no ODM changes required for the happy path.
- ODM's browser extension already implements the detection logic
  (`extension/src/lib/streams.ts`, `extension/src/background.ts`). It is a
  Chromium extension against the same `webRequest` API Electron exposes, so the
  classifier and the header capture port over almost line for line.

```
Lwedflix main (Electron)                        ODM (running)
  session.webRequest.onHeadersReceived  ─────►  \\.\pipe\odm-<USERNAME>
  session.webRequest.onSendHeaders             ADD_DOWNLOAD  (mp4)
  classify + keep last N per provider          ADD_STREAM    (m3u8)
        │                                             │
        ▼                                             ▼
  ipcMain  ◄── renderer button ─────────────►  engine: queue/resume/merge
```

## 1. Detection — new `electron/odm.js`, wired from `main.js`

Register once, after `lockDownSession()` in `start()`:

```js
const ses = session.defaultSession;

ses.webRequest.onSendHeaders(
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  (details) => sentHeaders.remember(details.url, details.requestHeaders),
);

ses.webRequest.onHeadersReceived(
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  (details) => {
    const header = (name) =>
      details.responseHeaders?.[name]?.find?.(Boolean) ??
      details.responseHeaders?.[name];
    const size = responseSize(header('content-length'), header('content-range'));
    const kind = classify(details.url, header('content-type'), size);
    if (kind) streams.add(providerOf(details.url), { ... });
  },
);
```

Rules, ported from `extension/src/lib/streams.ts`:

- `kind`: `.m3u8` / `application/vnd.apple.mpegurl` → `hls`;
  `.mpd` / `application/dash+xml` → `dash` (shown, disabled: ODM has no DASH);
  `.mp4|.webm|.mov|.mkv|.m4v` or `video/*` with size ≥ 2 MiB → `file`.
- Ignore segment extensions (`.ts`, `.m4s`, `.m4f`) and `/seg[-_]?\d/` paths.
- Ignore `googlevideo.com` (trailers).
- Keep 20 per provider host, drop entries older than 10 minutes, clear the list
  when the player navigates or the server changes.
- Merge the `onSendHeaders` record into the stream: `Referer`, `Origin`,
  `Cookie`, `User-Agent` are what make the later fetch work.

Notes:

- Electron's `details` has `webContentsId`/`webContents`, not `tabId`; one
  window means checking `details.webContents === mainWindow.webContents` is
  enough, and `details.frame?.url` gives the provider frame when available.
- Iframe sets `referrerPolicy="no-referrer"`, so the effective `Referer` is the
  **provider** origin (e.g. `https://vidlink.pro/`), which is exactly what the
  captured request headers carry — don't synthesize it from the app URL.
- Cookies: also read `ses.cookies.get({ url })` when handing over, for
  providers that rely on a session cookie rather than the signature.

## 2. ODM pipe client — same file

Protocol (`crates/odm-core/src/ipc.rs`):

- pipe: `\\.\pipe\odm-${process.env.USERNAME}`
- frame: 4-byte little-endian length + UTF-8 JSON, 1 MiB max
- commands: `PING`, `ADD_DOWNLOAD`, `ADD_STREAM`, `ADD_PAGE`, `GET_SUMMARY`,
  `PAUSE_ALL`, `RESUME_ALL`, `SHOW_WINDOW`

```js
// plain file
{ id, cmd: 'ADD_DOWNLOAD', payload: {
    url, filename, referrer, headers: { Referer, Origin, 'User-Agent' },
    cookies, filesize, mime, source: 'menu' } }

// HLS
{ id, cmd: 'ADD_STREAM', payload: {
    page_url: providerOrigin, page_title: title,
    playlist_url: m3u8, headers, cookies } }
```

- Probe with `PING`; if the pipe is absent, spawn ODM and retry for ~5 s:
  `%LOCALAPPDATA%\ODM\ODM.exe`, then `C:\Program Files\ODM\ODM.exe`.
- Relay ODM's `{ ok, error }` back to the renderer; map `add_failed`,
  `bad_payload`, `pipe_error` to plain text.
- Do not queue while ODM is starting — show "Starting ODM…" in the UI.

## 3. Renderer bridge — `electron/preload.js`

In the app-page branch (not the player bridge), expose:

```js
contextBridge.exposeInMainWorld('lwedflixOdm', {
  available: () => ipcRenderer.invoke('odm:available'),
  streams: (providerUrl) => ipcRenderer.invoke('odm:streams', providerUrl),
  download: (streamId) => ipcRenderer.invoke('odm:download', streamId),
});
```

Both handlers must check `isFromAppPage(event)`. New types in
`src/lib/odmBridge.ts`, mirroring `src/lib/desktopPlayer.ts`, with a `null`
fallback so `npm run dev` in a browser keeps working.

## 4. UI — `src/components/VideoPlayer.tsx`

The overlay row already exists at the top right (`absolute top-4 right-4 …`,
around line 470) next to Gen Z / lights-off. Add a `Download` button there,
visible only when the bridge exists and at least one stream is captured.

- Click opens a small menu: kind badge, `label · size · age`, one row per
  quality. Preselect the newest `hls`/largest `file`.
- Send → toast "Sent to ODM" (or ODM's error text). Disable while sending.
- Refresh the list on menu open; a stream older than ~10 min says
  "expired — press play again".
- `TVPlayerContainer.tsx` renders `VideoPlayer`, so it gets the button for free.

Filename: `${title}${year ? ` (${year})` : ''} - S01E02 - 1080p.mp4`, passed as
`filename`; ODM sanitizes and applies its own exists-policy.

## 5. ODM-side tweaks (separate repo, optional)

- `source: 'app'` (or `no_confirm`) that skips `confirm_browser_downloads` for
  an explicit click. Currently every pipe add pops ODM's confirm dialog, which
  defeats one-click.
- `variant_url` in the `ADD_STREAM` payload, if quality should be chosen in
  Lwedflix instead of ODM picking the highest-bandwidth variant.

## 6. Fallback relay

If ODM's fetch is rejected (Cloudflare fingerprint, one-time token), the main
process can relay: a loopback HTTP server that fetches the captured URL with
`net.fetch` (same session cookies/TLS as the player), forwards `Range`, and
hands ODM `http://127.0.0.1:<port>/<id>`. ODM still does the multi-connection
download; only the bytes pass through Lwedflix. Build this only if the direct
fetch fails in practice.

## 7. Test plan

- Unit: classifier port (`src/lib` equivalent of `streams.test.ts`) — MIME vs
  extension, segment rejection, size threshold, query strings, expiry.
- Manual: ODM running → play a movie → button → row appears → file lands in
  `Downloads\ODM` and plays; repeat on a TV episode and on each server.
- Edge cases: ODM closed (auto-start), ODM paused-queue, expired URL,
  provider switch mid-play, two windows (only one main window exists today).
- Keep `npm run typecheck` and `npm run lint` green.

## What the providers actually serve (measured 2026-10-23)

- **vidcore.org** — the iframe lands on `*.edgeone.dev`. The stream is HLS, but
  disguised: the manifest is `px.php?play=…/index-s1080p` served as
  `application/vnd.apple.mpegurl` (288 KB, ~1,392 segments), and each segment is
  `px.php?play=…/seg-N-s1080p` served as `video/mp4` (4–5 MB). The playlist and
  its segment URIs are absolute, and a plain request with `Referer` returns
  200, so ODM downloads it. Segments must be filtered by the decoded query or
  they show up as bogus "files" — `classify()` does that now.
- **vidlink.pro** — MSE with DASH (`index_web.mpd`), so the row is listed but
  disabled ("not supported yet"): ODM has no DASH support. It also emits signed
  H.265 MP4 URLs in some cases; keep an eye on it.
- **vidsrc.me** — 302 → `vidsrc.sh` → `stellarconductornexus.com`. In the test
  the inner frame stayed blank (no media request), so there was nothing to hand
  over. Switching servers is the workaround.
- **2embed** — not tested.

Implication: downloads work today on servers that produce HLS (vidcore), and
the UI should not pretend DASH is downloadable. If vidlink matters, the next
step is DASH support in ODM, which is a much bigger job (`.mpd` parsing,
separate audio/video representations).

Also observed: `ADD_STREAM` started at once even though
`confirm_browser_downloads` was true in ODM 0.1.0 — worth checking on the ODM
side whether the pipe path is meant to skip the confirm dialog (it arguably
should, for an explicit click like this).

## Open questions

- Local fork only, or upstream PR to `mohamedelwed/lwedflix`?
- Dev/serving needs `.env.local` (TMDB token, Supabase URL + anon key) to build
  the server bundle; the installer's copy is readable but should be replaced
  with our own values.
- Which providers matter most? All five is the same code path.
