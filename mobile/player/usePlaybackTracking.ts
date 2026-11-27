import { useCallback, useEffect, useRef } from 'react';
import { recordWatch } from '@shared/lib/watchHistory';
import { clearNowWatching, HEARTBEAT_MS, upsertNowWatching } from '@shared/lib/presence';
import { setMovieProgress } from '@shared/lib/movieProgress';
import { markEpisodeWatched, setEpisodePosition, setLastPosition, syncShowProgress } from '@shared/lib/episodeProgress';
import { useAuth } from '@/lib/auth';
import type { PlayableMedia, PlayerState } from './types';

/**
 * What the desktop player does around playback: history after 10 seconds,
 * the "watching now" heartbeat for friends, and resume positions (synced
 * to the account by movieProgressSync / episodeProgress).
 * Returns the handler to feed every player state.
 */
export function usePlaybackTracking(media: PlayableMedia, active: boolean, onEpisodeProgress?: () => void) {
  const { user } = useAuth();
  const { type, id, title, posterPath } = media;
  const season = media.season ?? 1;
  const episode = media.episode ?? 1;

  useEffect(() => {
    if (!user || !active) return;
    const timer = setTimeout(() => {
      void recordWatch({
        user_id: user.id,
        movie_id: String(id),
        type,
        title,
        poster_path: posterPath,
        season: type === 'tv' ? season : null,
        episode: type === 'tv' ? episode : null,
        watched_at: new Date().toISOString(),
      });
    }, 10000);
    return () => clearTimeout(timer);
  }, [user, active, id, type, season, episode, title, posterPath]);

  useEffect(() => {
    if (!user || !active) return;
    const beat = () =>
      upsertNowWatching({ mediaType: type, mediaId: id, title, posterPath, season: type === 'tv' ? season : null, episode: type === 'tv' ? episode : null }).catch(() => {});
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(interval);
      clearNowWatching().catch(() => {});
    };
  }, [user, active, id, type, season, episode, title, posterPath]);

  useEffect(() => {
    if (type === 'tv' && active) setLastPosition(id, season, episode);
  }, [type, id, season, episode, active]);

  const callback = useRef(onEpisodeProgress);
  callback.current = onEpisodeProgress;

  return useCallback(
    (state: PlayerState | null) => {
      if (!state || !(state.duration > 0)) return;
      if (type === 'movie') {
        setMovieProgress(id, state.time, state.duration);
      } else if (setEpisodePosition(id, season, episode, state.time, state.duration)) {
        syncShowProgress(id);
        callback.current?.();
      }
      if (state.event === 'ended' && type === 'tv') {
        markEpisodeWatched(id, season, episode);
        syncShowProgress(id);
      }
    },
    [type, id, season, episode]
  );
}
