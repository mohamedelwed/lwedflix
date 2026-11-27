import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Calendar, Clock, Star } from 'lucide-react-native';
import { colors, radius, space, type } from '@/theme';

/** Title, rating/runtime/year, genres and overview — the top of a title page. */
export default function TitleInfo({
  title,
  rating,
  runtime,
  year,
  extra,
  genres,
  overview,
  tagline,
  actions,
}: {
  title: string;
  rating?: number;
  runtime?: string;
  year?: string;
  extra?: string;
  genres?: { id: number; name: string }[];
  overview?: string;
  tagline?: string;
  actions?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {!!tagline && <Text style={styles.tagline}>{tagline}</Text>}
      <View style={styles.meta}>
        {!!rating && (
          <View style={styles.metaItem}>
            <Star size={14} color={colors.star} fill={colors.star} />
            <Text style={[styles.metaText, { color: colors.foreground }]}>{rating.toFixed(1)}</Text>
          </View>
        )}
        {!!runtime && (
          <View style={styles.metaItem}>
            <Clock size={14} color={colors.muted} />
            <Text style={styles.metaText}>{runtime}</Text>
          </View>
        )}
        {!!year && (
          <View style={styles.metaItem}>
            <Calendar size={14} color={colors.muted} />
            <Text style={styles.metaText}>{year}</Text>
          </View>
        )}
        {!!extra && <Text style={styles.metaText}>{extra}</Text>}
      </View>
      {actions && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions} style={styles.actionsScroll}>
          {actions}
        </ScrollView>
      )}
      {!!genres?.length && (
        <View style={styles.genres}>
          {genres.map((g) => (
            <Text key={g.id} style={styles.genre}>{g.name}</Text>
          ))}
        </View>
      )}
      {!!overview && <Text style={styles.overview}>{overview}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md },
  title: { ...type.h1, color: colors.foreground, fontSize: 28 },
  tagline: { color: colors.muted, fontStyle: 'italic', marginTop: -6 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  actionsScroll: { marginHorizontal: -space.lg },
  actions: { gap: space.sm, paddingHorizontal: space.lg },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  genre: { color: colors.white90, fontSize: 12, fontWeight: '500', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  overview: { ...type.body, color: colors.white70 },
});
