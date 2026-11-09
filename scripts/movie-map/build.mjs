// Step 2 of the movie map: lays out the films fetched by fetch.mjs and writes
// public/movie-map/map.json, which the Movie Map page draws.
//
//   1. Each film becomes a vector: its genres, keywords, cast and crew,
//      franchise, language, countries and era, each block weighted so that
//      what a film is about counts for more than who made it or when.
//   2. PCA shrinks the vectors to 64 numbers. Each film's 150 closest by
//      those, plus every film sharing something rare with it (franchise,
//      director, cast, an uncommon keyword), are re-ranked by the full
//      vectors: that gives its similar films and the layout's graph.
//   3. UMAP lays the graph out in 2-D: similar films land close together.
//   4. k-means splits the map into regions, each named after what's most
//      over-represented in it, and coloured by where it sits on the map.
//
// Deterministic: the same films give the same map.
//
//   node scripts/movie-map/build.mjs

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const PCA_DIMS = 64;
const CANDIDATES = 150;
const SIMILAR = 12; // shipped per film
const GRAPH_NEIGHBOURS = 15; // for the layout
const REGIONS = 42;
// How much a suggestion loses for being less known than the film it's for,
// per full range of vote counts: Heat should suggest Collateral before a
// crime film with 60 votes, while an obscure film can still suggest Heat.
const LESS_KNOWN_PENALTY = 0.2;

// Weight of each block of a film's vector (each block is normalised first).
const WEIGHTS = {
  genre: 1.0,
  keyword: 1.15,
  people: 0.65,
  collection: 0.9,
  language: 0.75,
  country: 0.3,
  year: 0.6,
  numbers: 0.22, // runtime, votes, rating
};

// Keywords about the release rather than the film.
const IGNORED_KEYWORDS = new Set([
  'duringcreditsstinger', 'aftercreditsstinger', 'woman director', '3d', 'imax',
  'sequel', 'remake', 'live action remake', 'reboot', 'prequel', 'spin off', 'short film',
  'independent film', 'black and white', 'silent film', 'pre-code', 'cult film', 'anthology',
]);

const GENRES = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'],
  [99, 'Documentary'], [18, 'Drama'], [10751, 'Family'], [14, 'Fantasy'], [36, 'History'],
  [27, 'Horror'], [10402, 'Music'], [9648, 'Mystery'], [10749, 'Romance'], [878, 'Science Fiction'],
  [10770, 'TV Movie'], [53, 'Thriller'], [10752, 'War'], [37, 'Western'],
];

// --- 1. vectors -------------------------------------------------------------

function loadFilms(rootDir) {
  const lines = readFileSync(join(rootDir, '.cache', 'movie-map', 'films.jsonl'), 'utf8').split('\n');
  const byId = new Map();
  for (const line of lines) {
    let f;
    try { f = JSON.parse(line); } catch { continue; } // a line still being written
    if (!f) continue;
    if (f.poster && f.date && f.runtime >= 40) byId.set(f.id, f);
  }
  return [...byId.values()].sort((a, b) => b.votes - a.votes);
}

/** Counts how many films each token appears in, and keeps the common ones. */
function vocabulary(films, tokensOf, minFilms, max) {
  const df = new Map();
  for (const f of films) for (const t of new Set(tokensOf(f))) df.set(t, (df.get(t) ?? 0) + 1);
  return new Map([...df].filter(([, n]) => n >= minFilms).sort((a, b) => b[1] - a[1]).slice(0, max));
}

