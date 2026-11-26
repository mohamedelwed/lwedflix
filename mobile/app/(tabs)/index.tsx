import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAnimeMix, getNowPlaying, getPopular, getTrending } from '@shared/lib/tmdb';
import Hero from '@/components/Hero';
import ContentRow from '@/components/ContentRow';
import ContinueWatching from '@/components/ContinueWatching';
import TopBar from '@/components/TopBar';
import { ErrorState, Loading } from '@/components/States';
import { useAsync } from '@/lib/useAsync';
import type { MediaItem } from '@/lib/media';
import { colors } from '@/theme';

// The desktop home page (src/app/page.tsx), row for row.
async function loadHome() {
  const [trending, popularMovies, popularTV, newestMovies, newestTV, anime] = await Promise.all([
    getTrending('all'),
    getPopular('movie'),
    getPopular('tv'),
    getNowPlaying('movie'),
    getNowPlaying('tv'),
    getAnimeMix(),
  ]);
  const t = trending.results as MediaItem[];
  return {
    hero: [...t.slice(0, 3), popularMovies.results[0], popularTV.results[0]].filter(Boolean) as MediaItem[],
    trending: t.slice(1),
    suggestions: t.slice(10),
    popularMovies: popularMovies.results as MediaItem[],
    popularTV: popularTV.results as MediaItem[],
    newestMovies: newestMovies.results as MediaItem[],
    newestTV: newestTV.results as MediaItem[],
    anime: anime.results as MediaItem[],
  };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { data, error, loading, reload } = useAsync('home', loadHome);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar transparent />
      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorState onRetry={reload} />
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} progressViewOffset={insets.top + 40} />}
        >
          <Hero items={data.hero} />
          <ContinueWatching />
          <ContentRow title="Trending Now" items={data.trending} />
          <ContentRow title="Most Watched Movies" items={data.popularMovies} seeAll="/movies" />
          <ContentRow title="Anime Hits" items={data.anime} seeAll="/anime" />
          <ContentRow title="Most Watched TV Shows" items={data.popularTV} seeAll="/tv" />
          <ContentRow title="Newest Movie Releases" items={data.newestMovies} seeAll="/movies" />
          <ContentRow title="Newest TV Series" items={data.newestTV} seeAll="/tv" />
          <ContentRow title="Suggestions For You" items={data.suggestions} />
        </ScrollView>
      ) : null}
    </View>
  );
}
