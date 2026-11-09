'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, Heart, X } from 'lucide-react';
import type { MapFilter, MovieMapData } from '@/lib/movieMap';

interface MapFiltersProps {
  data: MovieMapData;
  filter: MapFilter;
  onChange: (filter: MapFilter) => void;
  /** Films matching the filter, or null when there's no filter. */
  matching: number | null;
  /** The viewer's watchlist and history on the map; null when signed out. */
  mine: Set<number> | null;
}

const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960];
const CURRENT_YEAR = new Date().getFullYear();

const pill = 'flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors';
const idle = 'border-white/10 bg-[#141414]/90 text-white/70 backdrop-blur-xl hover:text-white';
const on = 'border-accent/40 bg-accent/15 text-accent';

/** Genres, language, decade and "my films", and the themes picked in search. */
export default function MapFilters({ data, filter, onChange, matching, mine }: MapFiltersProps) {
  const [genresOpen, setGenresOpen] = useState(false);
  const set = (changes: Partial<MapFilter>) => onChange({ ...filter, ...changes });
  const toggle = (list: number[], value: number) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const tags = filter.genres.length + filter.keywords.length;
  const yearsValue = filter.years ? String(filter.years[0]) : '';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button type="button" onClick={() => setGenresOpen((v) => !v)} className={`${pill} ${filter.genres.length ? on : idle}`}>
            Genres{filter.genres.length ? ` · ${filter.genres.length}` : ''}
            <ChevronDown size={13} />
          </button>
          {genresOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setGenresOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-2 grid w-[300px] grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#141414]/95 p-1.5 shadow-2xl backdrop-blur-xl">
                {data.genres.map((genre, g) => {
                  const picked = filter.genres.includes(g);
                  return (
                    <button
                      key={genre.id}
                      type="button"
                      onClick={() => set({ genres: toggle(filter.genres, g) })}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${picked ? 'bg-accent/15 text-accent' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
                    >
                      {genre.name}
                      {picked && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <label className={`${pill} ${filter.language !== null ? on : idle} relative pr-7`}>
          <span className="sr-only">Language</span>
          <select
            value={filter.language ?? ''}
            onChange={(e) => set({ language: e.target.value === '' ? null : Number(e.target.value) })}
            className="cursor-pointer appearance-none bg-transparent focus:outline-none"
          >
            <option value="">Any language</option>
            {data.languages.slice(0, 40).map((lang, n) => (
              <option key={lang.code} value={n}>
                {lang.name} ({lang.films.toLocaleString()})
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5" />
        </label>

        <label className={`${pill} ${filter.years ? on : idle} relative pr-7`}>
          <span className="sr-only">Decade</span>
          <select
            value={yearsValue}
            onChange={(e) => {
              const from = Number(e.target.value);
              set({ years: e.target.value === '' ? null : from === 0 ? [0, 1959] : [from, Math.min(from + 9, CURRENT_YEAR)] });
            }}
            className="cursor-pointer appearance-none bg-transparent focus:outline-none"
          >
            <option value="">Any decade</option>
            {DECADES.map((d) => <option key={d} value={d}>{d}s</option>)}
            <option value="0">Before 1960</option>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5" />
        </label>

        {mine && (
          <button
            type="button"
            disabled={mine.size === 0}
            onClick={() => set({ only: filter.only ? null : mine })}
            className={`${pill} ${filter.only ? on : idle} disabled:opacity-40`}
            title={mine.size === 0 ? 'Films on your watchlist or in your history show up here' : 'Your watchlist and history'}
          >
            <Heart size={13} className={filter.only ? 'fill-accent' : ''} />
            My films · {mine.size}
          </button>
        )}

        {matching !== null && (
          <span className="ml-1 text-[12px] text-white/50">
            <span className="font-semibold text-white">{matching.toLocaleString()}</span> of {data.count.toLocaleString()}
          </span>
        )}
      </div>

      {tags > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filter.genres.map((g) => (
            <Tag key={`g${g}`} label={data.genres[g].name} onRemove={() => set({ genres: filter.genres.filter((v) => v !== g) })} />
          ))}
          {filter.keywords.map((k) => (
            <Tag key={`k${k}`} label={data.keywords[k]} onRemove={() => set({ keywords: filter.keywords.filter((v) => v !== k) })} />
          ))}
          {tags > 1 && (
            <div className="ml-1 flex overflow-hidden rounded-lg border border-white/10 bg-[#141414]/90 text-[11px] font-semibold backdrop-blur-xl">
              {(['any', 'all'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set({ match: m })}
                  className={`px-2.5 py-1 transition-colors ${filter.match === m ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}
                >
                  {m === 'any' ? 'Any of these' : 'All of these'}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => set({ genres: [], keywords: [] })} className="ml-1 text-[11px] font-semibold text-white/40 hover:text-white">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

const Tag = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <span className="flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 py-1 pl-2.5 pr-1.5 text-[11px] font-semibold capitalize text-accent">
    {label}
    <button type="button" onClick={onRemove} className="rounded p-0.5 hover:bg-accent/20" aria-label={`Remove ${label}`}>
      <X size={11} />
    </button>
  </span>
);
