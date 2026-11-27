import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { countByStatus, getMyWatchlist, WATCH_STATUSES, type WatchlistItem, type WatchStatus } from '@shared/lib/watchlist';
import MovieCard from '@/components/MovieCard';
import Chip from '@/components/Chip';
import RequireAuth from '@/components/RequireAuth';
import { EmptyState } from '@/components/States';
import { colors, space } from '@/theme';

/** Your watchlist by status (src/app/watchlist/page.tsx). */
export default function WatchlistScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Watchlist' }} />
      <RequireAuth what="watchlist">
        <Watchlist />
      </RequireAuth>
    </>
  );
}

function Watchlist() {
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [status, setStatus] = useState<WatchStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const columns = width >= 700 ? 5 : 3;
  const cardWidth = (width - space.lg * 2 - space.md * (columns - 1)) / columns;

  const load = useCallback(() => {
    setLoading(true);
    getMyWatchlist()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  const counts = countByStatus(items);
  const shown = status === 'all' ? items : items.filter((i) => i.status === status);

  return (
    <FlatList
      key={columns}
      style={{ backgroundColor: colors.background }}
      data={shown}
      numColumns={columns}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      ListHeaderComponent={
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <Chip label={`All · ${counts.all}`} active={status === 'all'} onPress={() => setStatus('all')} />
          {WATCH_STATUSES.map((s) => (
            <Chip key={s.id} label={`${s.label} · ${counts[s.id]}`} active={status === s.id} onPress={() => setStatus(s.id)} />
          ))}
        </ScrollView>
      }
      columnWrapperStyle={shown.length ? { gap: space.md, paddingHorizontal: space.lg } : undefined}
      contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}
      renderItem={({ item }) => (
        <MovieCard
          width={cardWidth}
          item={{ id: Number(item.movie_id), title: item.type === 'movie' ? item.title : undefined, name: item.type === 'tv' ? item.title : undefined, poster_path: item.poster_path, media_type: item.type, vote_average: item.rating ?? undefined }}
        />
      )}
      ListEmptyComponent={loading ? <View /> : <EmptyState title="Nothing here yet" text="Tap Watchlist on any title to save it for later." />}
    />
  );
}

