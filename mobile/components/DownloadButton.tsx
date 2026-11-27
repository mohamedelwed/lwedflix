import React, { useState } from 'react';
import { router } from 'expo-router';
import { Download } from 'lucide-react-native';
import type { DownloadMeta } from '@shared/lib/downloads';
import { titleFor } from '@electron/streams';
import { dialog } from './Dialog';
import ActionButton from './ActionButton';
import Sheet, { type SheetOption } from './Sheet';
import { enqueueTitle } from '@/downloads/engine';
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
 * Download now or later (kept in Downloads until started). Either way the
 * title gets a hidden player of its own (downloads/EpisodeResolver.tsx), so
 * nobody needs to watch, and servers see the browser they let play. The
 * quality is the one in the download settings, or asked for.
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

  const open = () => {
    setSheet({
      title: `Download ${meta.title}`,
      options: [
        {
          key: 'now',
          label: 'Download now',
          detail: 'Downloads in the background — keep watching or use your phone',
          onPress: () => queueTitle(false),
        },
        { key: 'later', label: 'Download later', detail: 'Kept in Downloads until you start it', onPress: () => queueTitle(true) },
      ],
    });
  };

  return (
    <>
      <ActionButton icon={Download} label="Download" onPress={open} />
      <Sheet visible={sheet !== null} title={sheet?.title} options={sheet?.options} onClose={() => setSheet(null)} />
    </>
  );
}