function buildVectors(films) {
  const n = films.length;
  const keywordTokens = (f) => f.keywords.filter(([, name]) => !IGNORED_KEYWORDS.has(name)).map(([id]) => id);
  const peopleTokens = (f) => [
    ...f.directors.map(([id]) => `d${id}`),
    ...f.writers.map(([id]) => `w${id}`),
    ...f.cast.slice(0, 6).map(([id]) => `c${id}`),
    ...f.composers.map(([id]) => `m${id}`),
  ];
  const vocabs = {
    keyword: vocabulary(films, keywordTokens, 12, 1600),
    people: vocabulary(films, peopleTokens, 4, 3000),
    collection: vocabulary(films, (f) => (f.collection ? [f.collection] : []), 2, 1e9),
    language: vocabulary(films, (f) => [f.lang], 25, 40),
    country: vocabulary(films, (f) => f.countries, 40, 40),
  };

  // Column offsets for each block.
  const index = {};
  let dims = 0;
  index.genre = new Map(GENRES.map(([id], k) => [id, dims + k]));
  dims += GENRES.length;
  for (const block of ['keyword', 'people', 'collection', 'language', 'country']) {
    index[block] = new Map([...vocabs[block].keys()].map((t, k) => [t, dims + k]));
    dims += vocabs[block].size;
  }
  const yearCol = dims++;
  const numberCols = [dims++, dims++, dims++];

  const idf = (block, t) => Math.log(n / vocabs[block].get(t));
  const year = (f) => Number(f.date.slice(0, 4));
  const stats = (values) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;
    return (v) => Math.max(-3, Math.min(3, (v - mean) / sd)) / 3;
  };
  const zYear = stats(films.map(year));
  const zRuntime = stats(films.map((f) => Math.log(f.runtime)));
  const zVotes = stats(films.map((f) => Math.log(f.votes)));
  const zRating = stats(films.map((f) => f.rating));

  const rows = films.map((f) => {
    const entries = new Map();
    const addBlock = (weight, pairs) => {
      const norm = Math.sqrt(pairs.reduce((s, [, v]) => s + v * v, 0));
      if (!norm) return;
      for (const [col, v] of pairs) entries.set(col, (entries.get(col) ?? 0) + (weight * v) / norm);
    };
    addBlock(WEIGHTS.genre, f.genres.filter((g) => index.genre.has(g)).map((g) => [index.genre.get(g), 1]));
    addBlock(WEIGHTS.keyword, [...new Set(keywordTokens(f))].filter((t) => index.keyword.has(t)).map((t) => [index.keyword.get(t), idf('keyword', t)]));
    addBlock(WEIGHTS.people, [...new Set(peopleTokens(f))].filter((t) => index.people.has(t)).map((t) => [index.people.get(t), idf('people', t)]));
    if (index.collection.has(f.collection)) addBlock(WEIGHTS.collection, [[index.collection.get(f.collection), 1]]);
    if (index.language.has(f.lang)) addBlock(WEIGHTS.language, [[index.language.get(f.lang), 1]]);
    addBlock(WEIGHTS.country, f.countries.filter((c) => index.country.has(c)).map((c) => [index.country.get(c), 1]));
    entries.set(yearCol, WEIGHTS.year * zYear(year(f)));
    entries.set(numberCols[0], WEIGHTS.numbers * zRuntime(Math.log(f.runtime)));
    entries.set(numberCols[1], WEIGHTS.numbers * zVotes(Math.log(f.votes)));
    entries.set(numberCols[2], WEIGHTS.numbers * zRating(f.rating));

    const sorted = [...entries].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
    const norm = Math.sqrt(sorted.reduce((s, [, v]) => s + v * v, 0));
    return {
      idx: Int32Array.from(sorted, ([c]) => c),
      val: Float64Array.from(sorted, ([, v]) => v / norm),
    };
  });
  // Columns rare enough that sharing one is a strong link, but carrying too
  // little variance for PCA to keep.
  const rareColumns = new Set([
    ...index.collection.values(),
    ...[...index.people].filter(([t]) => vocabs.people.get(t) <= 80).map(([, c]) => c),
    ...[...index.keyword].filter(([t]) => vocabs.keyword.get(t) <= 150).map(([, c]) => c),
  ]);
  return { rows, dims, vocabs, rareColumns };
}

// --- 2. PCA and neighbours ----------------------------------------------------

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
}

