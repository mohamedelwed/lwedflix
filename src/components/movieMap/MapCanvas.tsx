'use client';

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Star } from 'lucide-react';
import { MAP_SIZE, posterUrl, similarFilms, type MovieMapData } from '@/lib/movieMap';

export interface MapCanvasHandle {
  /** Glides to a film, zooming in if the map is zoomed out. */
  flyTo: (film: number) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
}

interface MapCanvasProps {
  data: MovieMapData;
  /** 1 for each film the filters keep; null shows every film. */
  matches: Uint8Array | null;
  selected: number | null;
  /** A film pointed at elsewhere (the panel's list), ringed on the map. */
  highlighted: number | null;
  labels: boolean;
  /** Width covered by the film panel on the right, kept clear when centring. */
  rightInset: number;
  /** Shown first, centred, instead of the whole map. */
  initialFilm: number | null;
  /** Height of the controls over the top of the map, left clear when fitting it. */
  topInset: number;
  /** Elements over the map that labels keep out from under. */
  avoid: React.RefObject<HTMLElement | null>[];
  onSelect: (film: number | null) => void;
  ref?: React.Ref<MapCanvasHandle>;
}

interface Camera {
  /** The map point at the centre of the view. */
  x: number;
  y: number;
  /** Screen pixels per map unit. */
  k: number;
}

const TAU = Math.PI * 2;
const FOCUS_ZOOM = 9; // times the whole-map zoom, when going to a film
const MAX_ZOOM = 220;
const MIN_ZOOM = 0.7;
const CELL = 50; // hit-testing grid, in map units

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** What drawing needs, worked out once per map. */
function prepare(data: MovieMapData) {
  // Films grouped by colour (5 bits a channel), so each colour is set once
  // a frame rather than once a film.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < data.count; i++) {
    const c = data.color[i];
    const q = (((c >> 19) & 31) << 10) | (((c >> 11) & 31) << 5) | ((c >> 3) & 31);
    let list = groups.get(q);
    if (!list) groups.set(q, (list = []));
    list.push(i);
  }
  const channel = (v: number) => Math.round((v * 255) / 31);
  const buckets = [...groups].map(([q, films]) => ({
    css: `rgb(${channel((q >> 10) & 31)},${channel((q >> 5) & 31)},${channel(q & 31)})`,
    films: Int32Array.from(films),
  }));

  // Better-known films are drawn a little larger.
  let maxVotes = 1;
  for (let i = 0; i < data.count; i++) maxVotes = Math.max(maxVotes, data.votes[i]);
  const lo = Math.log(50);
  const span = Math.log(maxVotes) - lo || 1;
  const weight = new Float32Array(data.count);
  for (let i = 0; i < data.count; i++) weight[i] = 0.7 + 0.9 * clamp((Math.log(data.votes[i]) - lo) / span, 0, 1);

  // Films by grid cell, for finding the one under the pointer.
  const cols = Math.ceil(MAP_SIZE / CELL) + 1;
  const cellOf = (i: number) => Math.floor(data.y[i] / CELL) * cols + Math.floor(data.x[i] / CELL);
  const start = new Int32Array(cols * cols + 1);
  for (let i = 0; i < data.count; i++) start[cellOf(i) + 1]++;
  for (let c = 0; c < cols * cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1);
  const cells = new Int32Array(data.count);
  for (let i = 0; i < data.count; i++) cells[fill[cellOf(i)]++] = i;

  return { buckets, weight, grid: { cols, start, cells } };
}

