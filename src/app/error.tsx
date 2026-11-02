'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RotateCw, WifiOff, CloudAlert, Loader2 } from 'lucide-react';
import Loading from './loading';

// A page that fails is retried quietly, behind the loading outline, before
// any of this is shown: the failures seen so far all cleared on a second
// try. Counted per page and forgotten after a while, so a later failure on
// the same page gets its retries too.
const AUTO_RETRIES = 2;
const FORGET_AFTER_MS = 30_000;
const attempts = new Map<string, { count: number; at: number }>();

/** The attempt number to make for this page, or null once they're used up. */
function takeAutoRetry(page: string): number | null {
  const now = Date.now();
  const previous = attempts.get(page);
  const count = previous && now - previous.at < FORGET_AFTER_MS ? previous.count : 0;
  if (count >= AUTO_RETRIES) return null;
  attempts.set(page, { count: count + 1, at: now });
  return count + 1;
}

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/**
 * Any page that fails to load — almost always TMDB or the connection — lands
 * here instead of Next's bare error screen. `unstable_retry` re-fetches the
 * page, which is what fixes a network hiccup (`reset` would only re-render);
 * it's tried automatically first, and offered as a button if that fails.
 */
export default function PageError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [retrying, setRetrying] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const pathname = usePathname();
  const retryRef = useRef(unstable_retry);
  useEffect(() => {
    retryRef.current = unstable_retry;
  });

  useEffect(() => {
    // In the app this lands in renderer.log (electron/main.js), so what
    // went wrong can be found after the fact — retried or not.
    console.error(`Page error: ${error.digest ? `[${error.digest}] ` : ''}${error.stack || error.message}`);
    const attempt = navigator.onLine ? takeAutoRetry(pathname) : null;
    const timer = setTimeout(() => (attempt ? retryRef.current() : setGaveUp(true)), attempt ? 300 * attempt : 0);
    return () => clearTimeout(timer);
  }, [error, pathname]);

  if (!gaveUp) return <Loading />;

  const retry = () => {
    setRetrying(true);
    unstable_retry();
    // The boundary unmounts on success; if it fails again we're re-rendered
    // with the new error and should offer the button again.
    setTimeout(() => setRetrying(false), 4000);
  };

  const Icon = online ? CloudAlert : WifiOff;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6 pt-20">
      <div className="max-w-md text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
          <Icon size={30} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">
            {online ? "Couldn't load this page" : "You're offline"}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {online
              ? "Lwedflix tried a few times and couldn't reach the movie database. Try again in a moment."
              : 'Lwedflix needs an internet connection to find titles and stream them. Reconnect and try again.'}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={retry}
            disabled={retrying}
            className="flex items-center gap-2 bg-accent text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-lg shadow-accent/20 hover:bg-accent/90 disabled:opacity-60 transition-all"
          >
            {retrying ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
            <span>Try again</span>
          </button>
          <Link
            href="/"
            className="px-6 py-3 rounded-2xl text-sm font-bold text-white/70 hover:text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
          >
            Go home
          </Link>
        </div>
        <details className="text-[11px] text-white/35">
          <summary className="cursor-pointer select-none hover:text-white/60 transition-colors">Details</summary>
          <p className="mt-2 font-mono break-words text-white/50 select-text">
            {error.digest ? `Server error ${error.digest}` : error.message || String(error)}
          </p>
        </details>
      </div>
    </div>
  );
}
