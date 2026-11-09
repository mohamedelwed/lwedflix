'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Captions,
  Settings,
  SkipForward,
  Loader2,
  Check,
} from 'lucide-react';
import type { DesktopPlayer, PlayerState } from '@/lib/desktopPlayer';
import { formatTimestamp } from '@/lib/watchRoom';

/** Controls fade after this long without the mouse moving (while playing). */
const HIDE_AFTER_MS = 2500;
/** Long enough to tell a double-click (fullscreen) from a click (play/pause). */
const DOUBLE_CLICK_MS = 220;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VOLUME_KEY = 'lwedflix:volume';

interface PlayerControlsProps {
  player: DesktopPlayer;
  onToggleFullscreen: () => void;
  /** Shown as a "next episode" button when given. */
  onNext?: () => void;
  nextLabel?: string;
  /** Hands the player back to the server's own controls; without it, that option isn't offered. */
  onUseServerControls?: () => void;
  /** Called with whether a stream is under these controls. */
  onStreamChange?: (streaming: boolean) => void;
  /** More buttons for the right of the bar. */
  extra?: React.ReactNode;
}

function readVolume(): { volume: number; muted: boolean } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
    return saved && typeof saved.volume === 'number' ? { volume: saved.volume, muted: Boolean(saved.muted) } : null;
  } catch {
    return null;
  }
}

function saveVolume(volume: number, muted: boolean) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // Not remembered; nothing else lost.
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The app's own player controls, drawn over the server's player once its
 * stream is playing. The server's interface is hidden at the same time (the
 * bridge's "clean" mode, electron/preload.js), so only the picture is left
 * of it. Everything here goes through the player bridge, which is also what
 * keeps watch parties in step — a pause from these controls is a pause like
 * any other.
 */
