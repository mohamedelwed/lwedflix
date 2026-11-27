// Where TMDB is and the token to ask it with. The phone app (mobile/)
// resolves tmdbConfig.native.ts instead, which reads them from the app's
// build config.
export const TMDB_BASE_URL = process.env.NEXT_PUBLIC_TMDB_BASE_URL;
export const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;
