'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronRight, Download, Loader2, Play } from 'lucide-react';
import {
  formatBytes,
  getDownloadsBridge,
  isActive,
  useDownloads,
  type DownloadMeta,
  type Quality,
  type StreamOption,
} from '@/lib/downloads';
import { getOdmBridge, type OdmStatus } from '@/lib/odmBridge';

interface DownloadButtonProps {
  /** Provider origins to ask for streams; empty means everything recent. */
  origins: string[];
  meta: DownloadMeta;
  /** Trigger classes, normal and while the menu is open. */
  triggerClassName: string;
  activeTriggerClassName?: string;
  /** Opens above a bottom bar, below a top overlay. */
  placement?: 'above' | 'below';
}

const noSubscribe = () => () => {};
const hasBridge = () => getDownloadsBridge() !== null;

function streamAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

/**
 * Download what the player is streaming: pick the stream (the likeliest is
 * first), then a quality when it comes in several. On Windows with ODM
 * installed, each stream can go to ODM instead. Renders nothing outside the
 * app.
 */
export default function DownloadButton({ origins, meta, triggerClassName, activeTriggerClassName, placement = 'below' }: DownloadButtonProps) {
  const available = useSyncExternalStore(noSubscribe, hasBridge, () => false);
  const { downloads } = useDownloads();
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState<StreamOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState<{ stream: StreamOption; qualities: Quality[] | null } | null>(null);
  const [startedId, setStartedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [odm, setOdm] = useState<OdmStatus | null>(null);
  // A string, so a new array with the same origins isn't a change.
  const originsKey = origins.join(' ');

  // This title's existing download, if there is one.
  const existing = downloads.find((d) =>
    d.mediaId === meta.mediaId && d.mediaType === meta.mediaType &&
    (meta.mediaType === 'movie' || (d.season === (meta.season ?? 1) && d.episode === (meta.episode ?? 1))) &&
    (d.state === 'done' || isActive(d)));

  const refresh = useCallback(async () => {
    const bridge = getDownloadsBridge();
    if (!bridge) return;
    setLoading(true);
    try {
      setStreams(await bridge.streams(originsKey ? originsKey.split(' ') : []));
      const status = await getOdmBridge()?.status().catch(() => null);
      if (status) setOdm(status);
    } catch {
      setNote('Couldn’t read the player’s streams.');
    } finally {
      setLoading(false);
    }
  }, [originsKey]);

  const toggle = () => {
    setNote('');
    setChoosing(null);
    setStartedId(null);
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void refresh();
  };

  const start = async (stream: StreamOption, variant?: number) => {
    const bridge = getDownloadsBridge();
    if (!bridge) return;
    setNote('');
    const result = await bridge.start(stream.id, { variant, meta }).catch(() => null);
    if (result?.ok) {
      setStartedId(result.id);
      setChoosing(null);
    } else {
      setNote(result ? result.error : 'Couldn’t start the download.');
    }
  };

  // HLS can come in several qualities: ask which, unless there's only one.
  const pick = async (stream: StreamOption) => {
    if (stream.kind !== 'hls') return start(stream);
    setChoosing({ stream, qualities: null });
    const qualities = (await getDownloadsBridge()?.qualities(stream.id).catch(() => [])) ?? [];
    if (qualities.filter((q) => q.supported).length <= 1) return start(stream, qualities.find((q) => q.supported)?.index);
    setChoosing({ stream, qualities });
  };

  const sendToOdm = async (stream: StreamOption) => {
    const result = await getOdmBridge()?.download(stream.id, {
      title: meta.showTitle || meta.title,
      type: meta.mediaType,
      season: meta.season,
      episode: meta.episode,
    }).catch(() => null);
    setNote(result?.ok ? 'Sent to ODM — it downloads from here.' : result?.error || 'Couldn’t reach ODM.');
  };

  // While the menu is open, new streams show up as the player loads them.
  useEffect(() => {
    if (!open || choosing || startedId) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [open, choosing, startedId, refresh]);

  if (!available) return null;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={open ? activeTriggerClassName ?? triggerClassName : triggerClassName}
        title="Download"
        aria-label="Download"
        aria-expanded={open}
      >
        <Download size={18} />
      </button>

      {open && (
        <div
          className={`absolute right-0 ${placement === 'above' ? 'bottom-11' : 'top-11'} z-50 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-black/90 p-2 shadow-2xl backdrop-blur-xl`}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
              {choosing ? 'Pick a quality' : 'Download'}
            </p>
            {loading && <Loader2 size={12} className="animate-spin text-white/40" />}
          </div>

          {startedId ? (
            <div className="space-y-3 px-2 pb-1 pt-1">
              <p className="flex items-center gap-2 text-xs text-white/85">
                <Check size={14} className="text-accent" /> Downloading — it keeps going while you browse.
              </p>
              <Link href="/downloads" onClick={() => setOpen(false)} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                See it in Downloads <ChevronRight size={12} />
              </Link>
            </div>
          ) : choosing ? (
            <>
              <button onClick={() => setChoosing(null)} className="mb-1 flex items-center gap-1 px-2 text-[11px] text-white/50 hover:text-white">
                <ArrowLeft size={12} /> {choosing.stream.title}
              </button>
              {!choosing.qualities ? (
                <p className="flex items-center gap-2 px-2 py-3 text-xs text-white/60">
                  <Loader2 size={13} className="animate-spin" /> Checking the qualities…
                </p>
              ) : (
                choosing.qualities.map((q) => (
                  <button
                    key={q.index}
                    disabled={!q.supported}
                    onClick={() => void start(choosing.stream, q.index)}
                    className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="text-xs font-semibold text-white/90">{q.label}</span>
                    <span className="text-[11px] text-white/40">
                      {q.supported ? (q.bytes ? `about ${formatBytes(q.bytes)}` : '') : 'sound is separate — not yet'}
                    </span>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              {existing && (
                <Link
                  href={existing.state === 'done' ? `/downloads/watch/${existing.id}` : '/downloads'}
                  onClick={() => setOpen(false)}
                  className="mb-1 flex items-center gap-2 rounded-xl bg-accent/10 px-2 py-2 text-xs text-accent hover:bg-accent/15"
                >
                  {existing.state === 'done' ? <Play size={13} className="fill-accent" /> : <Loader2 size={13} className="animate-spin" />}
                  <span className="flex-1 font-semibold">
                    {existing.state === 'done' ? 'Downloaded — watch offline' : `Downloading · ${Math.round(existing.progress * 100)}%`}
                  </span>
                  <ChevronRight size={13} />
                </Link>
              )}
              {streams.length === 0 && (
                <p className="px-2 py-3 text-xs text-white/60">
                  {loading ? 'Looking for the stream…' : 'No stream yet — press play, and it shows up here.'}
                </p>
              )}
              <div className="no-scrollbar max-h-64 overflow-y-auto">
                {streams.map((stream) => (
                  <div key={stream.id} className="flex items-center gap-1">
                    <button
                      disabled={!stream.supported}
                      onClick={() => void pick(stream)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-white/90">{stream.title}</span>
                          {stream.best && stream.supported && (
                            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent">Best</span>
                          )}
                        </span>
                        <span className="block truncate text-[10px] text-white/40">
                          {stream.supported ? `${stream.detail} · ${streamAge(stream.ageMs)}` : 'DASH can’t be downloaded yet — try another server'}
                        </span>
                      </span>
                      {stream.supported && <Download size={13} className="shrink-0 text-white/30" />}
                    </button>
                    {odm?.installed && stream.supported && (
                      <button
                        onClick={() => void sendToOdm(stream)}
                        title="Send to ODM instead"
                        className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white/50 hover:border-white/30 hover:text-white"
                      >
                        ODM
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {note && <p className="px-2 pb-1 pt-1 text-[11px] text-accent">{note}</p>}
        </div>
      )}
    </div>
  );
}
