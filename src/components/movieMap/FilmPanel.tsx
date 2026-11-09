'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Star, X } from 'lucide-react';
import WatchlistButton from '@/components/WatchlistButton';
import { genreNames, posterUrl, similarFilms, type MovieMapData } from '@/lib/movieMap';

interface FilmPanelProps {
  data: MovieMapData;
  film: number;
  onSelect: (film: number) => void;
  onHighlight: (film: number | null) => void;
  onClose: () => void;
}

interface Brief {
  overview: string;
  tagline: string;
  runtime: number;
  directors: string[];
}

export const PANEL_WIDTH = 340;

/** The selected film: what it is, a way in, and the films nearest to it. */
export default function FilmPanel({ data, film, onSelect, onHighlight, onClose }: FilmPanelProps) {
  const id = data.ids[film];
  // Kept with the id it belongs to, so a stale answer never shows.
  const [brief, setBrief] = useState<{ id: number; brief: Brief | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/movie-brief?id=${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((b: Brief | null) => { if (!cancelled) setBrief({ id, brief: b }); });
    return () => { cancelled = true; };
  }, [id]);

  const details = brief?.id === id ? brief.brief : undefined;
  const title = data.titles[film];
  const region = data.regions[data.region[film]];
  const runtime = details?.runtime ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : null;

  return (
    <aside
      className="absolute bottom-4 right-4 top-4 z-30 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#121212]/95 shadow-2xl backdrop-blur-xl"
      style={{ width: PANEL_WIDTH }}
    >
      <div className="no-scrollbar flex-1 overflow-y-auto p-5">
        <div className="flex gap-4">
          <Image src={posterUrl(data, film, 'w185')} alt={title} width={92} height={138} className="h-[138px] w-[92px] shrink-0 rounded-xl bg-white/5 object-cover shadow-lg" />
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-[17px] font-bold leading-snug text-white">{title}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-white/50">
              <span>{data.years[film]}</span>
              {runtime && <><span className="text-white/20">•</span><span>{runtime}</span></>}
              <span className="text-white/20">•</span>
              <span className="flex items-center gap-1 text-white/80">
                <Star size={11} className="fill-yellow-500 text-yellow-500" />
                {(data.rating[film] / 10).toFixed(1)}
              </span>
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">{genreNames(data, film).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} className="-mr-1 -mt-1 h-7 w-7 shrink-0 rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white" aria-label="Close">
            <X size={16} className="mx-auto" />
          </button>
        </div>

        {region && (
          <p className="mt-4 flex items-center gap-2 text-[11px] text-white/45">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: region.color }} />
            <span className="truncate">On the map in <span className="text-white/75">{region.label}</span></span>
          </p>
        )}

        <div className="mt-4 min-h-[60px]">
          {details === undefined ? (
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-white/5" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-white/5" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
            </div>
          ) : details ? (
            <>
              {details.directors.length > 0 && (
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-accent">
                  {details.directors.slice(0, 2).join(' & ')}
                </p>
              )}
              <p className="line-clamp-5 text-[13px] leading-relaxed text-white/70">{details.overview || details.tagline}</p>
            </>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Link
            href={`/movie/${id}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-[13px] font-bold text-white shadow-lg shadow-accent/20 transition-colors hover:bg-accent/90"
          >
            <Play size={15} className="fill-white" />
            Open
          </Link>
          <WatchlistButton id={id} type="movie" title={title} posterPath={`/${data.posters[film]}.jpg`} variant="icon" />
        </div>

        <h3 className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Closest on the map</h3>
        <div className="-mx-2 space-y-0.5" onMouseLeave={() => onHighlight(null)}>
          {similarFilms(data, film).map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => onSelect(j)}
              onMouseEnter={() => onHighlight(j)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              <Image src={posterUrl(data, j, 'w92')} alt="" width={30} height={45} className="h-[45px] w-[30px] shrink-0 rounded-md bg-white/5 object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white/90">{data.titles[j]}</span>
                <span className="text-[11px] text-white/40">{data.years[j]}</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-white/50">
                <Star size={10} className="fill-accent text-accent" />
                {(data.rating[j] / 10).toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
