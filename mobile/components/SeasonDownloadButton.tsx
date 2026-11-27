import React, { useState } from 'react';
import { dialog } from '@/components/Dialog';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Download } from 'lucide-react-native';
import Sheet from './Sheet';
import { HEIGHTS } from './DownloadButton';
import { getSettings } from '@/downloads/settings';
import { enqueueEpisodes } from '@/downloads/engine';
import { colors, radius } from '@/theme';


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

  const queue = (height: number | null, later: boolean) => {
    const { added, skipped } = enqueueEpisodes(
      { title: show.name, mediaId: show.id, posterPath: show.posterPath },
      aired.map((e) => ({ season, episode: e.episode_number, episodeTitle: e.name })),
      { height, later }
    );
    dialog(
      !added ? 'Already downloaded' : later ? `Season ${season} saved for later` : `Season ${season} queued`,
      !added
        ? 'Every episode of this season is downloaded or on its way.'
        : later
          ? `${added} episode${added > 1 ? 's are' : ' is'} in Downloads${skipped ? ` (${skipped} already there)` : ''}. Start them whenever you like.`
          : `${added} episode${added > 1 ? 's' : ''} will download one after another${skipped ? ` (${skipped} already there)` : ''}. Keep Lwedflix open while they download.`,
      [{ text: 'OK', style: 'cancel' }, { text: 'Open Downloads', onPress: () => router.push('/downloads') }]
    );
  };

  /** Now or later, once the quality is known. */
  const when = (height: number | null) =>
    dialog(`Download season ${season}`, `${aired.length} episode${aired.length > 1 ? 's' : ''}, one after another. Each finds its stream when its turn comes.`, [
      { text: 'Later', onPress: () => queue(height, true) },
      { text: 'Start now', onPress: () => queue(height, false) },
    ]);

  const start = () => {
    const setting = getSettings().quality;
    if (setting === 'ask') setOpen(true);
    else when(setting);
  };

  return (
    <>
      <Pressable onPress={start} style={styles.button} hitSlop={6}>
        <Download size={14} color={colors.accent} />
        <Text style={styles.text}>Season</Text>
      </Pressable>
      <Sheet
        visible={open}
        title={`Download season ${season} · ${aired.length} episodes`}
        onClose={() => setOpen(false)}
        options={HEIGHTS.map((h) => ({ key: String(h.height), label: h.label, onPress: () => setTimeout(() => when(h.height), 250) }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,153,0,0.4)' },
  text: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});
