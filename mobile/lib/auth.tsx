import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@shared/lib/supabase';

// The signed-in account, as src/components/AuthProvider.tsx on desktop:
// the same Supabase project, so signing in here is signing in to the same
// friends, messages, watchlists and history.

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isBanned: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, isBanned: false, signOut: async () => {} });

// Supabase refreshes tokens on a timer, which a backgrounded app can't run.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBanned, setIsBanned] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setIsBanned(false);
      return;
    }
    let live = true;
    supabase
      .from('profiles')
      .select('banned_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (live && data) setIsBanned(Boolean(data.banned_at));
      });
    return () => {
      live = false;
    };
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ user, loading, isBanned, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
