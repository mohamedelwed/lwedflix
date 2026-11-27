// The phone app's TMDB settings (mobile/app.config.ts puts them in
// `extra`). Read-only token, as the desktop installer ships too.
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const TMDB_BASE_URL = extra.tmdbBaseUrl ?? 'https://api.themoviedb.org/3';
export const TMDB_ACCESS_TOKEN = extra.tmdbAccessToken;
