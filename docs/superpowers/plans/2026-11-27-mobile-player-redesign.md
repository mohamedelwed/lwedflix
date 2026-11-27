# Phone Player Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestures (double-tap skip, brightness/volume swipes, swipe to/from fullscreen, pinch zoom), picture-first controls, a lock, and haptics for the phone app's player.

**Architecture:** A gesture layer (react-native-gesture-handler + Reanimated) over the player's WebView replaces today's tap-only Pressable. Pure decision logic (zones, tap counting, swipe levels, zoom scale) lives in `player/gestures.ts` and is unit-tested; the layer turns decisions into player-bridge commands (`seekBy`, `toggle`) and native calls (brightness, volume) added to the app's existing native module.

**Tech Stack:** Expo SDK 58, React Native 0.88, react-native-gesture-handler 3.3, Reanimated 4.7, expo-haptics, Kotlin (Expo Modules API).

**Spec:** `docs/superpowers/specs/2026-11-27-mobile-player-redesign-design.md`

## Global Constraints

- Nothing the player has today is removed (server pill, subtitles, speed, settings, Next episode, fullscreen, back, title/episode, settings panel).
- Skip step 10 s; taps in a row add up (+10, +20, +30…).
- Controls fade after 3 s of playing; a thin progress line stays when hidden.
- Single tap waits 250 ms to tell it from a double-tap.
- Swipe zones: left 40 % = brightness, right 40 % = media volume, middle 20 % ignores vertical swipes; brightness/volume swipes only in fullscreen.
- Brightness applies to this screen only and is restored when the player closes.
- When the watch-party host has locked playback, skips show "The host has locked playback" and send nothing.
- Gestures never reach the server's page; a "Gestures" switch (More tab, default on) turns double-tap and swipes off.
- No new dependencies; native work goes in `mobile/modules/lwf-downloads`.

## Review Focus

- A double-tap near the edge of a zone on a small screen: must count as that side's skip, never as a play/pause toggle.
- A swipe that starts as horizontal (scrubbing on the timeline) must not change brightness or volume.
- Leaving the player while brightness was swiped (back, Next episode, app to background): normal brightness comes back.
- A locked player: the lock button is the only thing that responds; Back on Android still leaves fullscreen.
- Phone without a writable media volume (Do Not Disturb, fixed volume): the swipe must not crash; the indicator shows the level the phone reports.

---

### Task 1: Gesture decisions (pure logic)

**Files:**
- Create: `mobile/player/gestures.ts`
- Test: `mobile/tests/gestures.test.ts`

**Interfaces:**
- Produces:
  - `tapZone(x: number, width: number): 'left' | 'center' | 'right'` — thirds.
  - `swipeZone(x: number, width: number): 'brightness' | 'volume' | null` — left 40 % / right 40 % / middle null.
  - `levelAfterSwipe(start: number, dy: number, height: number): number` — full screen height of travel = 0→1; up raises; clamped to [0, 1].
  - `nextSkip(prev: { side: 'left' | 'right'; total: number; at: number } | null, side: 'left' | 'right', now: number): { side; total; at }` — same side within 700 ms adds 10 (signed: left negative), otherwise starts at ±10.
  - `fillScale(viewW: number, viewH: number, aspect = 16 / 9): number` — scale that makes a video of `aspect` fill the view (≥ 1).
  - `isVertical(dx: number, dy: number): boolean` — |dy| > 12 and |dy| > 1.5·|dx|.

- [ ] **Step 1: Write the tests**

```ts
test('thirds for taps, 40/20/40 for swipes', () => {
  assert.equal(tapZone(10, 900), 'left'); assert.equal(tapZone(450, 900), 'center'); assert.equal(tapZone(890, 900), 'right');
  assert.equal(swipeZone(100, 1000), 'brightness'); assert.equal(swipeZone(500, 1000), null); assert.equal(swipeZone(900, 1000), 'volume');
});
test('a full-height swipe up goes from 0 to 1, clamped', () => {
  assert.equal(levelAfterSwipe(0, -400, 400), 1); assert.equal(levelAfterSwipe(0.5, 100, 400), 0.25); assert.equal(levelAfterSwipe(0.9, -400, 400), 1); assert.equal(levelAfterSwipe(0.1, 400, 400), 0);
});
test('double-taps on one side add up; the other side or a pause starts over', () => {
  const a = nextSkip(null, 'right', 0); assert.equal(a.total, 10);
  const b = nextSkip(a, 'right', 500); assert.equal(b.total, 20);
  assert.equal(nextSkip(b, 'left', 900).total, -10);
  assert.equal(nextSkip(b, 'right', 2000).total, 10);
});
test('fill scale for 16:9 on a 20:9 phone, and never below 1', () => {
  assert.ok(Math.abs(fillScale(2400, 1080) - 1.25) < 0.001); assert.equal(fillScale(1600, 900), 1);
});
test('vertical only when clearly vertical', () => {
  assert.equal(isVertical(2, 30), true); assert.equal(isVertical(30, 30), false); assert.equal(isVertical(0, 8), false);
});
```

