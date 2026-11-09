'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, Minus, Plus, Tags } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { NO_FILTER, filterFilms, loadMovieMap, type MapFilter, type MovieMapData } from '@/lib/movieMap';
import MapCanvas, { type MapCanvasHandle } from './MapCanvas';
import MapSearch from './MapSearch';
import MapFilters from './MapFilters';
import FilmPanel, { PANEL_WIDTH } from './FilmPanel';

/** Films the viewer has saved or watched, as indices on the map. */
async function loadMine(data: MovieMapData, userId: string): Promise<Set<number>> {
  const [list, history] = await Promise.all([
    supabase.from('watch_list').select('movie_id').eq('user_id', userId).eq('type', 'movie'),
    supabase.from('watch_history').select('movie_id').eq('user_id', userId).eq('type', 'movie'),
  ]);
  const mine = new Set<number>();
  for (const row of [...(list.data ?? []), ...(history.data ?? [])]) {
    const i = data.indexById.get(Number(row.movie_id));
    if (i !== undefined) mine.add(i);
  }
  return mine;
}

/**
 * Every well-known film on one map, similar films side by side. Search
 * flies to a film or lights up a theme; filters dim everything else.
 */
export default function MovieMap({ initialFilmId }: { initialFilmId: number | null }) {
  const { user } = useAuth();
  const [data, setData] = useState<MovieMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MapFilter>(NO_FILTER);
  const [selected, setSelected] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState<{ userId: string; films: Set<number> } | null>(null);
  const [initialFilm, setInitialFilm] = useState<number | null>(null);
  const map = useRef<MapCanvasHandle>(null);
  const controls = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const avoid = useMemo(() => [controls, hint], []);

  useEffect(() => {
    let cancelled = false;
    loadMovieMap()
      .then((d) => {
        if (cancelled) return;
        const film = initialFilmId !== null ? d.indexById.get(initialFilmId) ?? null : null;
        if (initialFilmId !== null && film === null) {
          setNotice(`That film isn't on the map: it shows films with at least 50 votes on TMDB.`);
        }
        setInitialFilm(film);
        setSelected(film);
        setData(d);
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [initialFilmId]);

  useEffect(() => {
    if (!data || !user) return;
    let cancelled = false;
    loadMine(data, user.id)
      .then((films) => { if (!cancelled) setMine({ userId: user.id, films }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data, user]);
  const myFilms = user && mine?.userId === user.id ? mine.films : null;
  // Signing out drops the "my films" filter with the list it came from.
  const activeFilter = useMemo(() => (filter.only && filter.only !== myFilms ? { ...filter, only: null } : filter), [filter, myFilms]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const matches = useMemo(() => (data ? filterFilms(data, activeFilter) : null), [data, activeFilter]);
  const matching = useMemo(() => (matches ? matches.reduce((n, v) => n + v, 0) : null), [matches]);

  const goTo = useCallback((film: number) => {
    setSelected(film);
    setHighlighted(null);
    map.current?.flyTo(film);
  }, []);

  const onCanvasSelect = useCallback((film: number | null) => {
    setSelected(film);
    setHighlighted(null);
  }, []);

  const addTheme = (keyword: number) => {
    setFilter((f) => (f.keywords.includes(keyword) ? f : { ...f, keywords: [...f.keywords, keyword] }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'l' || e.key === 'L') setLabels((v) => !v);
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key === '+' || e.key === '=') map.current?.zoomBy(1.8);
      else if (e.key === '-') map.current?.zoomBy(1 / 1.8);
      else if (e.key === '0') map.current?.fit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const panelOpen = data !== null && selected !== null;

  return (
    <div className="fixed bottom-0 left-[232px] right-0 top-14 overflow-hidden bg-[radial-gradient(ellipse_at_center,#141210_0%,#0a0a0a_70%)]">
      {data ? (
        <MapCanvas
          ref={map}
          data={data}
          matches={matches}
          selected={selected}
          highlighted={highlighted}
          labels={labels}
          rightInset={panelOpen ? PANEL_WIDTH + 16 : 0}
          initialFilm={initialFilm}
          topInset={150}
          avoid={avoid}
          onSelect={onCanvasSelect}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          {error ? (
            <>
              <p className="text-sm font-semibold text-white">The movie map didn&apos;t load.</p>
              <p className="text-xs text-white/40">{error}</p>
            </>
          ) : (
            <>
              <Loader2 className="animate-spin text-accent" size={24} />
              <p className="text-xs text-white/40">Laying out the films…</p>
            </>
          )}
        </div>
      )}

      {data && (
        <>
          <div
            ref={controls}
            className="absolute left-5 top-4 z-30 space-y-2.5"
            style={{ width: `min(440px, calc(100% - ${panelOpen ? PANEL_WIDTH + 56 : 40}px))` }}
          >
            <MapSearch data={data} onFilm={goTo} onTheme={addTheme} />
            <MapFilters data={data} filter={activeFilter} onChange={setFilter} matching={matching} mine={myFilms} />
          </div>

          {panelOpen && (
            <FilmPanel
              data={data}
              film={selected}
              onSelect={goTo}
              onHighlight={setHighlighted}
              onClose={() => setSelected(null)}
            />
          )}

          <div ref={hint} className="pointer-events-none absolute bottom-4 left-5 z-20 space-y-1 text-[11px] text-white/35">
            <p>Scroll to zoom · Drag to move · Click a film · <kbd className="font-sans">L</kbd> {labels ? 'hides' : 'shows'} labels</p>
            <p>
              {data.count.toLocaleString()} films with 50+ votes on TMDB, placed by genre, themes, cast, crew and era · {data.generated}
            </p>
          </div>

          <div className="absolute bottom-4 z-20 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141414]/90 backdrop-blur-xl" style={{ right: panelOpen ? PANEL_WIDTH + 32 : 20 }}>
            <MapButton label="Zoom in" onClick={() => map.current?.zoomBy(1.8)}><Plus size={15} /></MapButton>
            <MapButton label="Zoom out" onClick={() => map.current?.zoomBy(1 / 1.8)}><Minus size={15} /></MapButton>
            <MapButton label="Whole map" onClick={() => map.current?.fit()}><Maximize2 size={15} /></MapButton>
            <MapButton label={labels ? 'Hide labels' : 'Show labels'} onClick={() => setLabels((v) => !v)}><Tags size={15} /></MapButton>
          </div>
        </>
      )}

      {notice && (
        <div className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#141414]/95 px-4 py-2.5 text-[12px] text-white/80 shadow-2xl backdrop-blur-xl">
          {notice}
        </div>
      )}
    </div>
  );
}

const MapButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} title={label} aria-label={label} className="flex h-9 w-9 items-center justify-center text-white/60 transition-colors hover:bg-white/5 hover:text-white">
    {children}
  </button>
);
