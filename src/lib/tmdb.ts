import { TMDB_ACCESS_TOKEN as ACCESS_TOKEN, TMDB_BASE_URL as BASE_URL } from './tmdbConfig';

const options = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    Authorization: `Bearer ${ACCESS_TOKEN}`
  }
};

export async function fetchFromTMDB(endpoint: string, params: Record<string, string> = {}) {
  const urlParams = new URLSearchParams(params);
  const response = await fetch(`${BASE_URL}${endpoint}?${urlParams.toString()}`, { ...options, next: { revalidate: 3600 } });
  if (!response.ok) {
    throw new Error(`TMDB API Error: ${response.statusText}`);
  }
  return response.json();
}

export async function getTrending(type: 'movie' | 'tv' | 'all' = 'all') {
  return fetchFromTMDB(`/trending/${type}/day`);
}

export async function getPopular(type: 'movie' | 'tv' = 'movie') {
  return fetchFromTMDB(`/${type}/popular`);
}

export async function getNowPlaying(type: 'movie' | 'tv' = 'movie') {
  const endpoint = type === 'movie' ? '/movie/now_playing' : '/tv/on_the_air';
  return fetchFromTMDB(endpoint);
}

export async function getRecommendations(type: 'movie' | 'tv', id: string) {
  return fetchFromTMDB(`/${type}/${id}/recommendations`);
}

export async function getMovieDetails(id: string) {
  return fetchFromTMDB(`/movie/${id}`, { append_to_response: 'videos,credits,recommendations,reviews' });
}

export async function getTVDetails(id: string) {
  return fetchFromTMDB(`/tv/${id}`, { append_to_response: 'videos,credits,recommendations,external_ids,reviews' });
}

export async function getTVSeasonDetails(id: string, seasonNumber: number) {
  return fetchFromTMDB(`/tv/${id}/season/${seasonNumber}`);
}

// Official clips/teasers TMDB has attached to one specific episode, if any —
// coverage is sparse (most episodes have none), never the episode itself.
export async function getEpisodeVideos(id: string, seasonNumber: number, episodeNumber: number) {
  return fetchFromTMDB(`/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}/videos`);
}

export async function searchTMDB(query: string) {
  const data = await fetchFromTMDB('/search/multi', { query });
  // Filter search results to remove low-quality "backlog" items
  data.results = data.results.filter((item: any) => {
    // Keep persons
    if (item.media_type === 'person') return true;
    
    // Filter movies/tv
    const hasPoster = !!item.poster_path;
    const isPopularEnough = (item.vote_count || 0) >= 10 || (item.popularity || 0) >= 3;
    const isNotAncient = (item.release_date || item.first_air_date || '1970').split('-')[0] >= '1960';
    
    return hasPoster && isPopularEnough && isNotAncient;
  });
  return data;
}

export async function getGenres(type: 'movie' | 'tv') {
  return fetchFromTMDB(`/genre/${type}/list`);
}

export async function getLanguages() {
  return fetchFromTMDB('/configuration/languages');
}

export async function getWatchProviders(type: 'movie' | 'tv', region: string = 'US') {
  return fetchFromTMDB(`/watch/providers/${type}`, { watch_region: region });
}

export async function getCountries() {
  return fetchFromTMDB('/configuration/countries');
}

export async function discoverContent(type: 'movie' | 'tv', filters: Record<string, string>) {
  const now = new Date().toISOString().split('T')[0];

  // The vote_count/popularity floor below is tuned for a worldwide feed —
  // it exists to keep obscure backlog out of general browsing. But when the
  // user has deliberately filtered to one country's catalog, that same floor
  // nearly empties it: e.g. Tunisia has ~580 movies on TMDB, and vote_count>=50
  // alone drops that to 9, since a smaller market accumulates far fewer TMDB
  // votes than Hollywood output. A country filter is an explicit opt-in to a
  // smaller catalog, so it isn't "obscure backlog" the same gate should apply to.
  const hasCountryFilter = !!filters.with_origin_country;

  // Map our UI filters to TMDB params with Catalog Quality Gate defaults
  const tmdbParams: Record<string, string> = {
    sort_by: filters.sort_by || 'popularity.desc',
    include_adult: 'false',
    page: '1',
    'vote_count.gte': hasCountryFilter ? '1' : '50',      // Filter out obscure backlog
    'popularity.gte': hasCountryFilter ? '0' : '3',       // Filter out low-interest items
    ...filters
  };

  // Prevent unreleased content and very old backlog
  if (type === 'movie') {
    tmdbParams['primary_release_date.lte'] = now;
    tmdbParams['primary_release_date.gte'] = '1960-01-01';
  } else {
    tmdbParams['first_air_date.lte'] = now;
    tmdbParams['first_air_date.gte'] = '1960-01-01';
  }

  // Movies only. For TV, with_runtime filters on EPISODE length, not the
  // series — so a 40-minute floor silently deletes most of television:
  // anime episodes run ~24 minutes, and this alone cut anime series from
  // 1031 results to 4. Shorts are a movie problem; vote_count/popularity
  // already gate quality for TV.
  if (type === 'movie') {
    tmdbParams['with_runtime.gte'] = '40'; // Filter out shorts/clips
  }


  // Handle Age Rating (Certification)
  if (filters.certification) {
    tmdbParams.certification_country = 'US';
    tmdbParams.certification = filters.certification;
  }

  // Default region to US if no country is selected, ensures global services (Apple TV) work
  if (tmdbParams.with_watch_providers) {
    tmdbParams.watch_region = filters.with_origin_country || 'US';
    tmdbParams.with_watch_monetization_types = 'flatrate|ads';
    tmdbParams.with_watch_providers = tmdbParams.with_watch_providers.replace(/,/g, '|');
  }

  return fetchFromTMDB(`/discover/${type}`, tmdbParams);
}

export async function getAnimeMix() {
  const [tvResults, movieResults] = await Promise.all([
    discoverContent('tv', { with_genres: '16', with_original_language: 'ja' }),
    discoverContent('movie', { with_genres: '16', with_original_language: 'ja' })
  ]);

  // Interleave rather than sorting the union by popularity: anime films
  // tend to out-score series on that metric, so a straight sort can fill
  // the whole first page with movies and make it look like there are no
  // shows at all. Each list stays popularity-ordered internally.
  const tv = [...tvResults.results].sort((a, b) => b.popularity - a.popularity);
  const movies = [...movieResults.results].sort((a, b) => b.popularity - a.popularity);

  const combined: any[] = [];
  for (let i = 0; i < Math.max(tv.length, movies.length) && combined.length < 20; i++) {
    if (tv[i]) combined.push(tv[i]);
    if (movies[i] && combined.length < 20) combined.push(movies[i]);
  }

  return { results: combined };
}

export async function getPersonDetails(id: string) {
  return fetchFromTMDB(`/person/${id}`, { append_to_response: 'combined_credits' });
}

export async function getCollection(collectionId: number | string) {
  return fetchFromTMDB(`/collection/${collectionId}`);
}