- [ ] **Step 2: Run** `cd mobile && npm test` — FAIL (module missing).
- [ ] **Step 3: Implement the six functions** in `mobile/player/gestures.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — all pass.
- [ ] **Step 5: Commit** `mobile: player gesture decisions`.

### Task 2: Brightness and media volume (native)

**Files:**
- Modify: `mobile/modules/lwf-downloads/android/src/main/java/app/lwedflix/downloads/LwfDownloadsModule.kt`
- Modify: `mobile/modules/lwf-downloads/index.ts`
- Create: `mobile/player/device.ts`

**Interfaces:**
- Produces (JS, `player/device.ts`): `getBrightness(): Promise<number>` (window brightness 0–1, or the system level when the window has none), `setBrightness(v: number): void`, `resetBrightness(): void` (window back to the system's), `getVolume(): number`, `setVolume(v: number): number` (media stream, 0–1; returns the level the phone actually set). All no-ops returning sensible values when the native module is missing (iOS, tests).
- Native: `AudioManager.STREAM_MUSIC` with `setStreamVolume(..., 0)` (no system UI; ours shows); window `attributes.screenBrightness` on the current activity, on the UI thread; `-1f` to reset.

- [ ] **Step 1: Add the Kotlin functions** `getBrightness`, `setBrightness`, `resetBrightness`, `getVolume`, `setVolume` to `LwfDownloadsModule` (catch `SecurityException` from `setStreamVolume` and return the current level).
- [ ] **Step 2: Add the TS declarations** to `modules/lwf-downloads/index.ts` and write `player/device.ts`.
- [ ] **Step 3: Native build** (`./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process`), install, reconnect to Metro. Expected: BUILD SUCCESSFUL, app opens.
- [ ] **Step 4: Commit** `mobile: brightness and media volume for the player`.

### Task 3: Gesture layer and picture-first controls

**Files:**
- Create: `mobile/player/GestureLayer.tsx`
- Modify: `mobile/player/PlayerView.tsx` (replace the tap Pressable over the page; controls timing; thin progress line; lock; zoom; restore brightness on unmount)
- Modify: `mobile/player/SeekBar.tsx` (thicker while scrubbing, large time bubble)
- Modify: `mobile/player/PlayerPanel.tsx` (More tab: "Gestures" switch)
- Create: `mobile/player/playerSettings.ts` (`gestures: boolean`, localStorage `lwedflix:player-settings`, same shape as `downloads/settings.ts`)

**Interfaces:**
- Consumes: Task 1 functions; Task 2 `player/device.ts`.
- Produces: `<GestureLayer fullscreen enabled locked onTap onSkip(seconds) onVerticalExit onVerticalEnter onZoom(fill: boolean) />`; `onSkip` receives the running total for the bubble and PlayerView sends `seekBy` with the step.

- [ ] **Step 1: GestureLayer** — Gesture.Exclusive(double-tap (numberOfTaps 2, maxDelay 250), single tap), plus Pan (vertical only via `isVertical`): in fullscreen, brightness/volume by `swipeZone` + `levelAfterSwipe` with a vertical level indicator; outside the swipe zones (or on the small player) a vertical swipe of > 80 px enters/leaves fullscreen. Pinch (fullscreen) toggles fill/fit at scale thresholds 1.1 / 0.9. Ripple + "+20 s" bubble on the tapped side (Reanimated, fades after 600 ms). Haptics (`selectionAsync`) on each skip, on lock/unlock, at 0 % and 100 %.
- [ ] **Step 2: PlayerView** — mount GestureLayer where `ownControls` puts the tap Pressable today; hide controls after 3000 ms of playing (any gesture shows them again); a 2 px progress line at the bottom when hidden; lock button in the bottom row (when locked: only an unlock pill responds); zoom = `transform: [{ scale: fillScale(w, h) }]` on the WebView container; on unmount and when leaving fullscreen, `resetBrightness()`; skips go through the existing locked-party check.
- [ ] **Step 3: SeekBar** — track 4 px → 8 px while scrubbing; a bubble above the thumb with `formatTimestamp(t) / formatTimestamp(duration)`.
- [ ] **Step 4: PlayerPanel More tab** — "Gestures" switch bound to `playerSettings.gestures`.
- [ ] **Step 5: Run** `npm test && npm run typecheck` — pass.
- [ ] **Step 6: Check on the phone (live over Metro)**: double-tap right ×3 → bubble "+30 s", time advances 30 s; swipe left half up → brighter, leave the player → normal brightness; swipe right half → volume indicator and media volume change; small player swipe up → fullscreen, fullscreen swipe down → leaves; pinch → fills; lock → taps ignored except unlock; Gestures off → double-tap does nothing. Screenshot each.
- [ ] **Step 7: Commit** `mobile: player gestures, picture-first controls, lock`.

### Task 4: Release check and push

- [ ] **Step 1:** Release build with the memory cap, install, play a title in fullscreen, confirm no crash in logcat.
- [ ] **Step 2:** Push the branch (updates the open pull request).
