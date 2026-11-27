import { getTVSeasonDetails } from '@shared/lib/tmdb';

// The episode after or before another, across seasons (src/lib/episodes.ts
// asks the desktop's own API route; the phone asks TMDB directly).

export interface EpisodeRef {
  season: number;
  episode: number;
}

const sizes = new Map<string, Promise<number>>();

function seasonSize(showId: string | number, season: number): Promise<number> {
  const key = `${showId}:${season}`;
  let size = sizes.get(key);
  if (!size) {
    size = getTVSeasonDetails(String(showId), season)
      .then((data: { episodes?: unknown[] }) => (Array.isArray(data?.episodes) ? data.episodes.length : 0))
      .catch(() => {
        sizes.delete(key);
        return 0;
      });
    sizes.set(key, size);
  }
  return size;
}

/** Null at either end of the show. Season 0 (specials) is skipped. */
export async function adjacentEpisode(showId: string | number, { season, episode }: EpisodeRef, direction: 1 | -1): Promise<EpisodeRef | null> {
  if (direction === 1) {
    if (episode < (await seasonSize(showId, season))) return { season, episode: episode + 1 };
    return (await seasonSize(showId, season + 1)) > 0 ? { season: season + 1, episode: 1 } : null;
  }
  if (episode > 1) return { season, episode: episode - 1 };
  if (season <= 1) return null;
  const size = await seasonSize(showId, season - 1);
  return size > 0 ? { season: season - 1, episode: size } : null;
}
