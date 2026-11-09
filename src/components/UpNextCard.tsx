'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { usePlayerState } from '@/hooks/usePlayerState';
import type { DesktopPlayer } from '@/lib/desktopPlayer';

/** Shown this close to the end, or when the episode ends. */
const SHOW_WITHIN_S = 20;
const COUNTDOWN_S = 10;

interface UpNextCardProps {
  next: { season: number; episode: number };
  /** The next episode's name, when known. */
  name?: string;
  onPlayNext: () => void;
  /** Where playback is reported from, when it isn't the stream (a download). */
  player?: DesktopPlayer | null;
}

/**
 * "Up next" as an episode finishes, counting down to the next one. Give it a
 * `key` per episode, so dismissing it only lasts for the episode at hand.
 * Lives in the player's overlay, so it's visible in fullscreen too.
 */
const UpNextCard = ({ next, name, onPlayNext, player }: UpNextCardProps) => {
  const state = usePlayerState(player);
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState(COUNTDOWN_S);

  const nearEnd =
    state !== null &&
    (state.event === 'ended' ||
      (state.duration > 0 && state.duration - state.time <= SHOW_WITHIN_S && state.time > 60));
  const visible = nearEnd && !dismissed;

  // The page re-renders every second while playing, handing us a new
  // callback each time; depending on it would restart the countdown.
  const playNext = useRef(onPlayNext);
  useEffect(() => {
    playNext.current = onPlayNext;
  }, [onPlayNext]);

  useEffect(() => {
    if (!visible) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const left = COUNTDOWN_S - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(left, 0));
      if (left <= 0) {
        clearInterval(timer);
        playNext.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="pointer-events-auto absolute bottom-20 right-5 w-72 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-2xl p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Up next</p>
              <p className="text-sm font-bold text-white truncate">
                S{next.season} E{next.episode}
                {name ? ` · ${name}` : ''}
              </p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Cancel autoplay"
              title="Cancel"
            >
              <X size={15} />
            </button>
          </div>
          <button
            onClick={onPlayNext}
            className="relative w-full overflow-hidden flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black text-sm font-bold hover:bg-white/90 transition-colors"
          >
            {/* The fill drains as the countdown runs. */}
            <span
              className="absolute inset-y-0 left-0 bg-accent/30 transition-[width] duration-300 ease-linear"
              style={{ width: `${(remaining / COUNTDOWN_S) * 100}%` }}
            />
            <Play size={15} className="relative" fill="currentColor" />
            <span className="relative">Play now · {remaining}s</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UpNextCard;
