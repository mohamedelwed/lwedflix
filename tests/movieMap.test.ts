import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FILTER,
  filterFilms,
  normalize,
  parseMovieMap,
  searchFilms,
  searchKeywords,
  similarFilms,
  type MapFilter,
  type MovieMapFile,
} from '../src/lib/movieMap.ts';

// Genres: 0 Action, 1 Comedy, 2 Horror. Keywords: 0 alien, 1 space, 2 alien invasion.
const film = (title: string, year: number, votes: number, genres: number, language: number, keywords: number[]) =>
  ({ title, year, votes, genres, language, keywords });
const FILMS = [
  film('Alien', 1979, 15000, 0b101, 0, [0, 1]),
  film('Aliens', 1986, 9000, 0b001, 0, [0, 1]),
  film('Amélie', 2001, 11000, 0b010, 1, []),
  film('Mars Attacks!', 1996, 4000, 0b011, 0, [2]),
  film('Paul', 2011, 3000, 0b010, 0, [0]),
];

const file: MovieMapFile = {
  version: 1,
  generated: '2026-11-09',
  minVotes: 50,
  genres: [[28, 'Action'], [35, 'Comedy'], [27, 'Horror']],
  languages: [['en', 'English', 4], ['fr', 'French', 1]],
  keywords: ['alien', 'space', 'alien invasion'],
  regions: [],
  similarPerFilm: 2,
  films: {
    id: FILMS.map((_, i) => 100 + i),
    title: FILMS.map((f) => f.title),
    year: FILMS.map((f) => f.year),
    x: FILMS.map(() => 0),
    y: FILMS.map(() => 0),
    votes: FILMS.map((f) => f.votes),
    rating: FILMS.map(() => 70),
    genres: FILMS.map((f) => f.genres),
    language: FILMS.map((f) => f.language),
    poster: FILMS.map(() => 'abc'),
    region: FILMS.map(() => 0),
    color: FILMS.map(() => 0),
    keywords: FILMS.map((f) => f.keywords),
    similar: [1, 3, 0, 3, 4, 0, 0, 4, 3, 0],
  },
};
const data = parseMovieMap(file);
const titles = (indices: number[] | Uint8Array | null) =>
  indices === null ? null : indices instanceof Uint8Array
    ? FILMS.filter((_, i) => indices[i]).map((f) => f.title)
    : indices.map((i) => FILMS[i].title);
const filter = (changes: Partial<MapFilter>) => filterFilms(data, { ...NO_FILTER, ...changes });

test('titles match without accents, case or punctuation', () => {
  assert.equal(normalize('Amélie'), 'amelie');
  assert.equal(normalize('Mars Attacks!'), 'mars attacks');
  assert.deepEqual(titles(searchFilms(data, 'AMELIE')), ['Amélie']);
});

test('search puts the whole title first, then prefixes, then words, then anywhere', () => {
  assert.deepEqual(titles(searchFilms(data, 'alien')), ['Alien', 'Aliens']);
  assert.deepEqual(titles(searchFilms(data, 'attacks')), ['Mars Attacks!']);
  assert.deepEqual(titles(searchFilms(data, 'a')), ['Alien', 'Amélie', 'Aliens', 'Mars Attacks!', 'Paul']);
  assert.deepEqual(searchFilms(data, '  '), []);
});

test('themes are found by any word, the most common first', () => {
  assert.deepEqual(searchKeywords(data, 'alien').map((k) => data.keywords[k]), ['alien', 'alien invasion']);
  assert.deepEqual(searchKeywords(data, 'invasion').map((k) => data.keywords[k]), ['alien invasion']);
  assert.deepEqual(searchKeywords(data, 'a'), [], 'one letter is too little to suggest themes');
});

test('no filter means every film', () => {
  assert.equal(filterFilms(data, NO_FILTER), null);
});

test('genres and themes match any or all of them', () => {
  assert.deepEqual(titles(filter({ genres: [2], keywords: [2] })), ['Alien', 'Mars Attacks!']);
  assert.deepEqual(titles(filter({ genres: [0], keywords: [0], match: 'all' })), ['Alien', 'Aliens']);
  assert.deepEqual(titles(filter({ genres: [1], keywords: [0], match: 'all' })), ['Paul']);
});

test('language, years and the viewer\'s own films narrow everything else', () => {
  assert.deepEqual(titles(filter({ language: 1 })), ['Amélie']);
  assert.deepEqual(titles(filter({ years: [1980, 2000] })), ['Aliens', 'Mars Attacks!']);
  assert.deepEqual(titles(filter({ keywords: [0], years: [1980, 2020] })), ['Aliens', 'Paul']);
  assert.deepEqual(titles(filter({ only: new Set([2, 4]), genres: [1] })), ['Amélie', 'Paul']);
});

test('similar films come from the flattened list, per film', () => {
  assert.deepEqual(titles(similarFilms(data, 0)), ['Aliens', 'Mars Attacks!']);
  assert.deepEqual(titles(similarFilms(data, 4)), ['Mars Attacks!', 'Alien']);
  assert.equal(data.indexById.get(103), 3);
});
