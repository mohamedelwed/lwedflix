'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import NotificationBell from '@/components/NotificationBell';
import HistoryButtons from '@/components/HistoryButtons';
import { useIsTv } from '@/lib/tv';

const noSubscribe = () => () => {};
const isMac = () => /Mac/i.test(navigator.platform);

/**
 * The desktop app's top bar. It doubles as the window's title bar: the
 * empty parts drag the window, and on Windows it leaves room for the native
 * window buttons (the Window Controls Overlay variables are only set there).
 */
const AppToolbar = () => {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mac = useSyncExternalStore(noSubscribe, isMac, () => null);
  // No keyboard shortcut to advertise on a TV remote.
  const tv = useIsTv();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Cmd/Ctrl+K jumps to search from anywhere, as in most desktop apps.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
    input.current?.blur();
  };

  return (
    <header
      className={`fixed top-0 left-[232px] right-0 z-40 h-14 flex items-center gap-4 pl-5 select-none transition-colors duration-300 [-webkit-app-region:drag] ${
        scrolled
          ? 'bg-[#0a0a0a]/85 backdrop-blur-xl border-b border-white/[0.06]'
          : // No border here: the gradient tile repeats into a border's row,
            // drawing a dark hairline under the bar.
            'bg-gradient-to-b from-black/70 to-transparent'
      }`}
      style={{
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 1.25rem)',
      }}
    >
      <div className="[-webkit-app-region:no-drag]">
        <HistoryButtons />
      </div>

      <form onSubmit={submit} className="relative w-full max-w-md [-webkit-app-region:no-drag]">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          placeholder="Search movies, shows, anime…"
          className="w-full h-9 bg-white/[0.06] border border-white/[0.08] rounded-xl pl-10 pr-16 text-[13px] text-white placeholder:text-white/30 outline-none focus:bg-white/[0.09] focus:border-accent/50 transition-colors"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          mac !== null && !tv && (
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/[0.04] text-[10px] font-sans text-white/35">
              {mac ? '⌘K' : 'Ctrl K'}
            </kbd>
          )
        )}
      </form>

      <div className="ml-auto flex items-center gap-3 [-webkit-app-region:no-drag]">
        {user && <NotificationBell />}
      </div>
    </header>
  );
};

export default AppToolbar;
