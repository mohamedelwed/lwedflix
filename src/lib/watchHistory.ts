// Watch history (the `watch_history` table), written even offline.
//
// A downloaded film plays without the internet, but history lives in
// Supabase. An entry that can't be written is kept in localStorage and sent
// when the connection comes back (AppShell calls flushWatchHistory), along
// with the episode progress of any show watched meanwhile.

import { supabase } from './supabase';
import { syncShowProgress } from './episodeProgress';

const STORAGE_KEY = 'lwedflix:history-queue';
const MAX_QUEUED = 100;

export interface WatchEntry {
  user_id: string;
  movie_id: string;
  type: 'movie' | 'tv';
  title: string | null | undefined;
  poster_path: string | null | undefined;
  season: number | null;
  episode: number | null;
  watched_at: string;
}

function readQueue(): WatchEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: WatchEntry[]) {
  try {
    if (queue.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the entry is lost, as it would have been before.
  }
}

async function upsert(entry: WatchEntry): Promise<boolean> {
  try {
    const { error } = await supabase.from('watch_history').upsert(entry, { onConflict: 'user_id, movie_id' });
    return !error;
  } catch {
    return false;
  }
}

/** Records a watch now, or queues it for when the connection is back. */
export async function recordWatch(entry: WatchEntry) {
  if (navigator.onLine && (await upsert(entry))) return;
  // One entry per title is all the table keeps; the latest wins.
  writeQueue([...readQueue().filter((e) => !(e.user_id === entry.user_id && e.movie_id === entry.movie_id)), entry]);
}

const keyOf = (e: WatchEntry) => `${e.user_id}|${e.movie_id}|${e.watched_at}`;
let flushing = false;

/** Sends what was queued offline. Safe to call any time. */
export async function flushWatchHistory() {
  if (flushing || !navigator.onLine) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const sent = new Set<string>();
    for (const entry of queue) {
      if (!(await upsert(entry))) continue;
      sent.add(keyOf(entry));
      if (entry.type === 'tv') syncShowProgress(entry.movie_id);
    }
    // Re-read: anything queued while this ran stays queued.
    writeQueue(readQueue().filter((e) => !sent.has(keyOf(e))));
  } finally {
    flushing = false;
  }
}
