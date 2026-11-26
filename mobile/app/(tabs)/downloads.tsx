import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Download as DownloadIcon, Pause, Play, RotateCw, Trash2, X } from 'lucide-react-native';
import { formatBytes, formatDuration, formatEta } from '@shared/lib/downloads';
import { getMovieFraction } from '@shared/lib/movieProgress';
import { getShowProgress } from '@shared/lib/episodeProgress';
import TopBar from '@/components/TopBar';
import Chip from '@/components/Chip';
import { EmptyState } from '@/components/States';
import { cancelDownload, pauseDownload, removeDownload, resumeDownload, retryDownload } from '@/downloads/engine';
import { isActive, useDownloadsList, type StoredDownload } from '@/downloads/store';
import { imageUrl } from '@/lib/media';
import { colors, radius, space, type } from '@/theme';

type Filter = 'all' | 'movie' | 'tv' | 'active';

/** Everything saved on this phone, playable offline (src/components/downloads/DownloadsLibrary.tsx). */
export default function DownloadsScreen() {
  const insets = useSafeAreaInsets();
  const downloads = useDownloadsList();
  const [filter, setFilter] = useState<Filter>('all');

  const shown = downloads.filter((d) => (filter === 'all' ? true : filter === 'active' ? isActive(d) : d.mediaType === filter && d.state === 'done'));
  const used = downloads.filter((d) => d.state === 'done').reduce((s, d) => s + (d.bytes || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar />
      <FlatList
        data={shown}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 100, gap: space.sm }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: space.lg, gap: space.md, marginBottom: space.md }}>
            <View>
              <Text style={styles.title}>Downloads</Text>
              <Text style={styles.subtitle}>Watch without a connection{used ? ` · ${formatBytes(used)} used` : ''}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {(['all', 'movie', 'tv', 'active'] as Filter[]).map((f) => (
                <Chip key={f} label={f === 'all' ? 'All' : f === 'movie' ? 'Movies' : f === 'tv' ? 'Episodes' : 'In progress'} active={filter === f} onPress={() => setFilter(f)} />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={filter === 'active' ? 'Nothing downloading' : 'No downloads yet'}
            text="Play a movie or an episode and tap Download under the title — or download a whole season from a show's episode list."
          />
        }
        renderItem={({ item }) => <Row d={item} />}
      />
    </View>
  );
}

function Row({ d }: { d: StoredDownload }) {
  const poster = d.posterUri ?? imageUrl(d.posterPath, 'w185');
  const done = d.state === 'done';
  const watched =
    d.mediaId == null
      ? undefined
      : d.mediaType === 'movie'
        ? getMovieFraction(d.mediaId)
        : (() => {
            const pos = getShowProgress(d.mediaId).positions[`${d.season}-${d.episode}`];
            return pos && pos.duration > 0 ? pos.watched / pos.duration : undefined;
          })();

  const status =
    d.state === 'downloading'
      ? `${Math.round(d.progress * 100)}% · ${formatBytes(d.speed)}/s${d.eta ? ` · ${formatEta(d.eta)} left` : ''}`
      : d.state === 'queued'
        ? 'Waiting'
        : d.state === 'resolving'
          ? 'Finding the stream…'
          : d.state === 'paused'
            ? `Paused · ${Math.round(d.progress * 100)}%`
            : d.state === 'done'
              ? [d.quality, formatDuration(d.duration), formatBytes(d.bytes)].filter(Boolean).join(' · ')
              : d.state === 'missing'
                ? 'The file is gone'
                : d.error ?? 'Failed';

  const confirmRemove = () =>
    Alert.alert('Delete download?', `${d.title} will be removed from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeDownload(d.id) },
    ]);

  return (
    <Pressable
      onPress={() => (done ? router.push(`/offline/${d.id}`) : d.mediaId != null && router.push(`/${d.mediaType}/${d.mediaId}`))}
      onLongPress={confirmRemove}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.poster}>
        {poster && <Image source={poster} style={StyleSheet.absoluteFill} contentFit="cover" />}
        {done && (
          <View style={styles.playBadge}>
            <Play size={14} color="#fff" fill="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name} numberOfLines={2}>{d.mediaType === 'tv' && d.showTitle ? d.showTitle : d.title}</Text>
        {d.mediaType === 'tv' && (
          <Text style={styles.episode} numberOfLines={1}>
            S{d.season} · E{d.episode}
            {d.episodeTitle ? ` · ${d.episodeTitle}` : ''}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {(d.state === 'failed' || d.state === 'interrupted' || d.state === 'missing') && <AlertCircle size={12} color={colors.danger} />}
          <Text style={[styles.status, (d.state === 'failed' || d.state === 'interrupted') && { color: colors.danger }]} numberOfLines={2}>{status}</Text>
        </View>
        {(isActive(d) || (done && watched)) && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (isActive(d) ? d.progress : watched ?? 0) * 100)}%` }, done && { backgroundColor: colors.white60 }]} />
          </View>
        )}
      </View>
      <View style={styles.actions}>
        {d.state === 'downloading' || d.state === 'queued' || d.state === 'resolving' ? (
          <IconAction onPress={() => pauseDownload(d.id)} label="Pause"><Pause size={18} color={colors.foreground} /></IconAction>
        ) : d.state === 'paused' ? (
          <IconAction onPress={() => resumeDownload(d.id)} label="Resume"><DownloadIcon size={18} color={colors.accent} /></IconAction>
        ) : (d.state === 'failed' || d.state === 'interrupted') && d.target ? (
          <IconAction onPress={() => retryDownload(d.id)} label="Retry"><RotateCw size={18} color={colors.foreground} /></IconAction>
        ) : null}
        {isActive(d) ? (
          <IconAction onPress={() => cancelDownload(d.id)} label="Cancel"><X size={18} color={colors.muted} /></IconAction>
        ) : (
          <IconAction onPress={confirmRemove} label="Delete"><Trash2 size={18} color={colors.muted} /></IconAction>
        )}
      </View>
    </Pressable>
  );
}

function IconAction({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={styles.iconAction}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { ...type.h1, color: colors.foreground, fontSize: 30 },
  subtitle: { color: colors.muted, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.lg, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  poster: { width: 60, height: 90, borderRadius: radius.sm, backgroundColor: colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  name: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  episode: { color: colors.white70, fontSize: 12 },
  status: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.white10, marginTop: 4, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.accent },
  actions: { gap: space.sm },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white5 },
});
