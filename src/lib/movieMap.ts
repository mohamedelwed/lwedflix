// The Movie Map's data: public/movie-map/map.json (made by
// scripts/movie-map/build.mjs), and the search and filters the page runs
// over it. Films are referred to by their index in the file; their TMDB id
// is `ids[index]`.

export interface MovieMapRegion {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

/** map.json as written: one array per field, all in the same film order. */
export interface MovieMapFile {
  version: number;
  generated: string;
  minVotes: number;
  genres: [id: number, name: string][];
  languages: [code: string, name: string, films: number][];
  keywords: string[];
  regions: MovieMapRegion[];
  similarPerFilm: number;
  films: {
    id: number[];
    title: string[];
    year: number[];
    x: number[];
    y: number[];
    votes: number[];
    rating: number[];
    genres: number[];
    language: number[];
    poster: string[];
    region: number[];
    color: number[];
    keywords: number[][];
    similar: number[];
  };
}

export interface MovieMapData {
  generated: string;
  count: number;
  /** Map coordinates run from 0 to SIZE on both axes. */
  size: number;
  genres: { id: number; name: string }[];
  languages: { code: string; name: string; films: number }[];
  keywords: string[];
  keywordFilms: Int32Array;
  regions: MovieMapRegion[];
  ids: Int32Array;
  titles: string[];
  years: Int16Array;
  x: Float32Array;
  y: Float32Array;
  votes: Int32Array;
  /** TMDB rating × 10. */
  rating: Uint8Array;
  /** Bit k set: the film has genres[k]. */
  genreBits: Int32Array;
  language: Int16Array;
  posters: string[];
  region: Int16Array;
  color: Int32Array;
  filmKeywords: number[][];
  similar: Int32Array;
  similarPerFilm: number;
  indexById: Map<number, number>;
  searchKeys: string[];
}

export const MAP_SIZE = 10000;

export function parseMovieMap(file: MovieMapFile): MovieMapData {
  const f = file.films;
  const count = f.id.length;
  const keywordFilms = new Int32Array(file.keywords.length);
  for (const list of f.keywords) for (const k of list) keywordFilms[k]++;
  return {
    generated: file.generated,
    count,
    size: MAP_SIZE,
    genres: file.genres.map(([id, name]) => ({ id, name })),
    languages: file.languages.map(([code, name, films]) => ({ code, name, films })),
    keywords: file.keywords,
    keywordFilms,
    regions: file.regions,
    ids: Int32Array.from(f.id),
    titles: f.title,
    years: Int16Array.from(f.year),
    x: Float32Array.from(f.x),
    y: Float32Array.from(f.y),
    votes: Int32Array.from(f.votes),
    rating: Uint8Array.from(f.rating),
    genreBits: Int32Array.from(f.genres),
    language: Int16Array.from(f.language),
    posters: f.poster,
    region: Int16Array.from(f.region),
    color: Int32Array.from(f.color),
    filmKeywords: f.keywords,
    similar: Int32Array.from(f.similar),
    similarPerFilm: file.similarPerFilm,
    indexById: new Map(f.id.map((id, i) => [id, i])),
    searchKeys: f.title.map(normalize),
  };
}

let loading: Promise<MovieMapData> | null = null;

/** Loads the map once per session: it's several megabytes. */
export function loadMovieMap(): Promise<MovieMapData> {
  loading ??= fetch('/movie-map/map.json')
    .then((res) => {
      if (!res.ok) throw new Error(`The movie map didn't load (${res.status})`);
      return res.json() as Promise<MovieMapFile>;
    })
    .then(parseMovieMap)
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** Lower case, no accents or punctuation: "Amélie" and "amelie" match. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Films whose title matches, best first: the whole title, then titles that
 * start with the query, then a word that does, then anywhere. Within each,
 * the most-voted film wins (a search for "alien" should find Alien).
 */
export function searchFilms(data: MovieMapData, query: string, limit = 8): number[] {
  const q = normalize(query);
  if (!q) return [];
  const ranked: [index: number, rank: number][] = [];
  for (let i = 0; i < data.count; i++) {
    const key = data.searchKeys[i];
    let rank = -1;
    if (key === q) rank = 0;
    else if (key.startsWith(q)) rank = 1;
    else if (key.includes(` ${q}`)) rank = 2;
    else if (key.includes(q)) rank = 3;
    if (rank >= 0) ranked.push([i, rank]);
  }
  ranked.sort((a, b) => a[1] - b[1] || data.votes[b[0]] - data.votes[a[0]]);
  return ranked.slice(0, limit).map(([i]) => i);
}

/** Themes (TMDB keywords) matching the query, the most common first. */
export function searchKeywords(data: MovieMapData, query: string, limit = 4): number[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const found: number[] = [];
  data.keywords.forEach((name, k) => {
    const key = normalize(name);
    if (key.startsWith(q) || key.includes(` ${q}`)) found.push(k);
  });
  return found.sort((a, b) => data.keywordFilms[b] - data.keywordFilms[a]).slice(0, limit);
}

export interface MapFilter {
  /** Indices into data.genres. */
  genres: number[];
  /** Indices into data.keywords. */
  keywords: number[];
  /** Whether a film needs any of the genres and keywords, or all of them. */
  match: 'any' | 'all';
  /** Index into data.languages, or null for every language. */
  language: number | null;
  /** First and last year, inclusive, or null for all of them. */
  years: [from: number, to: number] | null;
  /** Only these films (by index): the viewer's watchlist and history. */
  only: Set<number> | null;
}

export const NO_FILTER: MapFilter = { genres: [], keywords: [], match: 'any', language: null, years: null, only: null };

export function isFiltering(filter: MapFilter): boolean {
  return filter.genres.length > 0 || filter.keywords.length > 0 || filter.language !== null || filter.years !== null || filter.only !== null;
}

export function matchesFilter(data: MovieMapData, i: number, filter: MapFilter): boolean {
  if (filter.only && !filter.only.has(i)) return false;
  if (filter.language !== null && data.language[i] !== filter.language) return false;
  if (filter.years && (data.years[i] < filter.years[0] || data.years[i] > filter.years[1])) return false;
  const tags = filter.genres.length + filter.keywords.length;
  if (tags === 0) return true;
  const bits = data.genreBits[i];
  const keywords = data.filmKeywords[i];
  let hits = 0;
  for (const g of filter.genres) if (bits & (1 << g)) hits++;
  for (const k of filter.keywords) if (keywords.includes(k)) hits++;
  return filter.match === 'all' ? hits === tags : hits > 0;
}

/** 1 for each film the filter keeps, or null when there's no filter. */
export function filterFilms(data: MovieMapData, filter: MapFilter): Uint8Array | null {
  if (!isFiltering(filter)) return null;
  const out = new Uint8Array(data.count);
  for (let i = 0; i < data.count; i++) if (matchesFilter(data, i, filter)) out[i] = 1;
  return out;
}

/** The films most like this one, closest first. */
export function similarFilms(data: MovieMapData, i: number): number[] {
  return Array.from(data.similar.subarray(i * data.similarPerFilm, (i + 1) * data.similarPerFilm));
}

export function posterUrl(data: MovieMapData, i: number, size: 'w92' | 'w154' | 'w185' | 'w342'): string {
  return `https://image.tmdb.org/t/p/${size}/${data.posters[i]}.jpg`;
}

export function genreNames(data: MovieMapData, i: number): string[] {
  return data.genres.filter((_, k) => data.genreBits[i] & (1 << k)).map((g) => g.name);
}
