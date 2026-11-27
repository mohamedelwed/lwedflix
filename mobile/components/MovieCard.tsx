import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Star } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius } from '@/theme';
import { hrefFor, imageUrl, titleOf, typeOf, yearOf, type MediaItem } from '@/lib/media';

/** A poster card, as on desktop (src/components/MovieCard.tsx). */
export default function MovieCard({ item, width = 128, progress }: { item: MediaItem; width?: number; progress?: number }) {
  const rating = item.vote_average ?? 0;
  const poster = imageUrl(item.poster_path, 'w342');
  return (
    <PressableScale style={{ width }} onPress={() => router.push(hrefFor(item))} accessibilityRole="button" accessibilityLabel={titleOf(item)}>
      <View style={[styles.poster, { width, height: width * 1.5 }]}>
        {poster ? (
          <Image source={poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={String(item.id)} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noPoster]}>
            <Text style={styles.noPosterText} numberOfLines={3}>{titleOf(item)}</Text>
          </View>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.5 }} end={{ x: 0, y: 1 }} />
        {rating > 0 && (
          <View style={styles.badge}>
            <Star size={10} color={colors.star} fill={colors.star} />
            <Text style={styles.badgeText}>{rating.toFixed(1)}</Text>
          </View>
        )}
        {progress !== undefined && progress > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>{titleOf(item)}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{typeOf(item) === 'movie' ? 'Movie' : 'TV Series'}</Text>
        {!!yearOf(item) && <Text style={styles.dot}>•</Text>}
        {!!yearOf(item) && <Text style={styles.metaText}>{yearOf(item)}</Text>}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  poster: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card },
  noPoster: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  noPosterText: { color: colors.muted, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: { color: colors.foreground, fontSize: 11, fontWeight: '700' },
  progressTrack: { position: 'absolute', left: 8, right: 8, bottom: 8, height: 3, borderRadius: 2, backgroundColor: colors.white20 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  title: { color: colors.white90, fontSize: 13, fontWeight: '600', marginTop: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  metaText: { color: colors.muted, fontSize: 11 },
  dot: { color: colors.white20, fontSize: 11 },
});
