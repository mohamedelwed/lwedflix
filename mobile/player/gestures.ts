// What the player's gestures mean (GestureLayer.tsx acts on it). Pure, so
// tests run it.

const SKIP = 10;
/** How long after a double-tap another one on the same side still adds up. */
const STREAK_MS = 700;

/** Thirds: left and right skip back and forward; the middle doesn't. */
export function tapZone(x: number, width: number): 'left' | 'center' | 'right' {
  if (x < width / 3) return 'left';
  if (x > (width * 2) / 3) return 'right';
  return 'center';
}

/** Left 40 % brightness, right 40 % volume, the middle 20 % neither. */
export function swipeZone(x: number, width: number): 'brightness' | 'volume' | null {
  if (x < width * 0.4) return 'brightness';
  if (x > width * 0.6) return 'volume';
  return null;
}

/** A swipe's level: the full height of the screen goes from 0 to 1; up raises it. */
export function levelAfterSwipe(start: number, dy: number, height: number): number {
  if (!(height > 0)) return start;
  return Math.min(1, Math.max(0, start - dy / height));
}

export interface SkipStreak {
  side: 'left' | 'right';
  /** Seconds skipped in this streak: negative back, positive forward. */
  total: number;
  at: number;
}

/** Double-taps on one side in a row add up (+10, +20…); the other side or a pause starts over. */
export function nextSkip(prev: SkipStreak | null, side: 'left' | 'right', now: number): SkipStreak {
  const step = side === 'left' ? -SKIP : SKIP;
  if (prev && prev.side === side && now - prev.at <= STREAK_MS) return { side, total: prev.total + step, at: now };
  return { side, total: step, at: now };
}

/** How much a video of `aspect` must grow to fill the view (never shrinks). */
export function fillScale(viewW: number, viewH: number, aspect = 16 / 9): number {
  if (!(viewW > 0 && viewH > 0)) return 1;
  const view = viewW / viewH;
  return Math.max(1, view > aspect ? view / aspect : aspect / view);
}

/** Clearly vertical: far enough to mean it, and much more up/down than sideways. */
export function isVertical(dx: number, dy: number): boolean {
  return Math.abs(dy) > 12 && Math.abs(dy) > 1.5 * Math.abs(dx);
}
