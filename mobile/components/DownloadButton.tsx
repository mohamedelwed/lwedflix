import React, { useState } from 'react';
import { dialog } from '@/components/Dialog';
import { router } from 'expo-router';
import { Download } from 'lucide-react-native';
import { formatBytes } from '@shared/lib/downloads';
import type { Quality, StreamOption } from '@shared/lib/downloads';
import { titleFor } from '@electron/streams';
import ActionButton from './ActionButton';
import Sheet, { type SheetOption } from './Sheet';
import { listStreams, startDownload, streamQualities } from '@/downloads/engine';
import type { PlayableMedia, PlayerHandle } from '@/player/types';

/**
 * Saves what the player is streaming (src/components/DownloadButton.tsx):
 * pick the stream (the likeliest first), then a quality when it has several.
 */
export default function DownloadButton({
  player,
  playing,
  onStartPlaying,
  media,
}: {
  player: React.RefObject<PlayerHandle | null>;
  playing: boolean;
  onStartPlaying: () => void;
  media: PlayableMedia;
}) {
  const [sheet, setSheet] = useState<null | { title: string; options: SheetOption[] }>(null);
  const [busy, setBusy] = useState(false);

  const meta = {
    title: titleFor({ title: media.title, type: media.type, season: media.season, episode: media.episode }) || media.title,
    mediaType: media.type,
    mediaId: media.id,
    season: media.type === 'tv' ? media.season : undefined,
    episode: media.type === 'tv' ? media.episode : undefined,
    showTitle: media.type === 'tv' ? media.title : undefined,
    episodeTitle: media.episodeTitle ?? undefined,
    posterPath: media.posterPath ?? undefined,
  };

  const start = (stream: StreamOption, variant?: number) => {
    const result = startDownload(stream.id, { variant, meta });
    if (!result.ok) dialog('Couldn’t download', result.error);
    else dialog('Downloading', `${meta.title} is downloading. You'll find it in Downloads.`, [
      { text: 'OK' },
      { text: 'Open Downloads', onPress: () => router.push('/downloads') },
    ]);
  };

  const pickQuality = async (stream: StreamOption) => {
    setBusy(true);
    let qualities: Quality[] = [];
    try {
      qualities = await streamQualities(stream.id);
    } catch {
      // Download the stream as it is.
    } finally {
      setBusy(false);
    }
    if (qualities.length < 2) return start(stream);
    setSheet({
      title: 'Quality',
      options: qualities.map((q) => ({
        key: String(q.index),
        label: q.label,
        detail: !q.supported ? 'Sound is a separate stream — can’t be saved yet' : q.bytes ? `About ${formatBytes(q.bytes)}` : undefined,
        disabled: !q.supported,
        onPress: () => start(stream, q.index),
      })),
    });
  };

  const open = () => {
    if (!playing || !player.current) {
      dialog('Play it first', 'Downloads save what the player is streaming. Press play, and once the video starts, tap Download.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Play', onPress: onStartPlaying },
      ]);
      return;
    }
    const streams = listStreams().filter((s) => s.supported);
    if (streams.length === 0) {
      dialog('Nothing to download yet', 'Start the video first. If it’s playing and this still shows, try another server.');
      return;
    }
    if (streams.length === 1) return void pickQuality(streams[0]);
    setSheet({
      title: 'Download',
      options: streams.map((s) => ({
        key: s.id,
        label: s.best ? `${s.title} · recommended` : s.title,
        detail: s.detail,
        onPress: () => setTimeout(() => void pickQuality(s), 250),
      })),
    });
  };

  return (
    <>
      <ActionButton icon={Download} label="Download" busy={busy} onPress={open} />
      <Sheet visible={sheet !== null} title={sheet?.title} options={sheet?.options} onClose={() => setSheet(null)} />
    </>
  );
}
