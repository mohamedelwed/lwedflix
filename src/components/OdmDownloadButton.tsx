'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Download, ExternalLink, Loader2 } from 'lucide-react';
import { getOdmBridge, type OdmStream } from '@/lib/odmBridge';

interface OdmDownloadButtonProps {
  /** Provider origins to ask for streams; empty means everything recent. */
  origins: string[];
  title?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  /** Trigger classes, normal and while the panel is open. */
  triggerClassName: string;
  activeTriggerClassName?: string;
  /** Opens above a bottom bar, below a top overlay. */
  placement?: 'above' | 'below';
}

const noSubscribe = () => () => {};
const hasBridge = () => getOdmBridge() !== null;

function streamAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

/**
 * "Download with ODM", wherever the player's controls live: the app's own bar
 * (`extra`) and the fallback overlay when the server's controls are shown.
 * Renders nothing outside the Windows app, where the bridge does not exist.
 */
export default function OdmDownloadButton({
  origins,
  title,
  type,
  season,
  episode,
  triggerClassName,
  activeTriggerClassName,
  placement = 'below',
}: OdmDownloadButtonProps) {
  // False on the server and in a browser, so the first render matches.
  const available = useSyncExternalStore(noSubscribe, hasBridge, () => false);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState<OdmStream[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // A string, so a new array with the same origins isn't a change.
  const originsKey = origins.join(' ');

  const refresh = useCallback(async () => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    setBusy(true);
    try {
      const status = await bridge.status().catch(() => null);
      if (status) {
        setInstalled(status.installed);
        setRunning(status.running);
      }
      if (status?.installed !== false) setStreams(await bridge.streams(originsKey ? originsKey.split(' ') : []));
    } catch {
      setNote('Could not read the player’s streams.');
    } finally {
      setBusy(false);
    }
  }, [originsKey]);

  const toggle = () => {
    setNote('');
    setSentId(null);
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void refresh();
  };

  const getOdm = async () => {
    await getOdmBridge()?.openSite().catch(() => {});
    setNote('Opened the ODM page — this updates once it’s installed.');
  };

  const send = async (stream: OdmStream) => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    setBusy(true);
    setNote(running ? '' : 'Starting ODM…');
    try {
      const result = await bridge.download(stream.id, { title, type, season, episode });
      if (result.ok) {
        setSentId(stream.id);
        setRunning(true);
        setNote('Sent to ODM — it downloads from here.');
      } else {
        setNote(result.error);
      }
    } catch {
      setNote('Could not reach ODM.');
    } finally {
      setBusy(false);
    }
  };

  // While the menu is open, keep it current: new streams appear as the
  // player loads, and a fresh ODM install shows up without reopening.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  // A sent row shows its tick for a moment, then the menu closes.
  useEffect(() => {
    if (!sentId) return;
    const timer = setTimeout(() => {
      setOpen(false);
      setSentId(null);
      setNote('');
    }, 1800);
    return () => clearTimeout(timer);
  }, [sentId]);

  if (!available) return null;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={open ? activeTriggerClassName ?? triggerClassName : triggerClassName}
        title="Download with ODM"
        aria-label="Download with ODM"
        aria-expanded={open}
      >
        <Download size={18} />
      </button>

      {open && (
        <div
          className={`absolute right-0 ${placement === 'above' ? 'bottom-11' : 'top-11'} z-50 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-black/90 p-2 shadow-2xl backdrop-blur-xl`}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Download with ODM</p>
            {busy && <Loader2 size={12} className="animate-spin text-white/40" />}
          </div>

          {installed === false ? (
            <div className="space-y-2 px-2 pb-1 pt-1">
              <p className="text-xs text-white/85">ODM isn’t installed.</p>
              <p className="text-[11px] leading-relaxed text-white/50">
                ODM is the Windows download manager this button hands the stream to. Install it once, then
                come back — this updates on its own.
              </p>
              <button
                onClick={() => void getOdm()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/90"
              >
                Get ODM
                <ExternalLink size={11} />
              </button>
            </div>
          ) : (
            <>
              {streams.length === 0 && (
                <p className="px-2 py-3 text-xs text-white/60">
                  {busy && installed === null ? 'Looking for the stream…' : 'No stream yet — press play, and it shows up here.'}
                </p>
              )}
              <div className="no-scrollbar max-h-64 overflow-y-auto">
                {streams.map((stream) => (
                  <button
                    key={stream.id}
                    disabled={!stream.supported || busy || sentId !== null}
                    onClick={() => void send(stream)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-white/90">{stream.title}</span>
                        {stream.best && stream.supported && (
                          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent">
                            Best
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[10px] text-white/40">
                        {stream.supported ? `${stream.detail} · ${streamAge(stream.ageMs)}` : 'ODM can’t download DASH yet — try another server'}
                      </span>
                    </span>
                    {sentId === stream.id ? <Check size={14} className="shrink-0 text-accent" /> : stream.supported && <Download size={13} className="shrink-0 text-white/30" />}
                  </button>
                ))}
              </div>
              {streams.length > 0 && !running && !note && (
                <p className="px-2 pt-1 text-[10px] text-white/35">ODM isn’t open: it starts in the tray when you pick one.</p>
              )}
            </>
          )}

          {note && <p className="px-2 pb-1 pt-1 text-[11px] text-accent">{note}</p>}
        </div>
      )}
    </div>
  );
}
