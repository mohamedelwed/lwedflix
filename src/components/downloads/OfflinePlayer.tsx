'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FolderOpen, Loader2 } from 'lucide-react';
import PlayerControls from '@/components/PlayerControls';
import UpNextCard from '@/components/UpNextCard';
import { useAuth } from '@/components/AuthProvider';
import { createLocalPlayer } from '@/lib/localPlayer';
import { episodeCode, getDownloadsBridge, mediaUrl, useDownloads, type Download } from '@/lib/downloads';
import { getMovieResume, setMovieProgress } from '@/lib/movieProgress';
import { getEpisodePositions, setEpisodePosition, setLastPosition } from '@/lib/episodeProgress';
import { recordWatch } from '@/lib/watchHistory';
import type { PlayerCommand } from '@/lib/desktopPlayer';

type LocalPlayer = ReturnType<typeof createLocalPlayer>;

/** Where to pick up: the same rules as the online player's. */
function resumeAt(d: Download): number | undefined {
  if (!d.mediaId) return undefined;
  if (d.mediaType === 'movie') return getMovieResume(d.mediaId);
  const saved = getEpisodePositions(d.mediaId)[`${d.season ?? 1}-${d.episode ?? 1}`];
  return saved && saved.duration > 0 && saved.watched / saved.duration < 0.9 ? saved.watched : undefined;
}

/**
 * A downloaded film or episode, played from the computer: the app's own
 * controls, progress and history kept exactly as when streaming, and the
 * next downloaded episode up next.
 */
export default function OfflinePlayer({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { available, downloads, loaded } = useDownloads();
  const item = downloads.find((d) => d.id === id && d.state === 'done') ?? null;
  const box = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<LocalPlayer | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [broken, setBroken] = useState(false);

  // The next downloaded episode of the same show.
  const next = item?.mediaType === 'tv'
    ? downloads
        .filter((d) => d.state === 'done' && d.mediaType === 'tv' && d.mediaId === item.mediaId)
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
        .find((d) => (d.season ?? 0) > (item.season ?? 0) || ((d.season ?? 0) === (item.season ?? 0) && (d.episode ?? 0) > (item.episode ?? 0)))
    : undefined;

  // The adapter lives as long as its <video>.
  const current = useRef<LocalPlayer | null>(null);
  const attach = useCallback((video: HTMLVideoElement | null) => {
    current.current?.destroy();
    current.current = video ? createLocalPlayer(video) : null;
    setPlayer(current.current);
  }, []);

  // Progress and history, as the online player keeps them.
  const itemId = item?.id;
  useEffect(() => {
    if (!player || !item) return;
    const { mediaId, mediaType } = item;
    const season = item.season ?? 1;
    const episode = item.episode ?? 1;
    if (mediaType === 'tv' && mediaId) setLastPosition(mediaId, season, episode);
    let resumed = false;
    let historyTimer: ReturnType<typeof setTimeout> | undefined;
    const off = player.onState((state) => {
      if (!state || !(state.duration > 0)) return;
      if (!resumed) {
        resumed = true;
        const at = resumeAt(item);
        if (at) player.command({ action: 'seek', time: at });
      }
      if (mediaId && (state.event === 'timeupdate' || state.event === 'pause' || state.event === 'ended' || state.event === 'seeked')) {
        const watched = state.event === 'ended' ? state.duration : state.time;
        if (mediaType === 'movie') setMovieProgress(mediaId, watched, state.duration);
        else setEpisodePosition(mediaId, season, episode, watched, state.duration);
      }
      if (state.playing && !historyTimer && user && mediaId) {
        historyTimer = setTimeout(() => {
          void recordWatch({
            user_id: user.id,
            movie_id: String(mediaId),
            type: mediaType,
            title: mediaType === 'tv' ? item.showTitle || item.title : item.title,
            poster_path: item.posterPath,
            season: mediaType === 'tv' ? season : null,
            episode: mediaType === 'tv' ? episode : null,
            watched_at: new Date().toISOString(),
          });
        }, 10000);
      }
    });
    return () => {
      off();
      clearTimeout(historyTimer);
    };
    // Re-run per download, not per list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, itemId, user]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  }, []);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The same shortcuts as the online player.
  useEffect(() => {
    if (!player) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      const key = e.key.toLowerCase();
      let command: PlayerCommand | null = null;
      if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (key === ' ' || key === 'k') command = { action: 'toggle' };
      else if (key === 'arrowleft' || key === 'j') command = { action: 'seekBy', delta: -10 };
      else if (key === 'arrowright' || key === 'l') command = { action: 'seekBy', delta: 10 };
      else if (key === 'm') command = { action: 'toggleMute' };
      else if (key === 'p') command = { action: 'pip' };
      if (!command) return;
      e.preventDefault();
      player.command(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [player, toggleFullscreen]);

  const playNext = useCallback(() => {
    if (next) router.push(`/downloads/watch/${next.id}`);
  }, [next, router]);

  const frame = 'fixed bottom-0 left-[232px] right-0 top-14 bg-black';

  if (!available || (loaded && !item)) {
    return (
      <div className={`${frame} flex flex-col items-center justify-center gap-3 text-center`}>
        <p className="text-sm font-semibold text-white">{available ? 'That download isn’t here any more.' : 'Downloads play in the Lwedflix app.'}</p>
        <Link href="/downloads" className="text-xs font-semibold text-accent hover:underline">Back to Downloads</Link>
      </div>
    );
  }
  if (!item) {
    return <div className={`${frame} flex items-center justify-center`}><Loader2 className="animate-spin text-accent" /></div>;
  }

  const heading = item.mediaType === 'tv'
    ? `${item.showTitle || item.title} · ${episodeCode(item)}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
    : item.title;

  return (
    <div className={frame}>
      <div ref={box} className="group relative h-full w-full bg-black">
        <video
          key={item.id}
          ref={attach}
          src={mediaUrl(item.id)}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setBroken(true)}
        />

        {player && !broken && (
          <PlayerControls
            player={player}
            onToggleFullscreen={toggleFullscreen}
            onNext={next ? playNext : undefined}
            nextLabel={next ? episodeCode(next) : undefined}
          />
        )}

        {next && player && (
          <div className="pointer-events-none absolute inset-0 z-20">
            <UpNextCard
              key={item.id}
              player={player}
              next={{ season: next.season ?? 1, episode: next.episode ?? 1 }}
              name={next.episodeTitle ?? undefined}
              onPlayNext={playNext}
            />
          </div>
        )}

        {/* The title and a way back, until the controls hide with the pointer. */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent px-5 pb-10 pt-4 transition-opacity ${fullscreen ? 'opacity-0 group-hover:opacity-100' : ''}`}>
          <div className="pointer-events-auto flex items-center gap-3">
            <Link href="/downloads" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md hover:text-white" aria-label="Back to Downloads">
              <ArrowLeft size={17} />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{heading}</p>
              <p className="text-[11px] text-white/50">Playing from your downloads{item.quality ? ` · ${item.quality}` : ''}</p>
            </div>
          </div>
        </div>

        {broken && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 text-center">
            <p className="text-sm font-semibold text-white">This file won’t play here.</p>
            <p className="max-w-sm text-xs text-white/50">It may be in a format the app can’t play. It’s still on your computer — try opening it in another player.</p>
            <button onClick={() => void getDownloadsBridge()?.reveal(item.id)} className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
              <FolderOpen size={14} /> Show in folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
