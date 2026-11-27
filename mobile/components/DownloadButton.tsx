import React, { useState } from 'react';
import { router } from 'expo-router';
import { Download } from 'lucide-react-native';
import { formatBytes } from '@shared/lib/downloads';
import type { DownloadMeta, Quality, StreamOption } from '@shared/lib/downloads';
import { titleFor } from '@electron/streams';
import { dialog } from './Dialog';
import ActionButton from './ActionButton';
import Sheet, { type SheetOption } from './Sheet';
import { enqueueTitle, listStreams, startDownload, streamQualities } from '@/downloads/engine';
import { getSettings } from '@/downloads/settings';
import type { PlayableMedia, PlayerHandle } from '@/player/types';

/** The heights offered when there's no stream to ask yet. */
export const HEIGHTS: { label: string; height: number | null }[] = [
  { label: 'Best available', height: null },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p (smallest)', height: 480 },
];

type SheetState = { title: string; options: SheetOption[] };

/**
 * Download now (what the player streams, or a stream found in the
 * background when nothing plays) or later (kept in Downloads until started).
 * The quality is the one in the download settings, or asked for.
 */
export default function DownloadButton({
  player,
  playing,
  media,
}: {
  player: React.RefObject<PlayerHandle | null>;
  playing: boolean;
  onStartPlaying?: () => void;
  media: PlayableMedia;
}) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);

  const meta: DownloadMeta = {
    title: titleFor({ title: media.title, type: media.type, season: media.season, episode: media.episode }) || media.title,
    mediaType: media.type,
    mediaId: media.id,
    season: media.type === 'tv' ? media.season : undefined,
    episode: media.type === 'tv' ? media.episode : undefined,
    showTitle: media.type === 'tv' ? media.title : undefined,
    episodeTitle: media.episodeTitle ?? undefined,
    posterPath: media.posterPath ?? undefined,
  };

  /** Opens a sheet once the one before has closed. */
  const next = (state: SheetState | null) => {
    setSheet(null);
    if (state) setTimeout(() => setSheet(state), 250);
  };

  const done = (later: boolean) =>
    dialog(later ? 'Saved for later' : 'Downloading', later ? `${meta.title} is in Downloads. Start it whenever you like.` : `${meta.title} is downloading. You'll find it in Downloads.`, [
      { text: 'OK', style: 'cancel' },
      { text: 'Open Downloads', onPress: () => router.push('/downloads') },
    ]);

  const report = (result: { ok: true } | { ok: false; error: string }, later: boolean) => {
    if (result.ok) done(later);
    else dialog('Couldn’t download', result.error);
  };

  /** Without a playing stream: the title finds its own when its turn comes. */
  const queueTitle = (later: boolean) => {
    const setting = getSettings().quality;
    const go = (height: number | null) => report(enqueueTitle(meta, { height, later }), later);
    if (setting !== 'ask') return void (setSheet(null), go(setting));
    next({ title: 'Quality', options: HEIGHTS.map((h) => ({ key: String(h.height), label: h.label, onPress: () => go(h.height) })) });
  };

  const fromStream = (stream: StreamOption, variant?: number) => {
    const result = startDownload(stream.id, { variant, meta });
    if (result.ok) done(false);
    else queueTitle(false); // gone already: find a fresh one instead
  };

  const pickQuality = async (stream: StreamOption) => {
    setSheet(null);
    setBusy(true);
    let qualities: Quality[] = [];
    try {
      qualities = (await streamQualities(stream.id)).filter((q) => q.supported);
    } catch {
      // Download the stream as it is.
    } finally {
      setBusy(false);
    }
    if (qualities.length < 2) return fromStream(stream);
    const setting = getSettings().quality;
    if (setting !== 'ask') {
      // The best at or under the chosen height (the smallest when all are taller).
      const sorted = [...qualities].sort((a, b) => b.height - a.height);
      const pick = setting === null ? sorted[0] : sorted.find((q) => q.height <= setting) ?? sorted[sorted.length - 1];
      return fromStream(stream, pick.index);
    }
    next({
      title: 'Quality',
      options: qualities.map((q) => ({
        key: String(q.index),
        label: q.label,
        detail: q.bytes ? `About ${formatBytes(q.bytes)}` : undefined,
        onPress: () => fromStream(stream, q.index),
      })),
    });
  };

  const downloadNow = () => {
    const streams = playing && player.current ? listStreams().filter((s) => s.supported) : [];
    if (streams.length === 0) return queueTitle(false);
    if (streams.length === 1) return void pickQuality(streams[0]);
    next({
      title: 'Which stream?',
      options: streams.map((s) => ({
        key: s.id,
        label: s.best ? `${s.title} · recommended` : s.title,
        detail: s.detail,
        onPress: () => void pickQuality(s),
      })),
    });
  };

  const open = () => {
    const streaming = playing && listStreams().some((s) => s.supported);
    setSheet({
      title: `Download ${meta.title}`,
      options: [
        {
          key: 'now',
          label: 'Download now',
          detail: streaming ? 'Saves what the player is streaming' : 'Finds the stream in the background — no need to watch',
          onPress: downloadNow,
        },
        { key: 'later', label: 'Download later', detail: 'Kept in Downloads until you start it', onPress: () => queueTitle(true) },
      ],
    });
  };

  return (
    <>
      <ActionButton icon={Download} label="Download" busy={busy} onPress={open} />
      <Sheet visible={sheet !== null} title={sheet?.title} options={sheet?.options} onClose={() => setSheet(null)} />
    </>
  );
}
