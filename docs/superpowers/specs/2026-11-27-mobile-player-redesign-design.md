# Phone player redesign — design

## Why

The phone app's player (`mobile/player/PlayerView.tsx`) works, but it's
tap-only and its controls get in the way, in fullscreen and on the small
player above a title's page. The user wants it to feel like the players they
enjoy on their phone — YouTube's, and a similar adult-site player: the
picture first, quick gestures, light settings. It's for the user and a
friend.

## Goals

- **Double-tap to skip**: right side +10 s, left −10 s. Taps in a row add up
  (+10, +20, +30…), shown as a ripple and a "+20 s" bubble on that side.
- **Brightness and volume swipes**: up/down on the left half changes screen
  brightness, on the right half the phone's media volume (the one the
  volume buttons change), with a vertical level indicator while swiping.
  Brightness applies only while the player is open; it goes back when the
  player closes.
- **Picture first**: controls fade out after 3 s of playing; while they're
  hidden, a thin progress line stays along the bottom edge.
- **Scrubbing**: the timeline thickens under the finger and a large time
  bubble follows it ("12:04 / 45:10"). No frame preview (see Non-goals).
- **Swipe up** on the small player goes fullscreen; **swipe down** in
  fullscreen leaves it.
- **Pinch** in fullscreen: zoom to fill the screen / back to fit.
- **Lock button**: blocks every touch except a small unlock button, for
  watching lying down.
- **Haptics**: a light tick on double-tap skips, lock/unlock, and at 0 % and
  100 % of a swipe.
- **Settings panel** (built earlier today, `PlayerPanel.tsx`): kept as is —
  side panel in fullscreen, bottom sheet on the small player.

## Non-goals

- A picture preview while scrubbing: the video plays inside other people's
  servers' pages, so frames can't be grabbed ahead of time.
- Removing anything the player has today. Every control and option stays
  (server pill, subtitles, speed, settings, Next episode, fullscreen,
  back, title and episode).

## Anti-goals

- Gestures must never reach the server's page (its ads): the gesture layer
  sits over the page whenever Lwedflix's controls are in use, as the tap
  layer does today.
- In watch parties, nothing skips or pauses for everyone when the host has
  locked playback: double-tap skips then show "The host has locked
  playback", as the buttons do.

## Approaches

1. **A gesture layer in the app over the server's page (chosen).** An
   invisible layer (react-native-gesture-handler, Reanimated — both already
   in the app) catches taps, double-taps, drags, swipes and pinches and turns
   them into player-bridge commands (`seekBy`, `toggle`, …); the controls and
   indicators are drawn on it. Reuses what's there; works the same on iPhone.
2. **Gestures inside the server's page** (injected script). Rejected:
   laggier, has to be injected into every server's page, and some servers
   fight it.

## Decided

- Volume = the phone's media volume; brightness = this screen only, while
  the player is open (user agreed to both).
- Both through the app's existing native module (`mobile/modules/lwf-downloads`,
  new functions; no new dependency). One native rebuild; the rest is live.

## Calls made by the builder (correct if wrong)

- Swipe zones: the left and right 40 % of the screen; the middle 20 % ignores
  vertical swipes (so scrolling a title's page isn't caught by the small
  player). On the small player, brightness/volume swipes are off — only in
  fullscreen, where there's room.
- Double-tap zones: left and right thirds; a single tap anywhere still shows
  or hides the controls (after a 250 ms wait to tell it from a double-tap).
- Pinch zoom = the video fills the screen (cropping the edges) vs fits.
- A "Gestures" switch in the settings panel's More tab, on by default, turns
  double-tap and swipes off for anyone who doesn't want them.

## Left to the builder

Animation curves and durations, exact sizes and colours (from the app's
design tokens, `mobile/theme.ts`), and the icons.