/** Gram-Schmidt on the columns of a rows×cols row-major matrix, in place. */
function orthonormalize(M, rows, cols) {
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < cols; c++) {
      for (let p = 0; p < c; p++) {
        let dot = 0;
        for (let r = 0; r < rows; r++) dot += M[r * cols + c] * M[r * cols + p];
        for (let r = 0; r < rows; r++) M[r * cols + c] -= dot * M[r * cols + p];
      }
      let norm = 0;
      for (let r = 0; r < rows; r++) norm += M[r * cols + c] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let r = 0; r < rows; r++) M[r * cols + c] /= norm;
    }
  }
}

/** Eigen-decomposition of a symmetric size×size matrix (cyclic Jacobi). */
function symmetricEigen(A, size) {
  const a = Float64Array.from(A);
  const v = new Float64Array(size * size);
  for (let i = 0; i < size; i++) v[i * size + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < size; p++) for (let q = p + 1; q < size; q++) off += a[p * size + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < size; p++) {
      for (let q = p + 1; q < size; q++) {
        const apq = a[p * size + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (a[q * size + q] - a[p * size + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < size; k++) {
          const akp = a[k * size + p], akq = a[k * size + q];
          a[k * size + p] = c * akp - s * akq;
          a[k * size + q] = s * akp + c * akq;
        }
        for (let k = 0; k < size; k++) {
          const apk = a[p * size + k], aqk = a[q * size + k];
          a[p * size + k] = c * apk - s * aqk;
          a[q * size + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < size; k++) {
          const vkp = v[k * size + p], vkq = v[k * size + q];
          v[k * size + p] = c * vkp - s * vkq;
          v[k * size + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [...Array(size).keys()].sort((i, j) => a[j * size + j] - a[i * size + i]);
  return { values: order.map((i) => a[i * size + i]), vectors: v, order };
}

/** Randomised PCA of the (implicitly centred) sparse rows: n×k scores. */
function pca(rows, dims, k, rng) {
  const n = rows.length;
  const l = k + 16;
  const mean = new Float64Array(dims);
  for (const r of rows) for (let t = 0; t < r.idx.length; t++) mean[r.idx[t]] += r.val[t];
  for (let d = 0; d < dims; d++) mean[d] /= n;

  const times = (M) => { // centred X · M (dims×l) → n×l
    const out = new Float64Array(n * l);
    const shift = new Float64Array(l);
    for (let d = 0; d < dims; d++) for (let c = 0; c < l; c++) shift[c] += mean[d] * M[d * l + c];
    rows.forEach((r, i) => {
      for (let t = 0; t < r.idx.length; t++) {
        const d = r.idx[t], v = r.val[t];
        for (let c = 0; c < l; c++) out[i * l + c] += v * M[d * l + c];
      }
      for (let c = 0; c < l; c++) out[i * l + c] -= shift[c];
    });
    return out;
  };
  const transposeTimes = (Y) => { // centred Xᵀ · Y (n×l) → dims×l
    const out = new Float64Array(dims * l);
    const colSum = new Float64Array(l);
    rows.forEach((r, i) => {
      for (let c = 0; c < l; c++) colSum[c] += Y[i * l + c];
      for (let t = 0; t < r.idx.length; t++) {
        const d = r.idx[t], v = r.val[t];
        for (let c = 0; c < l; c++) out[d * l + c] += v * Y[i * l + c];
      }
    });
    for (let d = 0; d < dims; d++) for (let c = 0; c < l; c++) out[d * l + c] -= mean[d] * colSum[c];
    return out;
  };

  const omega = Float64Array.from({ length: dims * l }, () => gaussian(rng));
  let Y = times(omega);
  orthonormalize(Y, n, l);
  for (let q = 0; q < 4; q++) {
    const W = transposeTimes(Y);
    orthonormalize(W, dims, l);
    Y = times(W);
    orthonormalize(Y, n, l);
  }
  const Bt = transposeTimes(Y); // (Qᵀ X)ᵀ
  const C = new Float64Array(l * l);
  for (let a = 0; a < l; a++) {
    for (let b = a; b < l; b++) {
      let s = 0;
      for (let d = 0; d < dims; d++) s += Bt[d * l + a] * Bt[d * l + b];
      C[a * l + b] = C[b * l + a] = s;
    }
  }
  const { values, vectors, order } = symmetricEigen(C, l);
  let total = 0;
  for (const r of rows) {
    // ‖x − mean‖² = ‖x‖² − 2 x·mean + ‖mean‖²
    let dot = 0;
    for (let t = 0; t < r.idx.length; t++) dot += r.val[t] * mean[r.idx[t]];
    total += 1 - 2 * dot;
  }
  total += n * mean.reduce((s, m) => s + m * m, 0);
  const kept = values.slice(0, k).reduce((s, v) => s + v, 0) / total;

  const Z = new Float32Array(n * k);
  for (let j = 0; j < k; j++) {
    const col = order[j];
    const sigma = Math.sqrt(Math.max(values[j], 0));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let a = 0; a < l; a++) s += Y[i * l + a] * vectors[a * l + col];
      Z[i * k + j] = s * sigma;
    }
  }
  return { Z, kept };
}

/** Worker: the CANDIDATES nearest rows (squared distance in Z) for a slice. */
function nearestWorker() {
  const { buffer, n, dims, from, to, k } = workerData;
  const Z = new Float32Array(buffer);
  const idx = new Int32Array((to - from) * k);
  const bestD = new Float64Array(k);
  const bestI = new Int32Array(k);
  for (let i = from; i < to; i++) {
    let count = 0;
    let worst = Infinity;
    let worstAt = 0;
    const oi = i * dims;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const oj = j * dims;
      let d = 0;
      for (let t = 0; t < dims; t++) {
        const diff = Z[oi + t] - Z[oj + t];
        d += diff * diff;
        if ((t & 15) === 15 && d >= worst) break;
      }
      if (count < k) {
        bestD[count] = d;
        bestI[count] = j;
        if (++count === k) {
          worst = -1;
          for (let s = 0; s < k; s++) if (bestD[s] > worst) { worst = bestD[s]; worstAt = s; }
        }
      } else if (d < worst) {
        bestD[worstAt] = d;
        bestI[worstAt] = j;
        worst = -1;
        for (let s = 0; s < k; s++) if (bestD[s] > worst) { worst = bestD[s]; worstAt = s; }
      }
    }
    idx.set(bestI, (i - from) * k);
  }
  parentPort.postMessage(idx, [idx.buffer]);
}

async function candidates(Z, n, dims, k) {
  const buffer = new SharedArrayBuffer(Z.byteLength);
  new Float32Array(buffer).set(Z);
  const threads = Math.max(1, availableParallelism() - 1);
  const chunk = Math.ceil(n / threads);
  const parts = await Promise.all(Array.from({ length: threads }, (_, w) => {
    const from = w * chunk;
    const to = Math.min(n, from + chunk);
    if (from >= to) return new Int32Array(0);
    return new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { buffer, n, dims, from, to, k } });
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  }));
  const out = new Int32Array(n * k);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0, j = 0; i < a.idx.length && j < b.idx.length;) {
    if (a.idx[i] === b.idx[j]) s += a.val[i++] * b.val[j++];
    else if (a.idx[i] < b.idx[j]) i++;
    else j++;
  }
  return s;
}

// --- 4. regions ---------------------------------------------------------------

function kMeans(xs, ys, k, rng) {
  const n = xs.length;
  // k-means++ seeding
  const cx = [], cy = [];
  const first = Math.floor(rng() * n);
  cx.push(xs[first]); cy.push(ys[first]);
  const d2 = new Float64Array(n).fill(Infinity);
  while (cx.length < k) {
    const c = cx.length - 1;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      d2[i] = Math.min(d2[i], (xs[i] - cx[c]) ** 2 + (ys[i] - cy[c]) ** 2);
      sum += d2[i];
    }
    let r = rng() * sum;
    let pick = 0;
    for (; pick < n - 1 && (r -= d2[pick]) > 0; pick++);
    cx.push(xs[pick]); cy.push(ys[pick]);
  }
  const label = new Int32Array(n);
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (xs[i] - cx[c]) ** 2 + (ys[i] - cy[c]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      label[i] = best;
    }
    const sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Float64Array(k);
    for (let i = 0; i < n; i++) { sx[label[i]] += xs[i]; sy[label[i]] += ys[i]; cnt[label[i]]++; }
    for (let c = 0; c < k; c++) if (cnt[c]) { cx[c] = sx[c] / cnt[c]; cy[c] = sy[c] / cnt[c]; }
  }
  return label;
}

