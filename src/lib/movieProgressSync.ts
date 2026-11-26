// Mirrors movieProgress.ts to the account (table movie_progress), as
// episodeProgress.ts does for shows, so a movie stopped on one device
// resumes on another. Best-effort throughout: if the user is signed out,
// offline, or the table isn't there yet (migration 0021 not applied),
// resuming simply stays local.

import { supabase } from './supabase';
import { getMovieEntry, mergeMovieProgress, onMovieProgress, putMovieEntry, type MovieProgress } from './movieProgress';

const PUSH_DELAY_MS = 1500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let disabled = false; // the table is missing; stop asking

function isMissingTable(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

async function push(movieId: string, entry: MovieProgress) {
  if (disabled) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('movie_progress').upsert(
      {
        user_id: userId,
        movie_id: movieId,
        watched: entry.watched,
        duration: entry.duration,
        updated_at: new Date(entry.at).toISOString(),
      },
      { onConflict: 'user_id,movie_id' }
    );
    if (isMissingTable(error)) disabled = true;
  } catch {
    // Local storage already has it.
  }
}

let started = false;

/** Starts pushing every local write to the account. Safe to call more than once. */
export function startMovieProgressSync() {
  if (started) return;
  started = true;
  onMovieProgress((movieId, entry) => {
    const existing = timers.get(movieId);
    if (existing) clearTimeout(existing);
    timers.set(
      movieId,
      setTimeout(() => {
        timers.delete(movieId);
        void push(movieId, entry);
      }, PUSH_DELAY_MS)
    );
  });
}

/**
 * Pulls the account's position for a movie and keeps the newer of it and
 * the local one. Resolves to true when the local entry changed.
 */
export async function hydrateMovieProgress(movieId: string | number): Promise<boolean> {
  if (disabled) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return false;
    const { data, error } = await supabase
      .from('movie_progress')
      .select('watched, duration, updated_at')
      .eq('user_id', userId)
      .eq('movie_id', String(movieId))
      .maybeSingle();
    if (isMissingTable(error)) disabled = true;
    if (error || !data) return false;
    const remote: MovieProgress = {
      watched: Number(data.watched) || 0,
      duration: Number(data.duration) || 0,
      at: Date.parse(data.updated_at) || 0,
    };
    const local = getMovieEntry(movieId);
    const merged = mergeMovieProgress(local, remote);
    if (!merged || merged === local) {
      // Ours is newer: make sure the account catches up.
      if (local && local.at > remote.at) void push(String(movieId), local);
      return false;
    }
    putMovieEntry(movieId, merged);
    return true;
  } catch {
    return false;
  }
}
