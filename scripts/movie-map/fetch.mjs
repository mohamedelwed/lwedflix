// Step 1 of the movie map: fetches every film the map will show, with the
// metadata its layout is computed from (genres, keywords, cast, crew,
// franchise), into .cache/movie-map/films.jsonl.
//
// A film qualifies with at least MIN_VOTES TMDB votes and a 40-minute
// runtime: about 35,000 films, every decade included. They're listed one
// release year at a time, because TMDB stops a listing at 500 pages.
//
// It resumes where it stopped: films already in the cache aren't fetched
// again. Delete .cache/movie-map/ to start over.
//
//   node scripts/movie-map/fetch.mjs

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_VOTES = 50;
const FIRST_YEAR = 1900;
const REQUESTS_PER_SECOND = 35; // TMDB allows about 50
const CONCURRENCY = 12;

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = join(rootDir, '.cache', 'movie-map');
const idsFile = join(cacheDir, 'ids.json');
const filmsFile = join(cacheDir, 'films.jsonl');

const { loadEnvConfig } = createRequire(join(rootDir, 'node_modules', 'next', 'package.json'))('@next/env');
loadEnvConfig(rootDir, false, { info() {}, error: console.error });
const BASE_URL = process.env.NEXT_PUBLIC_TMDB_BASE_URL || 'https://api.themoviedb.org/3';
if (!process.env.TMDB_ACCESS_TOKEN) {
  console.error('TMDB_ACCESS_TOKEN is not set (.env.local or the environment).');
  process.exit(1);
}
const headers = { accept: 'application/json', Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spaces requests out to REQUESTS_PER_SECOND, whatever the concurrency.
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / REQUESTS_PER_SECOND;
  if (at > now) await sleep(at - now);
}

async function tmdb(endpoint, params = {}) {
  for (let attempt = 1; ; attempt++) {
    await slot();
    let res;
    try {
      res = await fetch(`${BASE_URL}${endpoint}?${new URLSearchParams(params)}`, { headers });
    } catch (err) {
      if (attempt >= 5) throw err;
      await sleep(1000 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 1000 * attempt);
      continue;
    }
    throw new Error(`TMDB ${res.status} for ${endpoint}`);
  }
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) await worker(items[i++]);
  }));
}

async function listIds() {
  if (existsSync(idsFile)) return JSON.parse(readFileSync(idsFile, 'utf8'));
  const lastYear = new Date().getFullYear();
  const ids = new Set();
  const discover = (year, page) => tmdb('/discover/movie', {
    include_adult: 'false',
    include_video: 'false',
    'with_runtime.gte': '40',
    'vote_count.gte': String(MIN_VOTES),
    primary_release_year: String(year),
    sort_by: 'vote_count.desc',
    page: String(page),
  });
  const years = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, k) => FIRST_YEAR + k);
  await pool(years, async (year) => {
    const first = await discover(year, 1);
    first.results.forEach((m) => ids.add(m.id));
    const pages = Array.from({ length: Math.min(first.total_pages, 500) - 1 }, (_, k) => k + 2);
    for (const page of pages) (await discover(year, page)).results.forEach((m) => ids.add(m.id));
    if (year % 10 === 0) console.log(`listed ${year}s… ${ids.size} films so far`);
  });
  const list = [...ids];
  writeFileSync(idsFile, JSON.stringify(list));
  console.log(`${list.length} films qualify`);
  return list;
}

// Only what the map uses, plus the overview for later.
function compact(m) {
  const crew = (job) => m.credits.crew.filter((p) => p.job === job).map((p) => [p.id, p.name]);
  return {
    id: m.id,
    title: m.title,
    original_title: m.original_title,
    lang: m.original_language,
    date: m.release_date,
    runtime: m.runtime,
    genres: m.genres.map((g) => g.id),
    keywords: (m.keywords?.keywords ?? []).map((k) => [k.id, k.name]),
    cast: m.credits.cast.filter((p) => p.order < 8).map((p) => [p.id, p.name]),
    directors: crew('Director'),
    writers: [...crew('Screenplay'), ...crew('Writer'), ...crew('Novel')],
    composers: crew('Original Music Composer'),
    collection: m.belongs_to_collection?.id ?? null,
    countries: (m.production_countries ?? []).map((c) => c.iso_3166_1),
    popularity: m.popularity,
    rating: m.vote_average,
    votes: m.vote_count,
    poster: m.poster_path,
    overview: m.overview,
  };
}

mkdirSync(cacheDir, { recursive: true });
const ids = await listIds();
const have = new Set();
if (existsSync(filmsFile)) {
  for (const line of readFileSync(filmsFile, 'utf8').split('\n')) {
    if (line) have.add(JSON.parse(line).id);
  }
}
const todo = ids.filter((id) => !have.has(id));
console.log(`${have.size} cached, ${todo.length} to fetch`);

let done = 0;
const started = Date.now();
await pool(todo, async (id) => {
  const movie = await tmdb(`/movie/${id}`, { append_to_response: 'keywords,credits', language: 'en-US' });
  if (movie) appendFileSync(filmsFile, JSON.stringify(compact(movie)) + '\n');
  if (++done % 1000 === 0) {
    const rate = done / ((Date.now() - started) / 1000);
    console.log(`${done}/${todo.length} (${Math.round((todo.length - done) / rate / 60)} min left)`);
  }
});
console.log(`done: ${have.size + done} films in ${filmsFile}`);
