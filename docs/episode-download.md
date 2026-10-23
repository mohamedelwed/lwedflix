# Episode downloads — plan

Status: design only. Builds on the ODM bridge in `electron/odm.js` and the
player overlay button, both already on `feat/odm-download-bridge`.

## Goal

Download a chosen episode of a show, one at a time, from the Episodes panel —
without hunting for the player overlay menu, and without a batch that would
queue signed URLs that expire before they start.

The rule everything follows from: **a downloadable URL is only knowable while
that episode's player is loading it.** So the app captures on demand, and every
download is sent seconds after its URL is seen.

## What the user sees

Each episode card gets a download affordance — an icon at the card's top-right,
shown on hover and always on the active card. Clicking it means "switch to this
episode and send its stream to ODM".

| Card state | Shown as | Meaning |
|---|---|---|
| idle | ↓ | not attempted |
| pending | spinner | episode loaded, waiting for a media response |
| sent | ✓ | handed to ODM; ODM starts downloading |
| unavailable | ⊘ + tooltip | no stream appeared in time, or the only stream is DASH |
| unsupported | ⊘ + "not supported yet" | DASH-only server (vidlink) |

A status line under the header mirrors the active card ("Downloading EP 4…",
"EP 4 sent to ODM", "EP 4: no stream — try another server").

Clicking the card body keeps its current meaning (watch that episode). The
download icon is the only new interaction.

### Alternative considered: "Check download possibilities"

A single button that probes the season and turns cards into a ready/not-ready
map. Rejected as the default because probing 25 episodes means loading 25
embeds (minutes, 25 ad sets, provider rate limits), and the answers expire the
moment they're produced — the map would be stale before the user acts on it.
The per-card action gives the same information at the moment it matters, at
the cost of one click per episode.

If it's still wanted later, it can be built on the same primitives as a
"probe only" mode (load, capture, mark ready, don't send), with the result
labelled "checked at HH:MM" and re-checked on download.

## Flow

1. User clicks ↓ on EP 4.
2. `TVPlayerContainer` records `pending = { season, episode, at: Date.now() }`
   and switches the player to that episode (the same state change the card
   already performs; the iframe reloads).
3. The player iframe navigates, so `Registry.clear()` runs in main (the quick
   fix already on this branch). Anything listed afterwards belongs to this
   episode.
4. The renderer polls `window.lwedflixOdm.streams(providerOrigins)` every 500 ms,
   for up to 20 s.
5. On the first `supported` stream: `window.lwedflixOdm.download(id, { title,
   type: 'tv', season, episode })` → main sends `ADD_STREAM` with
   `page_title = "<Show> - S04E07"`, and ODM starts (or is started).
6. State becomes `sent`; the pending entry clears. The user can click the next
   episode.

`titleFor()` in `electron/odm.js` already builds the episode title, so file
names come out as `Severance - S02E07.mp4`.

## Selection rules (important: ads)

A player can request more than one playlist: a pre-roll ad, then the feature.
Prefer, in order:

1. an HLS stream whose URL contains `master` (a master playlist names the best
   variant, and ODM picks it);
2. otherwise an HLS media playlist with `size >= 64 KiB` (a 40-minute episode's
   media playlist is 100 KiB+; an ad's is a few KiB);
3. otherwise the first supported stream.

This lives in the renderer's picker, not in `Registry.list()`, so the menu can
still show every candidate honestly. Needs a size on HLS entries — already
captured from `Content-Length`.

## Files

- `src/components/TVPlayerContainer.tsx` — episode grid, per-card state, click
  handler, status line.
- `src/lib/odmEpisode.ts` (new) — the polling state machine: `downloadEpisode(bridge,
  { title, season, episode, origins })`, plus the stream picker above. Kept out
  of the component so it can be unit-tested.
- `src/lib/odmBridge.ts` — no change; `download()` already carries the meta.
- `electron/odm.js` — no change. The navigation clear and master-first sort are
  already in.

## Edge cases

- **Provider needs a click to start** (vidsrc was blank in testing): timeout →
  `unavailable` with a hint to switch servers.
- **User switches episode while pending**: cancel the pending entry; a late
  capture from the previous iframe is already cleared by the navigation rule.
- **DASH only** (vidlink): `unsupported` immediately, no polling wait.
- **ODM closed**: `download()` starts it (`ensureRunning`), so the first send
  can take up to ~9 s; the spinner covers it.
- **Signed URL expiry**: not a risk here — the send happens within the polling
  window.
- **Ad captured first**: handled by the selection rules.
- **Already downloaded**: not detected (ODM's pipe has no query-by-name). Out of
  scope; ODM's own exists-policy handles collisions.

## Testing

- Unit (`node --test` for `src/lib/odmEpisode.ts` would need a TS runner; keep
  the module plain enough to test by hand, or test the picker through the
  existing JS harness).
- Harness: extend `ui-harness.js` with a TV page, click a card, assert one
  `ADD_STREAM` with `page_title` ending in `SxxEyy`, and that a second click on
  another episode sends another.
- Manual: a show on vidcore; check sent → file appears in `Downloads\ODM\Videos`
  with the episode in the name; check vidlink shows unsupported; switch servers
  mid-check and confirm the state resets.

## Out of scope

- Whole-season or whole-show batches, hidden resolver windows, progress from
  ODM (`GET_DOWNLOAD`).
- Probing a whole season in one pass (see the alternative above).
