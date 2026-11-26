import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@shared/lib/supabase';
import type { WatchStatus } from '@shared/lib/watchlist';
import { useAuth } from './auth';

// The signed-in user's watchlist, loaded once and shared by every button
// (src/components/WatchlistProvider.tsx).

interface Entry {
  rowId: string;
  status: WatchStatus;
}

interface WatchlistContextType {
  entries: Map<string, Entry>;
  save: (item: { id: number; type: 'movie' | 'tv'; title: string; posterPath?: string | null }, status: WatchStatus) => Promise<void>;
  remove: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextType>({
  entries: new Map(),
  save: async () => {},
  remove: async () => {},
  refresh: async () => {},
});

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());

  const refresh = useCallback(async () => {
    if (!user) {
      setEntries(new Map());
      return;
    }
    const { data } = await supabase.from('watch_list').select('id, movie_id, status').eq('user_id', user.id);
    const next = new Map<string, Entry>();
    for (const r of data ?? []) next.set(String(r.movie_id), { rowId: String(r.id), status: (r.status ?? 'plan') as WatchStatus });
    setEntries(next);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback<WatchlistContextType['save']>(
    async (item, status) => {
      if (!user) throw new Error('Not signed in');
      const key = String(item.id);
      const existing = entries.get(key);
      if (existing) {
        await supabase.from('watch_list').update({ status }).eq('id', existing.rowId).eq('user_id', user.id);
        setEntries((prev) => new Map(prev).set(key, { ...existing, status }));
        return;
      }
      const { data, error } = await supabase
        .from('watch_list')
        .insert({ user_id: user.id, movie_id: key, type: item.type, title: item.title, poster_path: item.posterPath ?? null, status })
        .select('id')
        .single();
      if (error) throw error;
      setEntries((prev) => new Map(prev).set(key, { rowId: String(data.id), status }));
    },
    [entries, user]
  );

  const remove = useCallback<WatchlistContextType['remove']>(
    async (id) => {
      const key = String(id);
      const existing = entries.get(key);
      if (!existing || !user) return;
      setEntries((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      const { error } = await supabase.from('watch_list').delete().eq('id', existing.rowId).eq('user_id', user.id);
      if (error) setEntries((prev) => new Map(prev).set(key, existing));
    },
    [entries, user]
  );

  const value = useMemo(() => ({ entries, save, remove, refresh }), [entries, save, remove, refresh]);
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export const useWatchlist = () => useContext(WatchlistContext);
