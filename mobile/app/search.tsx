import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import Avatar from '@/components/Avatar';
import { searchTMDB } from '@shared/lib/tmdb';
import { searchUsers, type PublicProfile } from '@shared/lib/friends';
import MovieCard from '@/components/MovieCard';
import { EmptyState, Loading } from '@/components/States';
import { imageUrl, type MediaItem } from '@/lib/media';
import { useAuth } from '@/lib/auth';
import { colors, radius, space } from '@/theme';

interface PersonResult {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string;
  media_type: 'person';
}

/** Titles, people and (signed in) other users (src/app/search/page.tsx). */
export default function SearchScreen() {
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [titles, setTitles] = useState<MediaItem[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [users, setUsers] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const columns = width >= 700 ? 5 : 3;
  const cardWidth = (width - space.lg * 2 - space.md * (columns - 1)) / columns;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTitles([]);
      setPeople([]);
      setUsers([]);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const [tmdb, found] = await Promise.all([searchTMDB(q), user ? searchUsers(q).catch(() => []) : Promise.resolve([])]);
        if (!live) return;
        const results = (tmdb.results ?? []) as (MediaItem | PersonResult)[];
        setTitles(results.filter((r): r is MediaItem => r.media_type === 'movie' || r.media_type === 'tv'));
        setPeople(results.filter((r): r is PersonResult => r.media_type === 'person').slice(0, 12));
        setUsers(found);
      } catch {
        // Keep what was there.
      } finally {
        if (live) setLoading(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, user]);

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      {users.length > 0 && (
        <Section title="People on Lwedflix">
          <FlatList
            horizontal
            data={users}
            keyExtractor={(u) => u.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}
            renderItem={({ item }) => (
              <Pressable style={styles.person} onPress={() => router.push(`/u/${item.username}`)}>
                <Avatar uri={item.avatar_url} size={64} />
                <Text style={styles.personName} numberOfLines={1}>{item.display_name || item.username}</Text>
                <Text style={styles.personRole} numberOfLines={1}>@{item.username}</Text>
              </Pressable>
            )}
          />
        </Section>
      )}
      {people.length > 0 && (
        <Section title="Cast & crew">
          <FlatList
            horizontal
            data={people}
            keyExtractor={(p) => String(p.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}
            renderItem={({ item }) => (
              <Pressable style={styles.person} onPress={() => router.push(`/person/${item.id}`)}>
                <Avatar uri={imageUrl(item.profile_path, 'w185')} size={64} />
                <Text style={styles.personName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.personRole} numberOfLines={1}>{item.known_for_department}</Text>
              </Pressable>
            )}
          />
        </Section>
      )}
      {titles.length > 0 && <Text style={[styles.sectionTitle, { paddingHorizontal: space.lg }]}>Movies & shows</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.searchBox}>
              <Search size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder="Movies, shows, people…"
                placeholderTextColor={colors.muted}
                selectionColor={colors.accent}
                style={styles.input}
                returnKeyType="search"
                autoCorrect={false}
              />
              {!!query && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <X size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      {loading && !titles.length && !people.length ? (
        <Loading />
      ) : query.trim().length < 2 ? (
        <EmptyState title="Search Lwedflix" text="Find movies, TV shows, anime, actors and directors." />
      ) : (
        <FlatList
          key={columns}
          data={titles}
          numColumns={columns}
          keyExtractor={(item) => `${item.media_type}${item.id}`}
          ListHeaderComponent={header}
          columnWrapperStyle={titles.length ? { gap: space.md, paddingHorizontal: space.lg } : undefined}
          contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl, paddingTop: space.md }}
          renderItem={({ item }) => <MovieCard item={item} width={cardWidth} />}
          ListEmptyComponent={!people.length && !users.length && !loading ? <EmptyState title="Nothing found" text={`No results for “${query.trim()}”.`} /> : undefined}
          keyboardDismissMode="on-drag"
        />
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Text style={[styles.sectionTitle, { paddingHorizontal: space.lg }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.white5, borderColor: colors.hairline, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space.md, height: 40, width: '92%' },
  input: { flex: 1, color: colors.foreground, fontSize: 16, paddingVertical: 0 },
  sectionTitle: { color: colors.foreground, fontSize: 18, fontWeight: '700' },
  person: { width: 80, alignItems: 'center', gap: 4 },
  personName: { color: colors.foreground, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  personRole: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
