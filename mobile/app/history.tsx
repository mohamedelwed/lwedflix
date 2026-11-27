import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { supabase } from '@shared/lib/supabase';
import { timeAgo } from '@shared/lib/posts';
import RequireAuth from '@/components/RequireAuth';
import { EmptyState } from '@/components/States';
import { useAuth } from '@/lib/auth';
import { imageUrl } from '@/lib/media';
import { colors, radius, space } from '@/theme';

interface Row {
  id: string;
  movie_id: string;
  type: 'movie' | 'tv';
  title: string;
  poster_path: string | null;
  season: number | null;
  episode: number | null;
  watched_at: string;
}

/** Everything watched, on any device, newest first (src/app/history/page.tsx). */
export default function HistoryScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'History' }} />
      <RequireAuth what="history">
        <History />
      </RequireAuth>
    </>
  );
}

function History() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from('watch_history')
      .select('id, movie_id, type, title, poster_path, season, episode, watched_at')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      });
  }, [user]);
  useFocusEffect(load);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          onPress={() =>
            router.push(item.type === 'tv' && item.season ? `/tv/${item.movie_id}?season=${item.season}&episode=${item.episode ?? 1}` : `/${item.type}/${item.movie_id}`)
          }
        >
          <View style={styles.poster}>{item.poster_path && <Image source={imageUrl(item.poster_path, 'w185')} style={StyleSheet.absoluteFill} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.type === 'tv' && item.season ? `S${item.season} · E${item.episode} · ` : ''}
              {timeAgo(item.watched_at)}
            </Text>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={loading ? undefined : <EmptyState title="No history yet" text="What you watch shows up here — from your phone and your computer." />}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5 },
  poster: { width: 46, height: 69, borderRadius: radius.sm, backgroundColor: colors.card, overflow: 'hidden' },
  title: { color: colors.foreground, fontWeight: '700', fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
