import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { acceptInvite, type PublicProfile } from '@shared/lib/friends';
import { EmptyState, Loading } from '@/components/States';
import { useAuth } from '@/lib/auth';

/** lwedflix://invite/<code>: become friends with whoever sent it (src/app/invite/[code]). */
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user, loading } = useAuth();
  const [result, setResult] = useState<PublicProfile | null | 'error' | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    acceptInvite(code).then(setResult, () => setResult('error'));
  }, [user, code]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <EmptyState
        title="You've been invited"
        text="Sign in or create an account to become friends."
        action={{ label: 'Sign in', onPress: () => router.push({ pathname: '/login', params: { redirect: `/invite/${code}` } }) }}
      />
    );
  }
  if (result === undefined) return <Loading />;
  if (result === 'error' || result === null) return <EmptyState title="This invite didn't work" text="It may be your own, or no longer valid." />;
  return (
    <EmptyState
      title={`You and ${result.display_name || result.username} are friends`}
      action={{ label: 'See their profile', onPress: () => router.replace(`/u/${result.username}`) }}
    />
  );
}