const PlayerControls = ({
  player,
  onToggleFullscreen,
  onNext,
  nextLabel,
  onUseServerControls,
  onStreamChange,
  extra,
}: PlayerControlsProps) => {
  const [report, setReport] = useState<{ state: PlayerState; at: number } | null>(null);
  // A seek we've asked for, shown until the player confirms it.
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);

  useEffect(
    () =>
      player.onState((state) => {
        setReport(state ? { state, at: Date.now() } : null);
        if (!state || state.event === 'seeked') setPendingSeek(null);
      }),
    [player]
  );

  // A paused player reports nothing until it's touched; ask, so controls
  // turned on mid-film show up straight away.
  useEffect(() => player.command({ action: 'report' }), [player]);

  const state = report?.state ?? null;
  const streaming = state !== null;

  useEffect(() => {
    onStreamChange?.(streaming);
  }, [streaming, onStreamChange]);

  // Hide the server's interface while ours is up, and give every new stream
  // the volume chosen last time.
  useEffect(() => {
    if (!streaming) return;
    player.command({ action: 'clean', on: true });
    const saved = readVolume();
    if (saved) {
      player.command({ action: 'setVolume', volume: saved.volume });
      if (saved.muted) player.command({ action: 'setMuted', muted: true });
    }
    return () => player.command({ action: 'clean', on: false });
  }, [streaming, player]);

  // Between reports (about one a second) the time is carried forward here,
  // so the bar moves smoothly.
  const playing = Boolean(state?.playing && !state.buffering);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [playing]);

  // ---- Showing and hiding ------------------------------------------------

  const [recentlyMoved, setRecentlyMoved] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const poke = useCallback(() => {
    setRecentlyMoved(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRecentlyMoved(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    // Keyboard shortcuts (handled by the player) show the controls too.
    window.addEventListener('keydown', poke);
    return () => {
      window.removeEventListener('keydown', poke);
      clearTimeout(hideTimer.current);
    };
  }, [poke]);

  const [menu, setMenuState] = useState<'settings' | 'captions' | null>(null);
  // A click outside an open menu closes it, and does nothing else — the
  // menu closes on pointer-down, before that click reaches the video.
  const menuClosedAt = useRef(0);
  const setMenu = (next: 'settings' | 'captions' | null) => {
    if (menu && !next) menuClosedAt.current = Date.now();
    setMenuState(next);
  };
  const [overBar, setOverBar] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // A big play/pause mark, briefly, where you clicked.
  const [flash, setFlash] = useState<{ playing: boolean; key: number } | null>(null);

  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  const visible = !state?.playing || recentlyMoved || overBar || menu !== null || scrubbing;

  // Subtitles sit at the bottom of the picture, right where the bar is: they
  // move up while it shows. (The player's frame is the same size as this
  // box, so pixels here are pixels there.)
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!streaming) return;
    player.command({ action: 'liftSubtitles', px: visible ? (barRef.current?.offsetHeight ?? 0) + 8 : 0 });
  }, [visible, streaming, player]);

  if (!state) return null;

  const duration = state.duration;
  const elapsed = playing && now > report!.at ? ((now - report!.at) / 1000) * state.rate : 0;
  const time = pendingSeek ?? Math.min(state.time + elapsed, duration || Infinity);

  const togglePlay = () => {
    player.command({ action: 'toggle' });
    setFlash({ playing: !state.playing, key: Date.now() });
  };

  const onSurfaceClick = () => {
    poke();
    if (menu || Date.now() - menuClosedAt.current < 400) {
      setMenu(null);
      return;
    }
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = undefined;
      onToggleFullscreen();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = undefined;
      togglePlay();
    }, DOUBLE_CLICK_MS);
  };

  const seek = (to: number) => {
    const target = clamp(to, 0, duration);
    setPendingSeek(target);
    player.command({ action: 'seek', time: target });
  };

  const setVolume = (volume: number) => {
    player.command({ action: 'setVolume', volume });
    saveVolume(volume, false);
  };
  const toggleMute = () => {
    player.command({ action: 'setMuted', muted: !state.muted });
    saveVolume(state.volume, !state.muted);
  };
  const VolumeIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      {/* Takes every click meant for the video: nothing reaches the
          server's page (or its ads) any more. */}
      <div
        className={`absolute inset-0 z-10 ${visible ? '' : 'cursor-none'}`}
        onMouseMove={poke}
        onClick={onSurfaceClick}
      />

      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
        {state.buffering ? (
          <Loader2 size={44} className="animate-spin text-white/80 drop-shadow-lg" />
        ) : (
          !state.playing && (
            <button
              onClick={togglePlay}
              className="pointer-events-auto w-16 h-16 rounded-full bg-black/50 backdrop-blur-md border border-white/15 flex items-center justify-center text-white hover:bg-accent hover:border-accent hover:scale-105 transition-all shadow-2xl"
              aria-label="Play"
            >
              <Play size={26} className="ml-1" fill="currentColor" />
            </button>
          )
        )}
        <AnimatePresence>
          {flash && state.playing && (
            <motion.div
              key={flash.key}
              initial={{ opacity: 0.9, scale: 0.8 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 0.5 }}
              onAnimationComplete={() => setFlash(null)}
              className="absolute w-16 h-16 rounded-full bg-black/50 flex items-center justify-center text-white"
            >
              {flash.playing ? <Play size={26} className="ml-1" fill="currentColor" /> : <Pause size={26} fill="currentColor" />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.25 }}
        className={`absolute inset-x-0 bottom-0 z-30 px-4 pb-3 pt-16 bg-gradient-to-t from-black/90 via-black/45 to-transparent ${
          visible ? '' : 'pointer-events-none'
        }`}
        onMouseEnter={() => setOverBar(true)}
        onMouseLeave={() => setOverBar(false)}
        // Buttons here shouldn't keep keyboard focus: Space and the arrows
        // belong to the player.
        onMouseDown={(e) => e.preventDefault()}
      >
        <div ref={barRef}>
        {duration > 0 && (
          <SeekBar
            time={time}
            duration={duration}
            buffered={state.buffered}
            onSeek={seek}
            onScrubbing={setScrubbing}
          />
        )}

        <div className="mt-2 flex items-center gap-1 text-white">
          <BarButton label={state.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay}>
            {state.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </BarButton>
          <BarButton label="Back 10 seconds (←)" onClick={() => seek(time - 10)}>
            <SkipIcon direction="back" />
          </BarButton>
          <BarButton label="Forward 10 seconds (→)" onClick={() => seek(time + 10)}>
            <SkipIcon direction="forward" />
          </BarButton>
          {onNext && (
            <BarButton label={nextLabel ? `Next: ${nextLabel}` : 'Next episode'} onClick={onNext}>
              <SkipForward size={19} fill="currentColor" />
            </BarButton>
          )}

          <div className="group/volume flex items-center">
            <BarButton label={state.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={toggleMute}>
              <VolumeIcon size={20} />
            </BarButton>
            <div className="w-0 group-hover/volume:w-24 overflow-hidden transition-[width] duration-200">
              <VolumeSlider value={state.muted ? 0 : state.volume} onChange={setVolume} />
            </div>
          </div>

          <span className="ml-2 text-[13px] font-medium tabular-nums text-white/85 select-none">
            {formatTimestamp(time)}
            <span className="text-white/40"> / {formatTimestamp(duration)}</span>
          </span>

          <div className="flex-1" />

          {extra}

          {state.tracks.length > 0 && (
            <Menu
              open={menu === 'captions'}
              onOpenChange={(open) => setMenu(open ? 'captions' : null)}
              button={
                <span className="relative">
                  <Captions size={20} />
                  {state.track >= 0 && <span className="absolute -bottom-1.5 inset-x-1 h-0.5 rounded-full bg-accent" />}
                </span>
              }
              label="Subtitles"
            >
              <MenuItem selected={state.track === -1} onClick={() => player.command({ action: 'setTrack', index: -1 })}>
                Off
              </MenuItem>
              {state.tracks.map((track, i) => (
                <MenuItem key={i} selected={state.track === i} onClick={() => player.command({ action: 'setTrack', index: i })}>
                  {track.label || track.language || `Track ${i + 1}`}
                </MenuItem>
              ))}
            </Menu>
          )}

          <Menu
            open={menu === 'settings'}
            onOpenChange={(open) => setMenu(open ? 'settings' : null)}
            button={<Settings size={19} />}
            label="Settings"
          >
            <p className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">Speed</p>
            <div className="grid grid-cols-3 gap-1 px-2 pb-2">
              {RATES.map((rate) => (
                <button
                  key={rate}
                  onClick={() => player.command({ action: 'setRate', rate })}
                  className={`py-1.5 rounded-lg text-xs font-bold tabular-nums transition-colors ${
                    state.rate === rate ? 'bg-accent text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  {rate === 1 ? 'Normal' : `${rate}×`}
                </button>
              ))}
            </div>
            {onUseServerControls && (
              <>
                <div className="h-px bg-white/10 my-1" />
                <button
                  onClick={() => {
                    setMenu(null);
                    onUseServerControls();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <span className="block text-xs font-bold text-white">Use the server&apos;s controls</span>
                  <span className="block text-[11px] text-white/45">For its own subtitles, quality and audio menus</span>
                </button>
              </>
            )}
          </Menu>

          <BarButton label="Mini player (P)" onClick={() => player.command({ action: 'pip' })}>
            <PictureInPicture2 size={19} />
          </BarButton>
          <BarButton label={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onClick={onToggleFullscreen}>
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </BarButton>
        </div>
        </div>
      </motion.div>
    </>
  );
};

const BarButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={label}
    aria-label={label}
    className="p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
  >
    {children}
  </button>
);

const SkipIcon = ({ direction }: { direction: 'back' | 'forward' }) => {
  const Icon = direction === 'back' ? RotateCcw : RotateCw;
  return (
    <span className="relative flex items-center justify-center w-5 h-5">
      <Icon size={20} strokeWidth={1.75} />
      <span className="absolute text-[7.5px] font-black leading-none pt-px">10</span>
    </span>
  );
};

/** Click or drag anywhere along it; shows the time under the pointer. */
const SeekBar = ({
  time,
  duration,
  buffered,
  onSeek,
  onScrubbing,
}: {
  time: number;
  duration: number;
  buffered: number;
  onSeek: (time: number) => void;
  onScrubbing: (scrubbing: boolean) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const fractionAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  const played = drag ?? clamp(time / duration, 0, 1);
  const loaded = clamp(buffered / duration, 0, 1);
  const tip = drag ?? hover;

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatTimestamp(time)}
      className="group/seek relative h-4 flex items-center cursor-pointer touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(fractionAt(e.clientX));
        onScrubbing(true);
      }}
      onPointerMove={(e) => {
        const fraction = fractionAt(e.clientX);
        setHover(fraction);
        if (drag !== null) setDrag(fraction);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(fractionAt(e.clientX) * duration);
        setDrag(null);
        onScrubbing(false);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="relative w-full h-1 group-hover/seek:h-1.5 rounded-full bg-white/20 transition-[height] duration-150">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${loaded * 100}%` }} />
        {hover !== null && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${hover * 100}%` }} />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${played * 100}%` }} />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-accent shadow-[0_0_0_4px_rgba(255,153,0,0.25)] transition-transform duration-150 ${
            drag !== null ? 'scale-100' : 'scale-0 group-hover/seek:scale-100'
          }`}
          style={{ left: `${played * 100}%` }}
        />
      </div>
      {tip !== null && (
        <span
          className="absolute bottom-5 -translate-x-1/2 px-2 py-1 rounded-md bg-black/85 border border-white/10 text-[11px] font-bold tabular-nums text-white pointer-events-none"
          style={{ left: `clamp(24px, ${tip * 100}%, calc(100% - 24px))` }}
        >
          {formatTimestamp(tip * duration)}
        </span>
      )}
    </div>
  );
};

const VolumeSlider = ({ value, onChange }: { value: number; onChange: (volume: number) => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };
  const shown = drag ?? value;
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      className="relative mx-2 h-6 w-20 flex items-center cursor-pointer touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = at(e.clientX);
        setDrag(v);
        onChange(v);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = at(e.clientX);
        setDrag(v);
        onChange(v);
      }}
      onPointerUp={() => setDrag(null)}
    >
      <div className="relative w-full h-1 rounded-full bg-white/25">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${shown * 100}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white" style={{ left: `${shown * 100}%` }} />
      </div>
    </div>
  );
};

/** A button with a panel above it; closes on any click outside. */
const Menu = ({
  open,
  onOpenChange,
  button,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative">
      <BarButton label={label} onClick={() => onOpenChange(!open)}>
        {button}
      </BarButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-2 w-60 max-h-72 overflow-y-auto p-1.5 rounded-2xl bg-neutral-950/95 backdrop-blur-xl border border-white/10 shadow-2xl"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MenuItem = ({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${
      selected ? 'text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white'
    }`}
  >
    <span className="w-3.5 shrink-0 text-accent">{selected && <Check size={14} />}</span>
    <span className="truncate">{children}</span>
  </button>
);

export default PlayerControls;
