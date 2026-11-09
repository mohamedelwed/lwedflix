'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, Download as DownloadIcon, FolderOpen, Loader2, Pause, Play, RotateCw, Trash2, X } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import EmptyState from '@/components/ui/EmptyState';
import {
  episodeCode,
  formatBytes,
  formatDuration,
  formatEta,
  getDownloadsBridge,
  isActive,
  posterUrl,
  useDownloads,
  type Download,
} from '@/lib/downloads';
import { getMovieFraction } from '@/lib/movieProgress';
import { getEpisodePositions, isEpisodeWatched } from '@/lib/episodeProgress';

const bridge = () => getDownloadsBridge();
const WAITING_SHOWN = 4;
const byEpisode = (a: Download, b: Download) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0);

/** How far through a download you are, 0–1, from the same progress the online player keeps. */
function watchedFraction(d: Download): number | undefined {
  if (!d.mediaId) return undefined;
  if (d.mediaType === 'movie') return getMovieFraction(d.mediaId);
  if (isEpisodeWatched(d.mediaId, d.season ?? 1, d.episode ?? 1)) return 1;
  const p = getEpisodePositions(d.mediaId)[`${d.season ?? 1}-${d.episode ?? 1}`];
  return p && p.duration > 0 ? Math.min(1, p.watched / p.duration) : undefined;
}

const titlePage = (d: Download) => (d.mediaId ? `/${d.mediaType}/${d.mediaId}` : null);

/**
 * Downloads: what's on its way, and what's saved — movies, and shows by
 * episode — to watch here without the internet.
 */
