'use client';

import { useEffect } from 'react';
import { getTvShell, useIsTv } from '@/lib/tv';
import { ARROW_KEYS, pickFirst, pickNext, type Box, type Direction } from '@/lib/spatialNavigation';

/**
 * Remote-control navigation for the TV app. A TV remote has arrows, OK and
 * Back — no pointer — so the arrows move focus to the nearest control that
 * way, OK presses it, and Back closes what's open before leaving the page.
 *
 * In the fullscreen player, Left/Right seek and OK plays or pauses (as the
 * player's own shortcuts do), and Up/Down step into the control bar; Down
 * off the bottom of it hands the arrows back to the player.
 *
 * Renders nothing, and does nothing outside the TV app.
 */
const TvNavigation = () => {
  const tv = useIsTv();

  useEffect(() => {
    if (!tv) return;
    document.documentElement.classList.add('tv');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      const scope = currentScope();
      const focusInScope = active !== null && scope.contains(active);
      const player = document.fullscreenElement;

      if (event.key === 'Enter') {
        if (active && isTextField(active) && !(active as HTMLInputElement).value) {
          // OK on an empty field means "let me type", not "submit".
          event.preventDefault();
          getTvShell()?.showKeyboard?.();
        } else if (player && !focusInScope) {
          event.preventDefault();
          window.lwedflixPlayer?.command({ action: 'toggle' });
        }
        return;
      }

      const direction = ARROW_KEYS[event.key];
      if (!direction) return;

      // Left/Right move the caret until it reaches the end of the text.
      if (active && isTextField(active) && (direction === 'left' || direction === 'right') && !atEdge(active, direction)) return;

      if (player && !focusInScope) {
        // Left/Right are the player's (seek ±10 s).
        if (direction === 'left' || direction === 'right') return;
        event.preventDefault();
        const first = focusables(player).find((el) => el.matches('[data-tv-primary]')) ?? focusables(player)[0];
        first?.focus({ preventScroll: true });
        return;
      }

      event.preventDefault();
      const candidates = focusables(scope)
        .filter((el) => el !== active)
        .map((el) => ({ item: el, box: boxOf(el) }));
      const next = focusInScope
        ? pickNext(boxOf(active!), candidates, direction)
        : pickFirst(candidates.filter(({ box }) => onScreen(box)));

      if (next) {
        next.focus({ preventScroll: true });
        next.scrollIntoView({
          block: direction === 'up' || direction === 'down' ? 'center' : 'nearest',
          inline: 'nearest',
          behavior: 'smooth',
        });
      } else if (player && direction === 'down') {
        // Off the bottom of the control bar: back to seeking.
        active?.blur();
      } else if (scope === document.body && (direction === 'up' || direction === 'down')) {
        // Nothing more that way to focus; still let the page move.
        window.scrollBy({ top: (direction === 'down' ? 0.6 : -0.6) * window.innerHeight, behavior: 'smooth' });
      }
    };

    // Before the page's own handlers, so a handled arrow doesn't also scroll
    // or seek.
    window.addEventListener('keydown', onKeyDown, true);
    window.__lwedflixTvBack = back;
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (window.__lwedflixTvBack === back) delete window.__lwedflixTvBack;
      document.documentElement.classList.remove('tv');
    };
  }, [tv]);

  return null;
};

/** Back: close the innermost open thing; false if there was nothing to close. */
function back(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && isTextField(active)) {
    active.blur();
    return true;
  }
  const layer = topLayer();
  if (layer) {
    // Modals close when their backdrop (the layer's first element) is clicked.
    (layer.firstElementChild as HTMLElement | null)?.click();
    return true;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return true;
  }
  // Things that close on Escape, like the player's lights-off mode.
  if (document.querySelector('[data-tv-escape]')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  return false;
}

/** Where the arrows move focus: the fullscreen player, an open modal, or the page. */
function currentScope(): HTMLElement {
  const fullscreen = document.fullscreenElement;
  if (fullscreen instanceof HTMLElement) return fullscreen;
  return topLayer() ?? document.body;
}

/** The newest open modal (ModalPortal marks them). */
function topLayer(): HTMLElement | null {
  const layers = [...document.querySelectorAll<HTMLElement>('[data-tv-layer]')].filter((el) => focusables(el).length > 0);
  return layers.at(-1) ?? null;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusables(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isShown);
}

function isShown(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  return getComputedStyle(el).visibility !== 'hidden';
}

function boxOf(el: HTMLElement): Box {
  const { left, top, right, bottom } = el.getBoundingClientRect();
  return { left, top, right, bottom };
}

function onScreen(box: Box): boolean {
  return box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
}

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return (el as HTMLElement).isContentEditable;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(el.type);
}

/** Whether the caret is at the start (going left) or the end (going right). */
function atEdge(el: HTMLElement, direction: Direction): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return true;
  try {
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart === null || selectionEnd === null) return true;
    return direction === 'left' ? selectionStart === 0 : selectionEnd === value.length;
  } catch {
    // Some input types (email, number) don't expose a selection.
    return true;
  }
}

export default TvNavigation;