/** OKLCH → sRGB, clamped. */
function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  });
}

const titleCase = (s) => s.replace(/(^|[\s-])(\p{Ll})/gu, (_m, sep, ch) => sep + ch.toUpperCase());

// --- main ---------------------------------------------------------------------

async function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const t0 = Date.now();
  const lap = (what) => console.log(`${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const rng = mulberry32(20261109);

  const films = loadFilms(rootDir);
  const n = films.length;
  const { rows, dims, vocabs, rareColumns } = buildVectors(films);
  lap(`${n} films, ${dims} features`);

  const { Z, kept } = pca(rows, dims, PCA_DIMS, rng);
  lap(`PCA: ${PCA_DIMS} dims keep ${(kept * 100).toFixed(0)}% of the variance`);

  const cand = await candidates(Z, n, PCA_DIMS, CANDIDATES);
  lap('candidate neighbours');

  // Exact re-rank by the full vectors, of PCA's candidates and of every
  // film sharing a rare column.
  const postings = new Map();
  rows.forEach((r, i) => r.idx.forEach((c) => {
    if (!rareColumns.has(c)) return;
    if (!postings.has(c)) postings.set(c, []);
    postings.get(c).push(i);
  }));
  const logVotes = films.map((f) => Math.log(f.votes));
  const voteRange = Math.max(...logVotes) - Math.min(...logVotes) || 1;
  const neighbours = new Int32Array(n * 20);
  const graphIdx = [], graphDist = [];
  for (let i = 0; i < n; i++) {
    const pool = new Set(cand.subarray(i * CANDIDATES, (i + 1) * CANDIDATES));
    for (const c of rows[i].idx) for (const j of postings.get(c) ?? []) if (j !== i) pool.add(j);
    const ranked = Array.from(pool, (j) => [j, cosine(rows[i], rows[j])]).sort((a, b) => b[1] - a[1]);
    const suggested = ranked.slice(0, 80)
      .map(([j, sim]) => [j, sim - LESS_KNOWN_PENALTY * Math.max(0, logVotes[i] - logVotes[j]) / voteRange])
      .sort((a, b) => b[1] - a[1]);
    for (let s = 0; s < 20; s++) neighbours[i * 20 + s] = suggested[s][0];
    graphIdx.push([i, ...ranked.slice(0, GRAPH_NEIGHBOURS - 1).map(([j]) => j)]);
    graphDist.push([0, ...ranked.slice(0, GRAPH_NEIGHBOURS - 1).map(([, s]) => Math.max(0, 1 - s))]);
  }
  lap('similar films');

  // --- 3. layout
  const { UMAP } = await import('umap-js');
  const umap = new UMAP({ nComponents: 2, nNeighbors: GRAPH_NEIGHBOURS, minDist: 0.35, spread: 1.0, nEpochs: 400, random: rng });
  umap.setPrecomputedKNN(graphIdx, graphDist);
  const data = Array.from({ length: n }, (_, i) => Array.from(Z.subarray(i * PCA_DIMS, i * PCA_DIMS + 2)));
  const epochs = umap.initializeFit(data);
  // Start from the first two principal components rather than at random,
  // so the map's large-scale arrangement means something too.
  let maxAbs = 0;
  for (const p of data) maxAbs = Math.max(maxAbs, Math.abs(p[0]), Math.abs(p[1]));
  umap.getEmbedding().forEach((p, i) => { p[0] = (data[i][0] / maxAbs) * 10; p[1] = (data[i][1] / maxAbs) * 10; });
  for (let e = 0; e < epochs; e++) umap.step();
  const embedding = umap.getEmbedding();
  lap(`UMAP (${epochs} epochs)`);

  // Widest along x (for a wide window), then scaled to 0–10000.
  let mx = 0, my = 0;
  for (const [x, y] of embedding) { mx += x / n; my += y / n; }
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of embedding) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let xs = embedding.map(([x, y]) => (x - mx) * cos - (y - my) * sin);
  let ys = embedding.map(([x, y]) => (x - mx) * sin + (y - my) * cos);
  // UMAP leaves wide gaps between islands (films in other languages, say),
  // which shrink the continents to specks. Blending each axis with its
  // rank evens the density out without reordering anything.
  const spreadOut = (values, share) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const lo = order[Math.floor(n * 0.001)][0], hi = order[Math.floor(n * 0.999)][0];
    const out = new Array(n);
    order.forEach(([v, i], rank) => {
      const linear = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      out[i] = share * (rank / (n - 1)) + (1 - share) * linear;
    });
    return out;
  };
  const RANK_SHARE = 0.55;
  const spreadX = spreadOut(xs, RANK_SHARE), spreadY = spreadOut(ys, RANK_SHARE);
  // Keep the wider axis wider: the x axis spans the window.
  const aspect = Math.sqrt(sxx / syy) > 1.15 ? 0.78 : 1;
  xs = spreadX.map((v) => Math.round(v * 10000));
  ys = spreadY.map((v) => Math.round((0.5 + (v - 0.5) * aspect) * 10000));

  // --- 4. regions, names, colours
  const region = kMeans(xs, ys, REGIONS, rng);
  const termsOf = (f) => [
    ...f.keywords.filter(([, name]) => !IGNORED_KEYWORDS.has(name)).map(([id, name]) => (vocabs.keyword.has(id) ? `k:${titleCase(name)}` : null)).filter(Boolean),
    ...f.genres.map((g) => `g:${GENRES.find(([id]) => id === g)?.[1]}`),
    ...(f.lang !== 'en' && vocabs.language.has(f.lang) ? [`l:${f.lang}`] : []),
  ];
  const df = new Map();
  films.forEach((f) => new Set(termsOf(f)).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
  // TMDB's own codes that aren't ISO 639-1, so Intl doesn't know them.
  const TMDB_LANGUAGES = { cn: 'Cantonese', xx: 'No language', sh: 'Serbo-Croatian' };
  const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
  const languageName = { of: (code) => TMDB_LANGUAGES[code] ?? displayNames.of(code) };
  const termName = (t) => (t.startsWith('l:') ? `${languageName.of(t.slice(2))} cinema` : t.slice(2));
  // "Korean cinema" and "South Korea" say the same thing.
  const stems = (name) => name.toLowerCase().replace(/\bcinema\b/g, '').split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
  const overlaps = (a, b) => stems(termName(a)).some((stem) => stems(termName(b)).includes(stem));

  const regions = Array.from({ length: REGIONS }, () => ({ members: [], x: 0, y: 0 }));
  films.forEach((_, i) => regions[region[i]].members.push(i));
  for (const r of regions) {
    if (!r.members.length) { r.label = ''; continue; }
    r.x = Math.round(r.members.reduce((s, i) => s + xs[i], 0) / r.members.length);
    r.y = Math.round(r.members.reduce((s, i) => s + ys[i], 0) / r.members.length);
    const counts = new Map();
    for (const i of r.members) new Set(termsOf(films[i])).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
    const size = r.members.length;
    const scored = [...counts]
      // A name has to fit a good share of the region, not just be rare elsewhere.
      .filter(([t, c]) => c >= Math.max(4, size * 0.12) && (t.startsWith('k:') || t.startsWith('l:') || t.startsWith('g:')))
      .map(([t, c]) => {
        const share = c / size;
        const lift = share / (df.get(t) / n);
        return [t, share * Math.log(lift) * (t.startsWith('g:') ? 0.8 : 1)];
      })
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const [t] of scored) {
      if (picked.length === 2) break;
      if (picked.some((p) => overlaps(p, t))) continue;
      picked.push(t);
    }
    r.label = picked.map(termName).join(' · ') || 'Drama';
  }
  // Hue from each region's direction from the centre of the map.
  const hues = regions.map((r) => ((Math.atan2(r.y - 5000, r.x - 5000) * 180) / Math.PI + 360 + 25) % 360);
  const regionRgb = hues.map((h) => oklch(0.76, 0.13, h));
  // Each film's colour leans towards its neighbours', so borders blend.
  const colours = films.map((_, i) => {
    const mix = [0, 0, 0];
    const own = regionRgb[region[i]];
    for (let c = 0; c < 3; c++) mix[c] += own[c] * 3;
    for (let s = 0; s < 8; s++) {
      const rgb = regionRgb[region[neighbours[i * 20 + s]]];
      for (let c = 0; c < 3; c++) mix[c] += rgb[c];
    }
    return (Math.round(mix[0] / 11) << 16) | (Math.round(mix[1] / 11) << 8) | Math.round(mix[2] / 11);
  });
  lap('regions');

  // --- output
  const keywordList = [...vocabs.keyword.keys()];
  const keywordIndex = new Map(keywordList.map((id, k) => [id, k]));
  const keywordNames = new Map();
  films.forEach((f) => f.keywords.forEach(([id, name]) => keywordNames.set(id, name)));
  const languageList = [...vocabulary(films, (f) => [f.lang], 1, 1e9)];
  const languageIndex = new Map(languageList.map(([code], k) => [code, k]));
  const genreBit = new Map(GENRES.map(([id], k) => [id, k]));

  const map = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    minVotes: 50,
    genres: GENRES.map(([id, name]) => [id, name]),
    languages: languageList.map(([code, count]) => [code, languageName.of(code) ?? code, count]),
    keywords: keywordList.map((id) => keywordNames.get(id)),
    regions: regions.map((r, k) => ({ label: r.label, x: r.x, y: r.y, size: r.members.length, color: `#${regionRgb[k].map((c) => c.toString(16).padStart(2, '0')).join('')}` })),
    similarPerFilm: SIMILAR,
    films: {
      id: films.map((f) => f.id),
      title: films.map((f) => f.title),
      year: films.map((f) => Number(f.date.slice(0, 4))),
      x: xs,
      y: ys,
      votes: films.map((f) => f.votes),
      rating: films.map((f) => Math.round(f.rating * 10)),
      genres: films.map((f) => f.genres.reduce((mask, g) => (genreBit.has(g) ? mask | (1 << genreBit.get(g)) : mask), 0)),
      language: films.map((f) => languageIndex.get(f.lang)),
      poster: films.map((f) => f.poster.replace(/^\//, '').replace(/\.jpg$/, '')),
      region: Array.from(region),
      color: colours,
      keywords: films.map((f) => f.keywords.map(([id]) => keywordIndex.get(id)).filter((k) => k !== undefined)),
      similar: Array.from(neighbours.filter((_, k) => k % 20 < SIMILAR)),
    },
  };
  const out = join(rootDir, 'public', 'movie-map', 'map.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(map));
  lap(`wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  for (const r of [...regions].sort((a, b) => b.members.length - a.members.length)) {
    console.log(`  ${String(r.members.length).padStart(5)}  ${r.label}  — e.g. ${r.members.slice(0, 3).map((i) => films[i].title).join(', ')}`);
  }
}

if (!isMainThread) nearestWorker();
else await main();