export default function DownloadsLibrary() {
  const { available, downloads, loaded } = useDownloads();
  const active = downloads.filter((d) => isActive(d) || d.state === 'failed' || d.state === 'interrupted' || d.state === 'missing');
  const done = downloads.filter((d) => d.state === 'done');
  const movies = done.filter((d) => d.mediaType === 'movie');
  const groups = new Map<string, Download[]>();
  for (const d of done.filter((x) => x.mediaType === 'tv')) {
    const key = String(d.mediaId ?? d.showTitle);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const shows = [...groups.values()].map((episodes) => episodes.sort(byEpisode));
  const totalBytes = done.reduce((sum, d) => sum + (d.bytes || 0), 0);
  // A whole show queued at once: the next few in line, then a count.
  const waiting = active
    .filter((d) => d.state === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt || (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  const shownActive = active.filter((d) => d.state !== 'queued').concat(waiting.slice(0, WAITING_SHOWN));

  return (
    <PageShell
      icon={DownloadIcon}
      title="Downloads"
      subtitle="Saved to this computer — they play without the internet."
      width="wide"
      actions={
        available && (
          <div className="flex items-center gap-3">
            {totalBytes > 0 && <span className="text-xs text-white/40">{formatBytes(totalBytes)} on disk</span>}
            <button
              onClick={() => void bridge()?.openFolder()}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <FolderOpen size={14} /> Open folder
            </button>
          </div>
        )
      }
    >
      {!available ? (
        <EmptyState icon={DownloadIcon} title="Downloads work in the Lwedflix app" body="Open Lwedflix on your computer to save movies and episodes and watch them offline." />
      ) : !loaded ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" /></div>
      ) : downloads.length === 0 ? (
        <EmptyState
          icon={DownloadIcon}
          title="Nothing downloaded yet"
          body="Open a movie or an episode, press play, then the download button in the player. It saves here, and plays without the internet."
        />
      ) : (
        <div className="space-y-12">
          {active.length > 0 && (
            <section>
              <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">Downloading</h2>
              <div className="space-y-2">
                {shownActive.map((d) => <ActiveRow key={d.id} download={d} />)}
              </div>
              {waiting.length > WAITING_SHOWN && (
                <div className="mt-2 flex items-center justify-between rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-white/45">
                  <span>{waiting.length - WAITING_SHOWN} more waiting their turn</span>
                  <button onClick={() => waiting.forEach((d) => void bridge()?.cancel(d.id))} className="font-semibold text-white/60 hover:text-red-400">
                    Cancel everything waiting
                  </button>
                </div>
              )}
            </section>
          )}

          {movies.length > 0 && (
            <section>
              <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">Movies</h2>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {movies.map((d) => <MovieCard key={d.id} download={d} />)}
              </div>
            </section>
          )}

          {shows.length > 0 && (
            <section>
              <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">Shows</h2>
              <div className="space-y-4">
                {shows.map((episodes) => <ShowBlock key={episodes[0].id} episodes={episodes} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Poster({ download, className }: { download: Download; className: string }) {
  return download.poster ? (
    <Image src={posterUrl(download.id)} alt="" width={342} height={513} unoptimized className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-center justify-center bg-gradient-to-br from-white/10 to-white/[0.02] p-3 text-center text-xs font-bold text-white/50 ${className}`}>
      {download.showTitle || download.title}
    </div>
  );
}

function ProgressBar({ value, className = '' }: { value: number | undefined; className?: string }) {
  if (value === undefined || value <= 0) return null;
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-white/15 ${className}`}>
      <div className="h-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** Delete, asking first; the file goes too. */
function DeleteButton({ download, label = false }: { download: Download; label?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="flex items-center gap-1.5 text-[11px]">
        <button onClick={() => void bridge()?.remove(download.id, true)} className="rounded-lg bg-red-500/90 px-2 py-1 font-semibold text-white hover:bg-red-500">Delete</button>
        <button onClick={() => setAsking(false)} className="rounded-lg px-2 py-1 text-white/60 hover:text-white">Keep</button>
      </span>
    );
  }
  return (
    <button onClick={() => setAsking(true)} title="Delete the download" className="flex items-center gap-1.5 rounded-lg p-1.5 text-white/45 transition-colors hover:bg-white/10 hover:text-red-400">
      <Trash2 size={14} />
      {label && <span className="text-[11px]">Delete</span>}
    </button>
  );
}

function ActiveRow({ download: d }: { download: Download }) {
  const name = d.mediaType === 'tv' ? `${d.showTitle || d.title} · ${episodeCode(d)}` : d.title;
  const problem = d.state === 'failed' || d.state === 'interrupted' || d.state === 'missing';
  const page = titlePage(d);
  let status: string;
  if (d.state === 'queued') status = 'Waiting its turn';
  else if (d.state === 'resolving') status = 'Finding the stream…';
  else if (d.state === 'paused') status = `Paused · ${Math.round(d.progress * 100)}%`;
  else if (d.state === 'missing') status = 'The file was moved or deleted.';
  else if (problem) status = d.error || 'It stopped.';
  else {
    status = [
      `${Math.round(d.progress * 100)}%`,
      d.speed > 0 ? `${formatBytes(d.speed)}/s` : '',
      formatEta(d.eta),
      d.quality ?? '',
    ].filter(Boolean).join(' · ');
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
      <Poster download={d} className="h-[72px] w-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <p className={`mt-0.5 truncate text-xs ${problem ? 'text-amber-300/90' : 'text-white/45'}`}>{status}</p>
        {(d.state === 'downloading' || d.state === 'paused') && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full transition-[width] duration-500 ${d.state === 'paused' ? 'bg-white/40' : 'bg-accent'}`} style={{ width: `${Math.max(2, Math.round(d.progress * 100))}%` }} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {d.state === 'downloading' && (
          <IconButton label="Pause" onClick={() => void bridge()?.pause(d.id)}><Pause size={15} /></IconButton>
        )}
        {d.state === 'paused' && (
          <IconButton label="Resume" onClick={() => void bridge()?.resume(d.id)}><Play size={15} /></IconButton>
        )}
        {isActive(d) && (
          <IconButton label="Cancel" onClick={() => void bridge()?.cancel(d.id)}><X size={15} /></IconButton>
        )}
        {problem && d.target && (
          <button onClick={() => void bridge()?.retry(d.id)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/10">
            <RotateCw size={12} /> Try again
          </button>
        )}
        {problem && page && !d.target && (
          <Link href={page} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/10">
            <RotateCw size={12} /> Download again
          </Link>
        )}
        {problem && (
          <IconButton label="Remove from the list" onClick={() => void bridge()?.remove(d.id, false)}><X size={15} /></IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded-lg p-2 text-white/55 transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

function MovieCard({ download: d }: { download: Download }) {
  const watched = watchedFraction(d);
  return (
    <div className="group">
      <Link href={`/downloads/watch/${d.id}`} className="relative block aspect-[2/3] overflow-hidden rounded-2xl bg-card card-hover">
        <Poster download={d} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-xl shadow-accent/30">
            <Play size={22} className="ml-1 fill-white" />
          </span>
        </div>
        {d.quality && (
          <span className="absolute left-2.5 top-2.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white/80 backdrop-blur-md">{d.quality}</span>
        )}
        {watched !== undefined && watched >= 0.9 && (
          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-accent backdrop-blur-md"><Check size={13} /></span>
        )}
        <ProgressBar value={watched !== undefined && watched < 0.9 ? watched : undefined} className="absolute inset-x-3 bottom-3" />
      </Link>
      <div className="mt-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">{d.title}</p>
          <p className="text-[11px] text-white/40">{[formatDuration(d.duration), formatBytes(d.bytes)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => void bridge()?.reveal(d.id)} title="Show in folder" className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
            <FolderOpen size={14} />
          </button>
          <DeleteButton download={d} />
        </div>
      </div>
    </div>
  );
}

function ShowBlock({ episodes }: { episodes: Download[] }) {
  const first = episodes[0];
  const bytes = episodes.reduce((sum, d) => sum + (d.bytes || 0), 0);
  const seasons = [...new Set(episodes.map((d) => d.season ?? 1))];
  return (
    <div className="flex gap-5 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Link href={`/downloads/watch/${first.id}`} className="shrink-0">
        <Poster download={first} className="h-[180px] w-[120px] rounded-2xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-lg font-bold text-white">{first.showTitle || first.title}</h3>
        <p className="mb-3 text-xs text-white/40">
          {episodes.length} episode{episodes.length === 1 ? '' : 's'} · {formatBytes(bytes)}
        </p>
        <div className="space-y-3">
          {seasons.map((season) => (
            <div key={season}>
              {seasons.length > 1 && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Season {season}</p>}
              <div className="space-y-0.5">
                {episodes.filter((d) => (d.season ?? 1) === season).map((d) => <EpisodeRow key={d.id} download={d} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EpisodeRow({ download: d }: { download: Download }) {
  const watched = watchedFraction(d);
  return (
    <div className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.05]">
      <Link href={`/downloads/watch/${d.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors group-hover:bg-accent group-hover:text-white">
          {watched !== undefined && watched >= 0.9 ? <Check size={13} /> : <Play size={12} className="ml-0.5 fill-current" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-white/90">
            <span className="font-semibold text-white/60">E{d.episode}</span>
            {d.episodeTitle ? ` · ${d.episodeTitle}` : ''}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-white/35">{[formatDuration(d.duration), d.quality, formatBytes(d.bytes)].filter(Boolean).join(' · ')}</span>
            <ProgressBar value={watched !== undefined && watched < 0.9 ? watched : undefined} className="w-20" />
          </span>
        </span>
      </Link>
      <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={() => void bridge()?.reveal(d.id)} title="Show in folder" className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
          <FolderOpen size={14} />
        </button>
        <DeleteButton download={d} />
      </div>
    </div>
  );
}
