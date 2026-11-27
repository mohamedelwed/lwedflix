import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { getThreads, subscribeToMessages, type DmThread } from '@shared/lib/dm';
import { timeAgo } from '@shared/lib/posts';
import PersonRow from '@/components/PersonRow';
import RequireAuth from '@/components/RequireAuth';
import { EmptyState } from '@/components/States';
import { colors, space } from '@/theme';

/** Conversations, newest first (src/app/messages/page.tsx). */
export default function MessagesScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Messages' }} />
      <RequireAuth what="messages">
        <Threads />
      </RequireAuth>
    </>
  );
}

function Threads() {
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    getThreads()
      .then(setThreads)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);
  useEffect(() => subscribeToMessages(() => load()), [load]);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={threads}
      keyExtractor={(t) => t.thread_id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <PersonRow profile={item} detail={`${item.last_body || 'Shared a title'} · ${timeAgo(item.last_message_at)}`} onPress={() => router.push(`/messages/${item.thread_id}`)}>
          {item.unread_count > 0 && <Text style={{ color: '#000', backgroundColor: colors.accent, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 7, fontWeight: '800', fontSize: 12 }}>{item.unread_count}</Text>}
        </PersonRow>
      )}
      ListEmptyComponent={loading ? undefined : <EmptyState title="No messages yet" text="Message a friend from the Friends list." />}
    />
  );
}
