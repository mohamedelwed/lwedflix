'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Download, Loader2 } from 'lucide-react';
import { getDownloadsBridge, isActive, useDownloads } from '@/lib/downloads';

interface SeasonDownloadButtonProps {
  showId: number;
  showTitle: string;
  posterPath?: string;
  /** The season on screen. */
  season: number;
  /** Every real season (no specials), with its episode count. */
  seasons: { season_number: number; episode_count: number }[];
}

const QUALITIES: { label: string; height: number | null }[] = [
  { label: 'Best', height: null },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p', height: 480 },
];
const QUALITY_KEY = 'lwedflix:download-quality';

function savedQuality(): number | null {
  try {
    const value = Number(localStorage.getItem(QUALITY_KEY));
    return QUALITIES.some((q) => q.height === value) ? value : null;
  } catch {
    return null;
  }
}

/** Episodes that have aired, with their titles (TMDB, through /api/tv-season). */
async function airedEpisodes(showId: number, season: number) {
  const res = await fetch(`/api/tv-season?id=${showId}&season=${season}`);
  const data = res.ok ? await res.json() : { episodes: [] };
  const today = new Date().toISOString().slice(0, 10);
  return ((data.episodes ?? []) as { episode_number: number; name?: string; air_date?: string | null }[])
    .filter((e) => e.air_date && e.air_date <= today)
    .map((e) => ({ season, episode: e.episode_number, episodeTitle: e.name }));
}

/**
 * Downloads a whole season, or every season. Episodes queue up and each finds
 * its own stream when its turn comes (electron/resolver.js), so nothing has
 * to be played first. Renders nothing outside the app.
 */
export default function SeasonDownloadButton({ showId, showTitle, posterPath, season, seasons }: SeasonDownloadButtonProps) {
  const { available, downloads } = useDownloads();
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [busy, setBusy] = useState<'season' | 'all' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (!available) return null;

  const mine = downloads.filter((d) => d.mediaType === 'tv' && d.mediaId === showId && (d.state === 'done' || isActive(d)));
  const inSeason = mine.filter((d) => d.season === season).length;
  const seasonCount = seasons.find((s) => s.season_number === season)?.episode_count ?? 0;
  const total = seasons.reduce((sum, s) => sum + s.episode_count, 0);

  const toggle = () => {
    if (!open) setHeight(savedQuality());
    setResult(null);
    setOpen((v) => !v);
  };

  const chooseQuality = (value: number | null) => {
    setHeight(value);
    try {
      if (value) localStorage.setItem(QUALITY_KEY, String(value));
      else localStorage.removeItem(QUALITY_KEY);
    } catch {
      // Only a preference.
    }
  };

  const queue = async (which: 'season' | 'all') => {
    const bridge = getDownloadsBridge();
    if (!bridge) return;
    setBusy(which);
    setResult(null);
    try {
      const wanted = which === 'season' ? [season] : seasons.map((s) => s.season_number);
      const episodes = (await Promise.all(wanted.map((n) => airedEpisodes(showId, n).catch(() => [])))).flat();
      if (episodes.length === 0) {
        setResult('No aired episodes to download.');
        return;
      }
      const { added, skipped } = await bridge.enqueue({ title: showTitle, mediaId: showId, posterPath }, episodes, { height });
      setResult(
        added === 0
          ? 'All of those are downloaded or on their way already.'
          : `${added} episode${added === 1 ? '' : 's'} queued${skipped ? ` (${skipped} already there)` : ''}.`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition-colors ${open ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/10 bg-card text-white/80 hover:text-white'}`}
        title="Download episodes"
      >
        <Download size={15} />
        <span className="hidden sm:inline">Download</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-white/10 bg-[#141414]/95 p-2 shadow-2xl backdrop-blur-xl">
            <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-white/40">Download to watch offline</p>

            {[
              { which: 'season' as const, title: `Season ${season}`, detail: `${seasonCount} episodes${inSeason ? ` · ${inSeason} already here` : ''}` },
              { which: 'all' as const, title: 'Every season', detail: `${total} episodes in ${seasons.length} season${seasons.length === 1 ? '' : 's'}${mine.length ? ` · ${mine.length} already here` : ''}` },
            ].map((option) => (
              <button
                key={option.which}
                disabled={busy !== null}
                onClick={() => void queue(option.which)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/[0.07] disabled:opacity-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  {busy === option.which ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-white">{option.title}</span>
                  <span className="block truncate text-[11px] text-white/40">{option.detail}</span>
                </span>
              </button>
            ))}

            <div className="mt-1 border-t border-white/5 px-2 pb-1 pt-2.5">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">Quality</p>
              <div className="flex gap-1">
                {QUALITIES.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => chooseQuality(q.height)}
                    className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${height === q.height ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-white/30">Each episode finds its stream when its turn comes, two at a time. A server with less than this sends what it has.</p>
            </div>

            {result && (
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-accent/10 px-2.5 py-2 text-[11px] text-accent">
                <Check size={13} className="shrink-0" />
                <span className="flex-1">{result}</span>
                <Link href="/downloads" onClick={() => setOpen(false)} className="flex shrink-0 items-center font-semibold hover:underline">
                  Downloads <ChevronRight size={12} />
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