export default function MapCanvas({ data, matches, selected, highlighted, labels, rightInset, initialFilm, topInset, avoid, onSelect, ref }: MapCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, k: 0.1 });
  const view = useRef({ w: 0, h: 0, dpr: 1, fitK: 0.1 });
  const anim = useRef<{ from: Camera; to: Camera; start: number; duration: number } | null>(null);
  const frame = useRef(0);
  const font = useRef('system-ui, sans-serif');
  const [hovered, setHovered] = useState<number | null>(null);
  // The latest props and hover, for drawing and event handlers.
  const live = useRef({ matches, selected, highlighted, labels, rightInset, avoid, onSelect, hovered: null as number | null });
  const prepared = useMemo(() => prepare(data), [data]);
  // Measured title widths, by film: measuring is the slow part of labels.
  const titleWidths = useRef<{ data: MovieMapData; widths: Map<number, number> } | null>(null);

  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const { w, h, dpr, fitK } = view.current;
    const { x: cx, y: cy, k } = cam.current;
    const { matches, selected, highlighted, labels, hovered } = live.current;
    const { buckets, weight } = prepared;
    if (titleWidths.current?.data !== data) titleWidths.current = { data, widths: new Map() };
    const widths = titleWidths.current.widths;
    const zoom = k / fitK;
    const px = (x: number) => (x - cx) * k + w / 2;
    const py = (y: number) => (y - cy) * k + h / 2;
    const r = clamp(1.15 * Math.sqrt(zoom), 1.1, 7);
    const margin = 12 / k;
    const x0 = cx - w / 2 / k - margin, x1 = cx + w / 2 / k + margin;
    const y0 = cy - h / 2 / k - margin, y1 = cy + h / 2 / k + margin;
    const visible = (i: number) => data.x[i] >= x0 && data.x[i] <= x1 && data.y[i] >= y0 && data.y[i] <= y1;
    // Filtered films stand out: bigger, over a dimmed map.
    const size = (i: number) => (matches && matches[i] ? Math.max(2.2, r * weight[i] * 1.5) : r * weight[i]);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Zoomed out, overlapping films add up to light, so the dense parts glow.
    // Each one is fainter the more films share a pixel, so a small window
    // doesn't burn the middle of the map to white.
    const glow = zoom < 3;
    const perPixel = data.count / (MAP_SIZE * k) ** 2;
    ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
    for (const pass of matches ? [0, 1] : [1]) {
      ctx.globalAlpha = pass === 0 ? 0.07 : matches ? 1 : glow ? clamp(0.11 / Math.sqrt(perPixel), 0.22, 0.9) : 0.95;
      for (const bucket of buckets) {
        ctx.fillStyle = bucket.css;
        if (r < 2.4) {
          for (const i of bucket.films) {
            if ((matches && matches[i] !== pass) || !visible(i)) continue;
            const s = size(i);
            ctx.fillRect(px(data.x[i]) - s, py(data.y[i]) - s, s * 2, s * 2);
          }
        } else {
          ctx.beginPath();
          for (const i of bucket.films) {
            if ((matches && matches[i] !== pass) || !visible(i)) continue;
            const s = size(i), X = px(data.x[i]), Y = py(data.y[i]);
            ctx.moveTo(X + s, Y);
            ctx.arc(X, Y, s, 0, TAU);
          }
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const ring = (i: number, color: string, extra: number, width = 1.5) => {
      ctx.beginPath();
      ctx.arc(px(data.x[i]), py(data.y[i]), size(i) + extra, 0, TAU);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const similar = selected !== null ? similarFilms(data, selected) : [];
    if (selected !== null) {
      ctx.beginPath();
      for (const j of similar) {
        ctx.moveTo(px(data.x[selected]), py(data.y[selected]));
        ctx.lineTo(px(data.x[j]), py(data.y[j]));
      }
      ctx.strokeStyle = 'rgba(255,153,0,0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      for (const j of similar) ring(j, 'rgba(255,153,0,0.95)', 2.5);
      ctx.beginPath();
      ctx.arc(px(data.x[selected]), py(data.y[selected]), size(selected) + 1.5, 0, TAU);
      ctx.fillStyle = '#ff9900';
      ctx.fill();
      ring(selected, '#fff', 4, 2);
    }
    if (highlighted !== null) ring(highlighted, '#fff', 4.5, 2);
    if (hovered !== null) ring(hovered, '#fff', 3, 1.5);

    // Labels: never on top of each other, the best-known films first.
    const taken: number[][] = [];
    const origin = el.getBoundingClientRect();
    for (const box of live.current.avoid) {
      const b = box.current?.getBoundingClientRect();
      if (b) taken.push([b.left - origin.left - 6, b.top - origin.top - 6, b.right - origin.left + 6, b.bottom - origin.top + 6]);
    }
    const place = (left: number, top: number, width: number, height: number) => {
      const right = left + width, bottom = top + height;
      if (taken.some(([l, t, rr, b]) => left < rr && right > l && top < b && bottom > t)) return false;
      taken.push([left, top, right, bottom]);
      return true;
    };
    const text = (s: string, x: number, y: number, color: string) => {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(10,10,10,0.9)';
      ctx.strokeText(s, x, y);
      ctx.fillStyle = color;
      ctx.fillText(s, x, y);
    };
    ctx.textBaseline = 'middle';
    const filmFont = `600 11.5px ${font.current}`;
    const filmLabel = (i: number, color: string) => {
      ctx.font = filmFont;
      let width = widths.get(i);
      if (width === undefined) widths.set(i, (width = ctx.measureText(data.titles[i]).width));
      const X = px(data.x[i]) + size(i) + 5, Y = py(data.y[i]);
      if (!place(X - 2, Y - 8, width + 4, 16)) return false;
      ctx.textAlign = 'left';
      text(data.titles[i], X, Y, color);
      return true;
    };
    if (selected !== null) {
      filmLabel(selected, '#fff');
      for (const j of similar) if (visible(j)) filmLabel(j, '#ffc266');
    }
    if (labels) {
      const regionAlpha = clamp((5 - zoom) / 2.5, 0, 1);
      if (regionAlpha > 0) {
        ctx.font = `700 13px ${font.current}`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = regionAlpha * (matches ? 0.55 : 1);
        const regions = data.regions.map((g, n) => [g, n] as const).filter(([g]) => g.size > 0).sort((a, b) => b[0].size - a[0].size);
        for (const [g] of regions) {
          const width = ctx.measureText(g.label).width;
          const X = px(g.x), Y = py(g.y);
          if (place(X - width / 2 - 4, Y - 10, width + 8, 20)) text(g.label, X, Y, g.color);
        }
        ctx.globalAlpha = 1;
      }
      const filmAlpha = clamp((zoom - 1.8) / 1.5, 0, 1);
      if (filmAlpha > 0) {
        ctx.globalAlpha = filmAlpha;
        const budget = Math.min(150, Math.round(zoom * 9), Math.round((w * h) / 7000));
        let placed = 0;
        // Films are stored most-voted first.
        for (let i = 0; i < data.count && placed < budget; i++) {
          if ((matches && !matches[i]) || i === selected || !visible(i)) continue;
          if (filmLabel(i, 'rgba(255,255,255,0.88)')) placed++;
        }
        ctx.globalAlpha = 1;
      }
    }

    // The hover card follows its film.
    const card = tip.current;
    if (card && hovered !== null) {
      const X = px(data.x[hovered]), Y = py(data.y[hovered]);
      const flip = X + 24 + card.offsetWidth > w - live.current.rightInset;
      card.style.transform = `translate(${flip ? X - 18 - card.offsetWidth : X + 18}px, ${clamp(Y - card.offsetHeight / 2, 8, h - card.offsetHeight - 8)}px)`;
    }
  }, [data, prepared]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    function tick() {
      frame.current = 0;
      const a = anim.current;
      if (a) {
        const t = Math.min(1, (performance.now() - a.start) / a.duration);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        // Pull back mid-flight when going far, so you see where you went.
        const screens = (Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) * Math.min(a.from.k, a.to.k)) / (view.current.w || 1);
        const dip = Math.min(1.6, screens * 0.45) * Math.sin(Math.PI * e);
        cam.current = {
          x: a.from.x + (a.to.x - a.from.x) * e,
          y: a.from.y + (a.to.y - a.from.y) * e,
          k: Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e - dip),
        };
        if (t < 1) frame.current = requestAnimationFrame(tick);
        else anim.current = null;
      }
      draw();
    }
    frame.current = requestAnimationFrame(tick);
  }, [draw]);

  const animateTo = useCallback((to: Camera, duration = 750) => {
    anim.current = { from: { ...cam.current }, to, start: performance.now(), duration };
    schedule();
  }, [schedule]);

  /** Where the camera goes to show a film, clear of the panel. */
  const focusOn = useCallback((film: number, k: number): Camera => ({
    x: data.x[film] + live.current.rightInset / 2 / k,
    y: data.y[film],
    k,
  }), [data]);

  /** The whole map, below the controls. */
  const whole = useCallback((): Camera => {
    const { fitK } = view.current;
    const bottom = 44;
    return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 - (topInset - bottom) / 2 / fitK, k: fitK };
  }, [topInset]);

  useImperativeHandle(ref, () => ({
    flyTo: (film) => animateTo(focusOn(film, Math.max(cam.current.k, view.current.fitK * FOCUS_ZOOM))),
    zoomBy: (factor) => animateTo({ ...cam.current, k: clamp(cam.current.k * factor, view.current.fitK * MIN_ZOOM, view.current.fitK * MAX_ZOOM) }, 300),
    fit: () => animateTo(whole()),
  }), [animateTo, focusOn, whole]);

  useEffect(() => {
    live.current = { ...live.current, matches, selected, highlighted, labels, rightInset, avoid, onSelect };
    schedule();
  }, [matches, selected, highlighted, labels, rightInset, avoid, onSelect, schedule]);

  // Size the canvas to its box (and the screen's pixel density), now and on
  // every resize. The first measure also places the camera.
  const placed = useRef(false);
  useEffect(() => {
    const box = wrap.current, el = canvas.current;
    if (!box || !el) return;
    font.current = getComputedStyle(document.body).fontFamily || font.current;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      view.current = { w: width, h: height, dpr, fitK: Math.min(width - 48, height - topInset - 44) / MAP_SIZE };
      if (!placed.current) {
        placed.current = true;
        cam.current = initialFilm !== null
          ? focusOn(initialFilm, view.current.fitK * FOCUS_ZOOM)
          : whole();
      }
      draw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [draw, focusOn, initialFilm, topInset, whole]);

  // Drag to pan, scroll or pinch to zoom, hover and click films.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let drag: { x: number; y: number; cam: Camera; moved: boolean } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
    };
    const filmAt = (mx: number, my: number) => {
      const { x: cx, y: cy, k } = cam.current;
      const { w, h, fitK } = view.current;
      const wx = cx + (mx - w / 2) / k, wy = cy + (my - h / 2) / k;
      const reach = Math.max(9, clamp(1.15 * Math.sqrt(k / fitK), 1.1, 7) * 2) / k;
      const { cols, start, cells } = prepared.grid;
      const matches = live.current.matches;
      let best: number | null = null, bestD = reach * reach;
      const c0 = clamp(Math.floor((wx - reach) / CELL), 0, cols - 1), c1 = clamp(Math.floor((wx + reach) / CELL), 0, cols - 1);
      const r0 = clamp(Math.floor((wy - reach) / CELL), 0, cols - 1), r1 = clamp(Math.floor((wy + reach) / CELL), 0, cols - 1);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cell = row * cols + col;
          for (let s = start[cell]; s < start[cell + 1]; s++) {
            const i = cells[s];
            if (matches && !matches[i]) continue;
            const d = (data.x[i] - wx) ** 2 + (data.y[i] - wy) ** 2;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      return best;
    };
    const hover = (film: number | null) => {
      if (live.current.hovered === film) return;
      live.current.hovered = film;
      setHovered(film);
      el.style.cursor = film !== null ? 'pointer' : 'grab';
      schedule();
    };
    const keepInBounds = (c: Camera): Camera => ({
      x: clamp(c.x, -MAP_SIZE * 0.1, MAP_SIZE * 1.1),
      y: clamp(c.y, -MAP_SIZE * 0.1, MAP_SIZE * 1.1),
      k: c.k,
    });

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      anim.current = null;
      drag = { x: e.clientX, y: e.clientY, cam: { ...cam.current }, moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          el.style.cursor = 'grabbing';
          hover(null);
        }
        if (drag.moved) {
          cam.current = keepInBounds({ x: drag.cam.x - dx / drag.cam.k, y: drag.cam.y - dy / drag.cam.k, k: drag.cam.k });
          schedule();
        }
        return;
      }
      const { mx, my } = local(e);
      hover(filmAt(mx, my));
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const clicked = !drag.moved;
      drag = null;
      el.style.cursor = live.current.hovered !== null ? 'pointer' : 'grab';
      if (clicked) {
        const { mx, my } = local(e);
        live.current.onSelect(filmAt(mx, my));
      }
    };
    const onLeave = () => { if (!drag) hover(null); };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      anim.current = null;
      const { mx, my } = local(e);
      const { w, h, fitK } = view.current;
      const c = cam.current;
      // Pinch arrives as a wheel with ctrlKey, in small steps.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025));
      const k = clamp(c.k * factor, fitK * MIN_ZOOM, fitK * MAX_ZOOM);
      // Keep the point under the pointer where it is.
      const wx = c.x + (mx - w / 2) / c.k, wy = c.y + (my - h / 2) / c.k;
      cam.current = keepInBounds({ x: wx - (mx - w / 2) / k, y: wy - (my - h / 2) / k, k });
      hover(null);
      schedule();
    };
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [data, prepared, schedule]);

  // Clear the handle too: a frame cancelled but still recorded would block
  // every later redraw (React mounts twice in development).
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" aria-label={`Map of ${data.count.toLocaleString()} films`} />
      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 z-20"
        style={{ visibility: hovered === null ? 'hidden' : 'visible' }}
      >
        {hovered !== null && (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#141414]/95 p-2 pr-4 shadow-2xl backdrop-blur-md">
            <Image
              src={posterUrl(data, hovered, 'w92')}
              alt=""
              width={40}
              height={60}
              className="h-[60px] w-10 rounded-md bg-white/5 object-cover"
            />
            <div className="min-w-0">
              <p className="max-w-[220px] truncate text-[13px] font-bold leading-tight text-white">{data.titles[hovered]}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/50">
                <span>{data.years[hovered]}</span>
                <span className="text-white/20">•</span>
                <Star size={10} className="fill-yellow-500 text-yellow-500" />
                <span className="text-white/70">{(data.rating[hovered] / 10).toFixed(1)}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
