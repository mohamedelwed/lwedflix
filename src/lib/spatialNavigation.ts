/**
 * Picking the next thing to focus when a TV remote's arrow is pressed: the
 * nearest candidate that lies in that direction, favouring ones in line with
 * where focus is now (so Down from a card in a row goes to the card below,
 * not to one a screen to the side). Pure geometry, so it's testable without
 * a page; src/components/tv/TvNavigation.tsx does the DOM side.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Pixels two boxes may overlap and still count as one beyond the other. */
const TOLERANCE = 4;
/** How much being out of line counts against a candidate, against distance. */
const ALIGNMENT_WEIGHT = 2;

export const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** The gap between two ranges on one axis; 0 when they overlap. */
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}

/** How far `to` is from `from` going `direction`, or null if it isn't that way. */
export function distance(from: Box, to: Box, direction: Direction): number | null {
  let along: number;
  let across: number;
  let centreOffset: number;
  const vertical = direction === 'up' || direction === 'down';
  if (direction === 'down') {
    if (to.top < from.bottom - TOLERANCE) return null;
    along = Math.max(0, to.top - from.bottom);
  } else if (direction === 'up') {
    if (to.bottom > from.top + TOLERANCE) return null;
    along = Math.max(0, from.top - to.bottom);
  } else if (direction === 'right') {
    if (to.left < from.right - TOLERANCE) return null;
    along = Math.max(0, to.left - from.right);
  } else {
    if (to.right > from.left + TOLERANCE) return null;
    along = Math.max(0, from.left - to.right);
  }
  if (vertical) {
    across = gap(from.left, from.right, to.left, to.right);
    centreOffset = Math.abs((from.left + from.right) / 2 - (to.left + to.right) / 2);
  } else {
    across = gap(from.top, from.bottom, to.top, to.bottom);
    centreOffset = Math.abs((from.top + from.bottom) / 2 - (to.top + to.bottom) / 2);
  }
  return along + across * ALIGNMENT_WEIGHT + centreOffset * 0.05;
}

/** The best candidate going `direction` from `from`, or null if there's none. */
export function pickNext<T>(from: Box, candidates: readonly { item: T; box: Box }[], direction: Direction): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const { item, box } of candidates) {
    const score = distance(from, box, direction);
    if (score !== null && score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** Where focus starts when nothing has it: the top-left-most candidate. */
export function pickFirst<T>(candidates: readonly { item: T; box: Box }[]): T | null {
  let best: { item: T; box: Box } | null = null;
  for (const candidate of candidates) {
    if (
      !best ||
      candidate.box.top < best.box.top - TOLERANCE ||
      (Math.abs(candidate.box.top - best.box.top) <= TOLERANCE && candidate.box.left < best.box.left)
    ) {
      best = candidate;
    }
  }
  return best?.item ?? null;
}
