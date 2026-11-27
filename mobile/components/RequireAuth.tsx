import React from 'react';
import { router } from 'expo-router';
import { EmptyState, Loading } from './States';
import { useAuth } from '@/lib/auth';

/** Screens that need an account show this instead when signed out. */
export default function RequireAuth({ children, what }: { children: React.ReactNode; what: string }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <EmptyState title="Sign in to see this" text={`Your ${what} follow your account, on every device.`} action={{ label: 'Sign in', onPress: () => router.push('/login') }} />;
  return <>{children}</>;
}
