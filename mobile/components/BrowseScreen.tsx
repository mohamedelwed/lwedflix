import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { discoverContent, getGenres } from '@shared/lib/tmdb';
import MovieCard from './MovieCard';
import Chip from './Chip';
import TopBar from './TopBar';
import { ErrorState } from './States';
import { useAsync } from '@/lib/useAsync';
import type { MediaItem, MediaType } from '@/lib/media';
import { colors, space, type } from '@/theme';

const SORTS = [
  { label: 'Popular', value: 'popularity.desc' },
  { label: 'Top rated', value: 'vote_average.desc' },
  { label: 'Newest', value: 'primary_release_date.desc' },
];

/**
 * A catalogue with filters and endless scrolling — Movies, TV Shows and
 * Anime (src/app/movies, tv, anime with FilterBar and InfiniteScrollList).
 */
export default function BrowseScreen({
  title,
  subtitle,
  mediaType,
  baseFilters = {},
  hideGenres,
}: {
  title: string;
  subtitle: string;
  mediaType: MediaType;
  baseFilters?: Record<string, string>;
  hideGenres?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 5 : 3;
  const cardWidth = (width - space.lg * 2 - space.md * (columns - 1)) / columns;

  const genres = useAsync(hideGenres ? null : `genres:${mediaType}`, () => getGenres(mediaType));
  const [genre, setGenre] = useState<string>('');
  const [sort, setSort] = useState(SORTS[0].value);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);

  const sortParam = mediaType === 'tv' ? sort.replace('primary_release_date', 'first_air_date') : sort;

  const load = useCallback(
    async (nextPage: number) => {
      const id = ++request.current;
      setLoading(true);
      setError(false);
      try {
        const filters: Record<string, string> = { ...baseFilters, sort_by: sortParam, page: String(nextPage) };
        if (genre) filters.with_genres = [baseFilters.with_genres, genre].filter(Boolean).join(',');
        const data = await discoverContent(mediaType, filters);
        if (id !== request.current) return;
        const results = (data.results ?? []) as MediaItem[];
        setItems((prev) => {
          const merged = nextPage === 1 ? results : [...prev, ...results];
          const seen = new Set<number>();
          return merged.filter((item) => !seen.has(item.id) && seen.add(item.id));
        });
        setPage(nextPage);
        setDone(nextPage >= (data.total_pages ?? 1) || results.length === 0);
      } catch {
        if (id === request.current) setError(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaType, genre, sortParam, JSON.stringify(baseFilters)]
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    void load(1);
  }, [load]);

  const header = (
    <View style={{ paddingTop: insets.top + 64 }}>
      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SORTS.map((s) => (
          <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />
        ))}
      </ScrollView>
      {!hideGenres && genres.data?.genres && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All genres" active={!genre} onPress={() => setGenre('')} />
          {(genres.data.genres as { id: number; name: string }[]).map((g) => (
            <Chip key={g.id} label={g.name} active={genre === String(g.id)} onPress={() => setGenre(String(g.id))} />
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar />
      <FlatList
        key={columns}
        data={items}
        numColumns={columns}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: space.md, paddingHorizontal: space.lg }}
        contentContainerStyle={{ gap: space.lg, paddingBottom: insets.bottom + 100 }}
        renderItem={({ item }) => <MovieCard item={{ ...item, media_type: mediaType }} width={cardWidth} />}
        onEndReachedThreshold={1.5}
        onEndReached={() => !loading && !done && !error && void load(page + 1)}
        ListEmptyComponent={error ? <ErrorState onRetry={() => load(1)} /> : undefined}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xl }} /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: space.lg, marginBottom: space.lg },
  title: { ...type.h1, color: colors.foreground, fontSize: 30 },
  subtitle: { color: colors.muted, marginTop: 4 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
});
