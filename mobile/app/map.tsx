import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Image } from 'expo-image';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Play, Search, Star, X } from 'lucide-react-native';
import { genreNames, parseMovieMap, posterUrl, searchFilms, similarFilms, type MovieMapData, type MovieMapFile } from '@shared/lib/movieMap';
import { MAP_PAGE } from '@/map/canvasPage';
import type { WebViewRef } from '@/player/bridge';
import mapAsset from '@/assets/movie-map.mapdata';
import { colors, radius, space } from '@/theme';

let loading: Promise<MovieMapData> | null = null;
function loadMap(): Promise<MovieMapData> {
  loading ??= (async () => {
    const asset = Asset.fromModule(mapAsset);
    await asset.downloadAsync();
    const text = await new File(asset.localUri ?? asset.uri).text();
    return parseMovieMap(JSON.parse(text) as MovieMapFile);
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** 35,000 films on one map, similar films side by side (src/app/map). */
export default function MovieMapScreen() {
  const { film } = useLocalSearchParams<{ film?: string }>();
  const insets = useSafeAreaInsets();
  const web = useRef<WebViewRef>(null);
  const [data, setData] = useState<MovieMapData | null>(null);
  const [error, setError] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadMap().then(setData, () => setError(true));
  }, []);

  const run = (script: string) => web.current?.injectJavaScript(`${script};true;`);

  // The page gets what it draws once both are there.
  useEffect(() => {
    if (!data || !pageReady) return;
    const payload = {
      x: Array.from(data.x, (v) => Math.round(v)),
      y: Array.from(data.y, (v) => Math.round(v)),
      color: Array.from(data.color),
      votes: Array.from(data.votes),
      titles: data.titles,
      regions: data.regions,
    };
    run(`window.__map.load(${JSON.stringify(payload)})`);
  }, [data, pageReady]);

  const select = (i: number | null, focus = false) => {
    setSelected(i);
    if (!data) return;
    run(`window.__map.select(${i === null ? 'null' : i}, ${JSON.stringify(i === null ? [] : similarFilms(data, i))})`);
    if (focus && i !== null) run(`window.__map.focus(${i})`);
  };

  useEffect(() => {
    if (!mapReady || !data || !film) return;
    const i = data.indexById.get(Number(film));
    if (i !== undefined) select(i, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data, film]);

  const results = useMemo(() => (data && query.trim().length >= 2 ? searchFilms(data, query, 8) : []), [data, query]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(event.nativeEvent.data) as { t: string; i?: number | null };
      if (m.t === 'boot') setPageReady(true);
      else if (m.t === 'ready') setMapReady(true);
      else if (m.t === 'tap') {
        Keyboard.dismiss();
        select(m.i ?? null);
      }
    } catch {
      // Not ours.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <WebView
        ref={web as never}
        source={{ html: MAP_PAGE }}
        originWhitelist={['*']}
        onMessage={onMessage}
        style={{ flex: 1, backgroundColor: colors.background }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
      />

      {(!mapReady || !data) && (
        <View style={styles.center} pointerEvents="none">
          {error ? <Text style={styles.muted}>The map didn't load.</Text> : <ActivityIndicator color={colors.accent} />}
          {!error && <Text style={styles.muted}>Laying out 35,000 films…</Text>}
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.round} hitSlop={6} accessibilityLabel="Back">
          <X color="#fff" size={18} />
        </Pressable>
        <View style={styles.search}>
          <Search size={16} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find a film" placeholderTextColor={colors.muted} selectionColor={colors.accent} style={styles.input} autoCorrect={false} />
        </View>
        <Pressable onPress={() => run('window.__map.home()')} style={styles.round} hitSlop={6} accessibilityLabel="Whole map">
          <Home color="#fff" size={18} />
        </Pressable>
      </View>

      {results.length > 0 && data && (
        <View style={[styles.results, { top: insets.top + 64 }]}>
          {results.map((i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.white5 }]}
              onPress={() => {
                setQuery('');
                Keyboard.dismiss();
                select(i, true);
              }}
            >
              <Text style={styles.resultTitle} numberOfLines={1}>{data.titles[i]}</Text>
              <Text style={styles.muted}>{data.years[i] || ''}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected !== null && data && <FilmPanel data={data} i={selected} bottom={insets.bottom} onPick={(j) => select(j, true)} onClose={() => select(null)} />}
    </View>
  );
}

function FilmPanel({ data, i, bottom, onPick, onClose }: { data: MovieMapData; i: number; bottom: number; onPick: (i: number) => void; onClose: () => void }) {
  const similar = similarFilms(data, i);
  return (
    <View style={[styles.panel, { paddingBottom: bottom + space.md }]}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Image source={posterUrl(data, i, 'w185')} style={styles.poster} contentFit="cover" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.filmTitle} numberOfLines={2}>{data.titles[i]}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Star size={12} color={colors.star} fill={colors.star} />
            <Text style={styles.muted}>
              {(data.rating[i] / 10).toFixed(1)} · {data.years[i]}
            </Text>
          </View>
          <Text style={styles.muted} numberOfLines={1}>{genreNames(data, i).join(' · ')}</Text>
          <Pressable style={styles.open} onPress={() => router.push(`/movie/${data.ids[i]}`)}>
            <Play size={14} color="#000" fill="#000" />
            <Text style={styles.openText}>Open</Text>
          </Pressable>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <X color={colors.muted} size={18} />
        </Pressable>
      </View>
      <Text style={styles.similarHeading}>Similar films</Text>
      <FlatList
        horizontal
        data={similar}
        keyExtractor={(j) => String(j)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
        renderItem={({ item: j }) => (
          <Pressable onPress={() => onPick(j)} style={{ width: 72 }}>
            <Image source={posterUrl(data, j, 'w154')} style={styles.similarPoster} contentFit="cover" />
            <Text style={styles.similarTitle} numberOfLines={2}>{data.titles[j]}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  muted: { color: colors.muted, fontSize: 12 },
  top: { position: 'absolute', left: space.md, right: space.md, top: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(20,20,20,0.85)', borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, borderRadius: 21, paddingHorizontal: space.md, backgroundColor: 'rgba(20,20,20,0.85)', borderWidth: 1, borderColor: colors.hairline },
  input: { flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 0 },
  results: { position: 'absolute', left: space.md, right: space.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  result: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12 },
  resultTitle: { color: colors.foreground, fontWeight: '600', flex: 1 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.md, backgroundColor: 'rgba(20,20,20,0.96)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
  poster: { width: 70, height: 105, borderRadius: radius.sm, backgroundColor: colors.card },
  filmTitle: { color: colors.foreground, fontSize: 17, fontWeight: '800' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, marginTop: 4 },
  openText: { color: '#000', fontWeight: '800', fontSize: 13 },
  similarHeading: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  similarPoster: { width: 72, height: 108, borderRadius: radius.sm, backgroundColor: colors.card },
  similarTitle: { color: colors.white90, fontSize: 11, marginTop: 4 },
});
