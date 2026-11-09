'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home,
  Film,
  Tv,
  Sparkles,
  MapIcon,
  Download,
  Popcorn,
  Users,
  MessageCircle,
  Bookmark,
  History,
  ShieldCheck,
  User,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import LwedflixLogo from '@/components/LwedflixLogo';
import FriendAvatar from '@/components/FriendAvatar';
import { useNavBadges } from '@/hooks/useNavBadges';
import { fetchProfiles, type PublicProfile } from '@/lib/friends';
import { isActive as isDownloading, useDownloads } from '@/lib/downloads';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Also lit on these pages: /movie/550 belongs under Movies. */
  match?: RegExp;
  badge?: number;
}

/** The app's main navigation. */
const AppSidebar = () => {
  const pathname = usePathname();
  const { user, isAdmin, signOut } = useAuth();
  const { pendingRequests, unreadDms } = useNavBadges(user);
  const { available: canDownload, downloads } = useDownloads();
  const downloading = downloads.filter(isDownloading).length;

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Browse',
      items: [
        { label: 'Home', href: '/', icon: Home },
        { label: 'Movies', href: '/movies', icon: Film, match: /^\/movie\// },
        { label: 'TV Shows', href: '/tv', icon: Tv, match: /^\/tv\// },
        { label: 'Anime', href: '/anime', icon: Sparkles },
      ],
    },
    {
      title: 'Discover',
      items: [{ label: 'Movie Map', href: '/map', icon: MapIcon }],
    },
    {
      title: 'Together',
      items: [
        { label: 'Watch Party', href: '/watch', icon: Popcorn, match: /^\/watch\// },
        { label: 'Friends', href: '/friends', icon: Users, match: /^\/(u|invite)\//, badge: pendingRequests },
        { label: 'Messages', href: '/messages', icon: MessageCircle, badge: unreadDms },
      ],
    },
    {
      title: 'Library',
      items: [
        { label: 'Watchlist', href: '/watchlist', icon: Bookmark },
        { label: 'History', href: '/history', icon: History },
        ...(canDownload ? [{ label: 'Downloads', href: '/downloads', icon: Download, match: /^\/downloads\//, badge: downloading }] : []),
        ...(isAdmin ? [{ label: 'Moderation', href: '/admin', icon: ShieldCheck }] : []),
      ],
    },
  ];

  const isActive = (item: NavItem) =>
    pathname === item.href || Boolean(pathname && item.match?.test(pathname));

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-[232px] flex flex-col bg-[#0d0d0d] border-r border-white/[0.06] select-none">
      {/* Title-bar strip: room for the macOS traffic lights, and something
          to drag the window by. */}
      <div className="h-[52px] shrink-0 [-webkit-app-region:drag]" />

      <Link href="/" className="mx-5 mb-5 [@media(max-height:760px)]:mb-3 self-start group" aria-label="Lwedflix home">
        <LwedflixLogo className="h-[22px] w-auto drop-shadow-[0_0_14px_rgba(255,140,0,0.25)] transition-transform group-hover:scale-[1.03]" />
      </Link>

      {/* Tighter in short windows, so the whole list fits down to the
          app's 640px minimum. */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4 space-y-5 [@media(max-height:760px)]:space-y-3">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/25">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-3 px-3 py-2 [@media(max-height:760px)]:py-1.5 rounded-xl text-[13px] font-semibold transition-colors ${
                      active
                        ? 'bg-white/[0.07] text-white'
                        : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-accent" />
                    )}
                    <item.icon size={17} className={active ? 'text-accent' : ''} />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/[0.06] p-3">
        {user ? (
          <AccountMenu userId={user.id} email={user.email ?? ''} onSignOut={signOut} />
        ) : (
          <div className="space-y-2">
            <Link
              href="/login"
              className="block w-full text-center bg-accent text-white py-2.5 rounded-xl text-[13px] font-bold shadow-lg shadow-accent/20 hover:bg-accent/90 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="block w-full text-center text-[12px] text-white/50 hover:text-white transition-colors py-1"
            >
              Create an account
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
};

const AccountMenu = ({ userId, email, onSignOut }: { userId: string; email: string; onSignOut: () => void }) => {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfiles([userId])
      .then((profiles) => {
        if (!cancelled) setProfile(profiles.get(userId) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const name = profile?.display_name || profile?.username || email.split('@')[0];

  return (
    <div className="relative">
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl bg-card border border-white/10 shadow-2xl p-1.5"
            >
              <Link
                href="/profile"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <User size={15} />
                <span>Profile</span>
              </Link>
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={15} />
                <span>Sign Out</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] transition-colors text-left"
      >
        <FriendAvatar
          profile={{ username: name, display_name: name, avatar_url: profile?.avatar_url ?? null }}
          size={32}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white truncate">{name}</span>
          <span className="block text-[11px] text-white/40 truncate">{email}</span>
        </span>
        <ChevronsUpDown size={14} className="text-white/30 shrink-0" />
      </button>
    </div>
  );
};

export default AppSidebar;
