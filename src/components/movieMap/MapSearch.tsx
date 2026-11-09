'use client';

import React, { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Search, Sparkles, X } from 'lucide-react';
import { posterUrl, searchFilms, searchKeywords, type MovieMapData } from '@/lib/movieMap';

interface MapSearchProps {
  data: MovieMapData;
  onFilm: (film: number) => void;
  onTheme: (keyword: number) => void;
}

type Result = { kind: 'film'; index: number } | { kind: 'theme'; index: number };

/** Finds a film to fly to, or a theme to light up. */
export default function MapSearch({ data, onFilm, onTheme }: MapSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo<Result[]>(() => [
    ...searchFilms(data, query, 6).map((index) => ({ kind: 'film' as const, index })),
    ...searchKeywords(data, query, 3).map((index) => ({ kind: 'theme' as const, index })),
  ], [data, query]);

  const choose = (result: Result) => {
    if (result.kind === 'film') onFilm(result.index);
    else onTheme(result.index);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    }
  };

  const firstTheme = results.findIndex((r) => r.kind === 'theme');

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#141414]/90 px-4 shadow-2xl backdrop-blur-xl focus-within:border-accent/50">
        <Search size={16} className="shrink-0 text-white/40" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Find a film or a theme — Alien, heist, time travel…"
          className="h-11 min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="map-search-results"
        />
        {query && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery('')} className="text-white/40 hover:text-white" aria-label="Clear">
            <X size={15} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div id="map-search-results" role="listbox" className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#141414]/95 p-1.5 shadow-2xl backdrop-blur-xl">
          {results.map((result, n) => (
            <React.Fragment key={`${result.kind}${result.index}`}>
              {n === firstTheme && (
                <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Themes</p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={n === active}
                // Pick before the input's blur closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(result)}
                onMouseEnter={() => setActive(n)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors ${n === active ? 'bg-white/[0.07]' : ''}`}
              >
                {result.kind === 'film' ? (
                  <>
                    <Image src={posterUrl(data, result.index, 'w92')} alt="" width={26} height={39} className="h-[39px] w-[26px] shrink-0 rounded bg-white/5 object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{data.titles[result.index]}</span>
                    <span className="text-[11px] text-white/40">{data.years[result.index]}</span>
                  </>
                ) : (
                  <>
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <Sparkles size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold capitalize text-white">{data.keywords[result.index]}</span>
                    <span className="text-[11px] text-white/40">{data.keywordFilms[result.index].toLocaleString()} films</span>
                  </>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
