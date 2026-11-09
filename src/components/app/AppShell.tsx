'use client';

import React, { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { flushWatchHistory } from '@/lib/watchHistory';
import AppSidebar from './AppSidebar';
import AppToolbar from './AppToolbar';

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/**
 * The desktop app's frame: sidebar, toolbar, and the page beside them. The
 * page itself is unchanged and still scrolls the window, which the video
 * player's positioning relies on.
 */
const AppShell = ({ children }: { children: React.ReactNode }) => {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  // History written while offline (downloads play without the internet)
  // goes out once the connection is back.
  useEffect(() => {
    if (online) void flushWatchHistory();
  }, [online]);

  return (
    <>
      <AppSidebar />
      <AppToolbar />
      {/* The app runs its own server, so pages still open offline — but
          titles and streams come from the internet. Say so plainly rather
          than leaving half-loaded pages to explain themselves. */}
      {!online && (
        <div className="fixed top-14 left-[232px] right-0 z-30 flex items-center justify-center gap-2 px-6 py-2 bg-amber-500/15 border-b border-amber-500/25 backdrop-blur-xl text-[12px] text-amber-200">
          <WifiOff size={14} className="shrink-0" />
          <span>You&apos;re offline. Browsing and streaming need a connection — everything comes back when you reconnect.</span>
          <Link href="/downloads" className="shrink-0 font-semibold text-amber-100 underline-offset-2 hover:underline">
            Your downloads still play →
          </Link>
        </div>
      )}
      <main className="flex-1 pl-[232px]">{children}</main>
    </>
  );
};

export default AppShell;
