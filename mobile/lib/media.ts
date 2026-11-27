// Small helpers over TMDB results, shared by the screens.
export type MediaType = 'movie' | 'tv';

export interface MediaItem {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  media_type?: MediaType | 'person';
  popularity?: number;
}

export const titleOf = (item: MediaItem) => item.title || item.name || '';
export const yearOf = (item: MediaItem) => (item.release_date || item.first_air_date || '').split('-')[0];
export const typeOf = (item: MediaItem): MediaType =>
  item.media_type === 'movie' || item.media_type === 'tv' ? item.media_type : item.title ? 'movie' : 'tv';

export function imageUrl(path: string | null | undefined, size = 'w500'): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function hrefFor(item: MediaItem) {
  return `/${typeOf(item)}/${item.id}` as const;
}

export function formatRuntime(minutes?: number | null) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
