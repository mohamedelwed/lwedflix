import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getPersonDetails } from '@shared/lib/tmdb';
import MovieCard from '@/components/MovieCard';
import { ErrorState, Loading } from '@/components/States';
import { useAsync } from '@/lib/useAsync';
import { imageUrl, type MediaItem } from '@/lib/media';
import { colors, radius, space, type } from '@/theme';

interface PersonDetails {
  name: string;
  biography?: string;
  profile_path?: string | null;
  birthday?: string | null;
  place_of_birth?: string | null;
  known_for_department?: string;
  combined_credits?: { cast: MediaItem[]; crew: (MediaItem & { job?: string })[] };
}

/** An actor's or director's films and shows (src/app/person/[id]/page.tsx). */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const { data, error, reload } = useAsync<PersonDetails>(`person:${id}`, () => getPersonDetails(id));
  if (error && !data) return <ErrorState onRetry={reload} />;
  if (!data) return <Loading />;

  const seen = new Set<string>();
  const credits = [...(data.combined_credits?.cast ?? []), ...(data.combined_credits?.crew ?? [])]
    .filter((c) => (c.media_type === 'movie' || c.media_type === 'tv') && c.poster_path)
    .filter((c) => {
      const key = `${c.media_type}${c.id}`;
      return !seen.has(key) && !!seen.add(key);
    })
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const columns = width >= 700 ? 5 : 3;
  const cardWidth = (width - space.lg * 2 - space.md * (columns - 1)) / columns;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: data.name }} />
      <View style={styles.head}>
        <View style={styles.photo}>{data.profile_path && <Image source={imageUrl(data.profile_path, 'w342')} style={StyleSheet.absoluteFill} contentFit="cover" />}</View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.name}>{data.name}</Text>
          {!!data.known_for_department && <Text style={styles.meta}>{data.known_for_department}</Text>}
          {!!data.birthday && <Text style={styles.meta}>Born {data.birthday}{data.place_of_birth ? ` · ${data.place_of_birth}` : ''}</Text>}
        </View>
      </View>
      {!!data.biography && <Text style={styles.bio} numberOfLines={8}>{data.biography}</Text>}
      <Text style={styles.heading}>Known for</Text>
      <View style={styles.grid}>
        {credits.map((c) => (
          <MovieCard key={`${c.media_type}${c.id}`} item={c} width={cardWidth} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'center' },
  photo: { width: 110, height: 150, borderRadius: radius.lg, backgroundColor: colors.card, overflow: 'hidden' },
  name: { ...type.h1, color: colors.foreground },
  meta: { color: colors.muted, fontSize: 13 },
  bio: { color: colors.white70, paddingHorizontal: space.lg, lineHeight: 21, fontSize: 14 },
  heading: { ...type.h2, color: colors.foreground, padding: space.lg, paddingBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.lg },
});
