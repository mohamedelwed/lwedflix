import React, { useState } from 'react';
import { dialog } from '@/components/Dialog';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Download } from 'lucide-react-native';
import Sheet from './Sheet';
import { enqueueEpisodes } from '@/downloads/engine';
import { colors, radius } from '@/theme';

const HEIGHTS = [
  { label: 'Best available', height: null },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p (smallest)', height: 480 },
];

/** Queues a whole season; each episode finds its own stream in turn (src/components/downloads/SeasonDownloadButton.tsx). */
export default function SeasonDownloadButton({
  show,
  season,
  episodes,
}: {
  show: { id: number; name: string; posterPath: string | null };
  season: number;
  episodes: { episode_number: number; name: string; air_date?: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const aired = episodes.filter((e) => !e.air_date || e.air_date <= today);
  if (aired.length === 0) return null;

  const queue = (height: number | null) => {
    const { added, skipped } = enqueueEpisodes(
      { title: show.name, mediaId: show.id, posterPath: show.posterPath },
      aired.map((e) => ({ season, episode: e.episode_number, episodeTitle: e.name })),
      { height }
    );
    dialog(
      added ? `Season ${season} queued` : 'Already downloaded',
      added
        ? `${added} episode${added > 1 ? 's' : ''} will download one after another${skipped ? ` (${skipped} already there)` : ''}. Keep Lwedflix open while they download.`
        : 'Every episode of this season is downloaded or on its way.',
      [{ text: 'OK' }, { text: 'Open Downloads', onPress: () => router.push('/downloads') }]
    );
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.button} hitSlop={6}>
        <Download size={14} color={colors.accent} />
        <Text style={styles.text}>Season</Text>
      </Pressable>
      <Sheet
        visible={open}
        title={`Download season ${season} · ${aired.length} episodes`}
        onClose={() => setOpen(false)}
        options={HEIGHTS.map((h) => ({ key: String(h.height), label: h.label, onPress: () => queue(h.height) }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,153,0,0.4)' },
  text: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});
