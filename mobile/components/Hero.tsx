import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Info, Play, Star } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, space, type } from '@/theme';
import { hrefFor, imageUrl, titleOf, typeOf, yearOf, type MediaItem } from '@/lib/media';

/** The featured carousel at the top of Home (src/components/HeroSection.tsx). */
export default function Hero({ items }: { items: MediaItem[] }) {
  const { width, height } = useWindowDimensions();
  const heroHeight = Math.min(Math.max(height * 0.68, 460), 640);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<MediaItem>>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      if (touched.current) return;
      setIndex((i) => {
        const next = (i + 1) % items.length;
        list.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!items.length) return null;
  return (
    <View style={{ height: heroHeight }}>
      <FlatList
        ref={list}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => (touched.current = true)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Slide item={item} width={width} height={heroHeight} />}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((item, i) => (
          <View key={item.id} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

function Slide({ item, width, height }: { item: MediaItem; width: number; height: number }) {
  const backdrop = imageUrl(item.backdrop_path, 'w1280') ?? imageUrl(item.poster_path, 'w780');
  return (
    <View style={{ width, height }}>
      {backdrop && <Image source={backdrop} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="cover" transition={400} />}
      <LinearGradient colors={['rgba(10,10,10,0.7)', 'transparent', 'rgba(10,10,10,0.4)', colors.background]} locations={[0, 0.3, 0.6, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.copy}>
        <View style={styles.tags}>
          <View style={styles.featured}>
            <Text style={styles.featuredText}>Featured</Text>
          </View>
          {!!item.vote_average && (
            <View style={styles.tagRow}>
              <Star size={13} color={colors.star} fill={colors.star} />
              <Text style={styles.tagText}>{item.vote_average.toFixed(1)}</Text>
            </View>
          )}
          {!!yearOf(item) && <Text style={styles.tagDim}>{yearOf(item)}</Text>}
          <Text style={styles.kind}>{typeOf(item)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{titleOf(item)}</Text>
        {!!item.overview && <Text style={styles.overview} numberOfLines={3}>{item.overview}</Text>}
        <View style={styles.buttons}>
          <PressableScale style={styles.play} onPress={() => router.push(`${hrefFor(item)}?play=1`)}>
            <Play size={18} color="#000" fill="#000" />
            <Text style={styles.playText}>Watch Now</Text>
          </PressableScale>
          <PressableScale style={styles.info} onPress={() => router.push(hrefFor(item))}>
            <Info size={18} color={colors.foreground} />
            <Text style={styles.infoText}>More Info</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.xxl + 8, gap: space.md },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  featured: { backgroundColor: colors.accent, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  featuredText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { color: colors.white90, fontSize: 13, fontWeight: '600' },
  tagDim: { color: colors.white60, fontSize: 13 },
  kind: { color: colors.white60, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', backgroundColor: colors.white10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  title: { ...type.hero, color: colors.foreground, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 },
  overview: { color: colors.white70, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  play: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingHorizontal: 22, paddingVertical: 13, borderRadius: radius.full },
  playText: { color: '#000', fontWeight: '700', fontSize: 15 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white10, borderColor: colors.white20, borderWidth: 1, paddingHorizontal: 22, paddingVertical: 13, borderRadius: radius.full },
  infoText: { color: colors.foreground, fontWeight: '700', fontSize: 15 },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white20 },
  dotActive: { width: 24, backgroundColor: colors.accent },
});
