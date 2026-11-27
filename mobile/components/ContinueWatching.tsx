import React, { useEffect, useState } from 'react';
import { supabase } from '@shared/lib/supabase';
import { getShowProgress } from '@shared/lib/episodeProgress';
import { getMovieFraction } from '@shared/lib/movieProgress';
import ContentRow from './ContentRow';
import { useAuth } from '@/lib/auth';
import type { MediaItem } from '@/lib/media';

interface HistoryRow {
  movie_id: string;
  type: 'movie' | 'tv';
  title: string;
  poster_path: string | null;
  season: number | null;
  episode: number | null;
}

/** Picks up where you left off — on any device (src/components/ContinueWatching.tsx). */
export default function ContinueWatching() {
  const { user } = useAuth();
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    if (!user) {
      setRows([]);
      return;
    }
    let live = true;
    supabase
      .from('watch_history')
      .select('movie_id, type, title, poster_path, season, episode')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(12)
      .then(({ data }) => live && setRows((data ?? []) as HistoryRow[]));
    return () => {
      live = false;
    };
  }, [user]);

  const items: (MediaItem & { row: HistoryRow })[] = rows.map((r) => ({
    id: Number(r.movie_id),
    title: r.type === 'movie' ? r.title : undefined,
    name: r.type === 'tv' ? r.title : undefined,
    poster_path: r.poster_path,
    media_type: r.type,
    row: r,
  }));

  const progress = (item: MediaItem) => {
    const r = (item as MediaItem & { row: HistoryRow }).row;
    if (r.type === 'movie') return getMovieFraction(r.movie_id);
    if (r.season == null || r.episode == null) return undefined;
    const pos = getShowProgress(r.movie_id).positions[`${r.season}-${r.episode}`];
    return pos && pos.duration > 0 ? pos.watched / pos.duration : undefined;
  };

  return <ContentRow title="Continue Watching" items={items} seeAll="/history" progress={progress} />;
}
