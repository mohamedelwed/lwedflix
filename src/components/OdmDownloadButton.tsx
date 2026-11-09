'use client';

import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
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

function streamAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

/**
 * "Download with ODM", wherever the player's controls live: the app's own bar
 * (`extra`) and the fallback overlay when the server's controls are shown.
 * Renders nothing outside the desktop app, where the bridge does not exist.
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
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState<OdmStream[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const bridge = getOdmBridge();
    setAvailable(Boolean(bridge));
    void bridge
      ?.status()
      .then((s) => setInstalled(s.installed))
      .catch(() => {});
  }, []);

  const load = async () => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    setBusy(true);
    setNote('');
    try {
      setStreams(await bridge.streams(origins));
    } catch {
      setNote('Could not read the player’s streams.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (open) {
      setOpen(false);
      setNote('');
      return;
    }
    setOpen(true);
    setNote('');
    const bridge = getOdmBridge();
    if (!bridge) return;
    setBusy(true);
    try {
      const status = await bridge.status().catch(() => null);
      if (status) setInstalled(status.installed);
      if (status?.installed !== false) setStreams(await bridge.streams(origins));
    } catch {
      setNote('Could not read the player’s streams.');
    } finally {
      setBusy(false);
    }
  };

  const getOdm = async () => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    await bridge.openSite().catch(() => {});
    setNote('Opened the ODM page — this list updates once it is installed.');
  };

  const checkAgain = async () => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    const status = await bridge.status().catch(() => null);
    if (!status) return;
    setInstalled(status.installed);
    if (status.installed) await load();
  };

  const send = async (stream: OdmStream) => {
    const bridge = getOdmBridge();
    if (!bridge) return;
    setBusy(true);
    setNote('');
    try {
      const result = await bridge.download(stream.id, { title, type, season, episode });
      if (result.ok) {
        setNote('Sent to ODM.');
        setTimeout(() => {
          setOpen(false);
          setNote('');
        }, 1400);
      } else {
        setNote(result.error);
      }
    } catch {
      setNote('Could not reach ODM.');
    } finally {
      setBusy(false);
    }
  };

  // After "Get ODM", poll while the panel is open so a fresh install shows up.
  useEffect(() => {
    if (!open || installed !== false) return;
    const id = setInterval(() => {
      const bridge = getOdmBridge();
      if (!bridge) return;
      void bridge
        .status()
        .then((s) => {
          if (!s.installed) return;
          setInstalled(true);
          void load();
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, installed]);

  if (!available) return null;

  return (
    <div className="relative">
      <button
        onClick={() => void toggle()}
        className={open ? activeTriggerClassName ?? triggerClassName : triggerClassName}
        title="Download with ODM"
        aria-label="Download with ODM"
      >
        {busy && !open ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
      </button>

      {open && (
        <div
          className={`absolute right-0 ${placement === 'above' ? 'bottom-11' : 'top-11'} z-50 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl p-2 shadow-2xl`}
        >
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
            Download with ODM
          </p>

          {installed === false ? (
            <div className="px-2 pb-1 pt-1 space-y-2">
              <p className="text-xs text-white/85">ODM isn’t installed.</p>
              <p className="text-[11px] leading-relaxed text-white/50">
                It’s the downloader this button hands files to. Install it once, then come back —
                this list updates on its own.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => void getOdm()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-accent/90 transition-colors"
                >
                  Get ODM
                </button>
                <button
                  onClick={() => void checkAgain()}
                  className="text-[11px] text-white/60 hover:text-white transition-colors"
                >
                  Check again
                </button>
              </div>
            </div>
          ) : (
            <>
              {busy && streams.length === 0 && (
                <p className="px-2 py-3 text-xs text-white/60">Looking for the stream…</p>
              )}
              {!busy && streams.length === 0 && (
                <p className="px-2 py-3 text-xs text-white/60">
                  No stream yet — press play, then try again.
                </p>
              )}
              <div className="max-h-64 overflow-y-auto no-scrollbar">
                {streams.map((stream) => (
                  <button
                    key={stream.id}
                    disabled={!stream.supported || busy}
                    onClick={() => void send(stream)}
                    className="w-full flex items-start gap-2 px-2 py-2 rounded-xl text-left hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  >
                    <span className="mt-0.5 shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
                      {stream.kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white/90">{stream.label}</span>
                      <span className="block text-[10px] text-white/40">
                        {stream.supported ? streamAge(stream.ageMs) : 'not supported yet'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {note && <p className="px-2 pt-1 pb-1 text-[11px] text-accent">{note}</p>}
        </div>
      )}
    </div>
  );
}
