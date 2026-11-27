import React, { useState } from 'react';
import { router } from 'expo-router';
import { Bookmark } from 'lucide-react-native';
import { STATUS_LABEL, WATCH_STATUSES } from '@shared/lib/watchlist';
import ActionButton from './ActionButton';
import Sheet from './Sheet';
import { useAuth } from '@/lib/auth';
import { useWatchlist } from '@/lib/watchlist';

export default function WatchlistButton({ id, type, title, posterPath }: { id: number; type: 'movie' | 'tv'; title: string; posterPath?: string | null }) {
  const { user } = useAuth();
  const { entries, save, remove } = useWatchlist();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = entries.get(String(id));

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch {
      // The list is re-read on next open; nothing to tell the user beyond the button not changing.
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ActionButton
        icon={Bookmark}
        label={entry ? STATUS_LABEL[entry.status] : 'Watchlist'}
        active={!!entry}
        busy={busy}
        onPress={() => (user ? setOpen(true) : router.push('/login'))}
      />
      <Sheet
        visible={open}
        title="Watchlist"
        onClose={() => setOpen(false)}
        options={[
          ...WATCH_STATUSES.map((s) => ({
            key: s.id,
            label: s.label,
            selected: entry?.status === s.id,
            onPress: () => run(() => save({ id, type, title, posterPath }, s.id)),
          })),
          ...(entry ? [{ key: 'remove', label: 'Remove from watchlist', destructive: true, onPress: () => run(() => remove(id)) }] : []),
        ]}
      />
    </>
  );
}
