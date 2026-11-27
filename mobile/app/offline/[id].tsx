import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, SkipForward } from 'lucide-react-native';
import { getMovieResume, setMovieProgress } from '@shared/lib/movieProgress';
import { getEpisodePositions, markEpisodeWatched, setEpisodePosition, setLastPosition, syncShowProgress } from '@shared/lib/episodeProgress';
import { recordWatch } from '@shared/lib/watchHistory';
import { EmptyState } from '@/components/States';
import { getDownloads, useDownloadsList } from '@/downloads/store';
import { useAuth } from '@/lib/auth';
import { colors, radius, space } from '@/theme';

/**
 * A downloaded movie or episode, played from the phone — no connection
 * needed (src/components/downloads/OfflinePlayer.tsx). Resume and progress
 * work as when streaming, and sync once the phone is back online.
 */
export default function OfflinePlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  useKeepAwake();
  const item = useDownloadsList().find((d) => d.id === id);

  const startAt =
    item?.mediaId == null
      ? undefined
      : item.mediaType === 'movie'
        ? getMovieResume(item.mediaId)
        : getEpisodePositions(item.mediaId)[`${item.season}-${item.episode}`]?.watched;

  const player = useVideoPlayer(item?.fileUri ?? null, (p) => {
    p.timeUpdateEventInterval = 1;
    if (startAt) p.currentTime = startAt;
    p.play();
  });

  // The next downloaded episode of the same show.
  const next =
    item?.mediaType === 'tv'
      ? getDownloads()
          .filter((d) => d.state === 'done' && d.mediaType === 'tv' && d.mediaId === item.mediaId)
          .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
          .find((d) => (d.season ?? 0) > (item.season ?? 0) || ((d.season ?? 0) === (item.season ?? 0) && (d.episode ?? 0) > (item.episode ?? 0)))
      : undefined;

  useEffect(() => {
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).then(() => ScreenOrientation.unlockAsync());
    };
  }, []);

  const recorded = useRef(false);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!item || item.mediaId == null) return;
    const duration = player.duration;
    if (!(duration > 0)) return;
    if (item.mediaType === 'movie') setMovieProgress(item.mediaId, currentTime, duration);
    else if (setEpisodePosition(item.mediaId, item.season ?? 1, item.episode ?? 1, currentTime, duration)) syncShowProgress(item.mediaId);
    if (!recorded.current && currentTime > 10 && user) {
      recorded.current = true;
      if (item.mediaType === 'tv') setLastPosition(item.mediaId, item.season ?? 1, item.episode ?? 1);
      void recordWatch({
        user_id: user.id,
        movie_id: String(item.mediaId),
        type: item.mediaType,
        title: item.mediaType === 'tv' ? item.showTitle ?? item.title : item.title,
        poster_path: item.posterPath,
        season: item.mediaType === 'tv' ? item.season : null,
        episode: item.mediaType === 'tv' ? item.episode : null,
        watched_at: new Date().toISOString(),
      });
    }
  });

  useEventListener(player, 'playToEnd', () => {
    if (item?.mediaType === 'tv' && item.mediaId != null) {
      markEpisodeWatched(item.mediaId, item.season ?? 1, item.episode ?? 1);
      syncShowProgress(item.mediaId);
    }
    if (next) router.replace(`/offline/${next.id}`);
  });

  if (!item || item.state !== 'done' || !item.fileUri) {
    return <EmptyState title="This download isn't here" text="It may have been deleted." action={{ label: 'Back', onPress: () => router.back() }} />;
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
      />
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.button} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft color="#fff" size={22} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{item.mediaType === 'tv' ? item.showTitle ?? item.title : item.title}</Text>
          {item.mediaType === 'tv' && (
            <Text style={styles.subtitle} numberOfLines={1}>
              S{item.season} · E{item.episode}
              {item.episodeTitle ? ` · ${item.episodeTitle}` : ''}
            </Text>
          )}
        </View>
        {next && (
          <Pressable onPress={() => router.replace(`/offline/${next.id}`)} style={styles.next}>
            <SkipForward color="#fff" size={14} fill="#fff" />
            <Text style={styles.nextText}>Next</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  subtitle: { color: colors.white70, fontSize: 12 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderColor: colors.white20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full },
  nextText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
