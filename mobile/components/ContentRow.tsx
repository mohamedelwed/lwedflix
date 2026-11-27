import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import MovieCard from './MovieCard';
import { colors, space, type } from '@/theme';
import type { MediaItem } from '@/lib/media';

/** A titled, horizontally scrolling row of posters (src/components/ContentRow.tsx). */
export default function ContentRow({
  title,
  items,
  seeAll,
  progress,
}: {
  title: string;
  items: MediaItem[];
  seeAll?: Href;
  progress?: (item: MediaItem) => number | undefined;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {seeAll && (
          <Pressable onPress={() => router.push(seeAll)} hitSlop={10} style={styles.seeAll}>
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={14} color={colors.accent} />
          </Pressable>
        )}
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => `${item.media_type ?? ''}${item.id}`}
        renderItem={({ item }) => <MovieCard item={item} progress={progress?.(item)} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ width: space.md }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, marginBottom: space.md },
  title: { ...type.h2, color: colors.foreground },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { ...type.label, color: colors.accent, fontSize: 11 },
  list: { paddingHorizontal: space.lg },
});
