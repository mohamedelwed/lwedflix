// Where you stopped in each movie, so it can pick up there next time.
// (Episodes keep theirs in episodeProgress.ts.) localStorage is the source
// of truth for reads; movieProgressSync.ts mirrors it to the account so
// another device (the phone app, another computer) resumes there too.

const STORAGE_KEY = 'lwedflix:movie-progress';
const MAX_ENTRIES = 200;

export interface MovieProgress {
  watched: number; // seconds
  duration: number; // seconds
  at: number; // when, for pruning
}

function readAll(): Record<string, MovieProgress> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Seconds to resume from, or undefined when there's nothing worth resuming. */
export function getMovieResume(movieId: string | number): number | undefined {
  const saved = readAll()[String(movieId)];
  if (!saved || !(saved.duration > 0)) return undefined;
  // Barely started, or into the credits: start from the top.
  if (saved.watched < 60 || saved.watched / saved.duration >= 0.92) return undefined;
  return saved.watched;
}

/** How far through a movie is, 0–1, or undefined when it hasn't been started. */
export function getMovieFraction(movieId: string | number): number | undefined {
  const saved = readAll()[String(movieId)];
  return saved && saved.duration > 0 ? Math.min(1, saved.watched / saved.duration) : undefined;
}

/** The saved entry for a movie, if any. */
export function getMovieEntry(movieId: string | number): MovieProgress | undefined {
  return readAll()[String(movieId)];
}

/** The newer of two entries for the same movie (by `at`). */
export function mergeMovieProgress(local: MovieProgress | undefined, remote: MovieProgress | undefined): MovieProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return remote.at > local.at ? remote : local;
}

type Listener = (movieId: string, entry: MovieProgress) => void;
const listeners = new Set<Listener>();

/** Called after every local write (movieProgressSync.ts pushes it). */
export function onMovieProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Stores an entry as is (a hydrate from the account), without notifying. */
export function putMovieEntry(movieId: string | number, entry: MovieProgress) {
  const all = readAll();
  all[String(movieId)] = entry;
  writeAll(all);
}

/** Called about once a second while playing; writes at most every 5s of change. */
export function setMovieProgress(movieId: string | number, watched: number, duration: number) {
  if (!(duration > 0) || !(watched >= 0)) return;
  const all = readAll();
  const key = String(movieId);
  const prev = all[key];
  if (prev && Math.abs(prev.watched - watched) < 5 && prev.duration === duration) return;
  const entry = { watched, duration, at: Date.now() };
  all[key] = entry;
  writeAll(all);
  for (const listener of listeners) listener(key, entry);
}

function writeAll(all: Record<string, MovieProgress>) {
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => all[a].at - all[b].at);
    for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[old];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: resuming is a nicety, not worth an error.
  }
}
