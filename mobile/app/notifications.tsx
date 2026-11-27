import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { describeNotification, getNotifications, markAllRead, markRead, notificationHref, type AppNotification } from '@shared/lib/notifications';
import { timeAgo } from '@shared/lib/posts';
import Avatar from '@/components/Avatar';
import RequireAuth from '@/components/RequireAuth';
import { EmptyState } from '@/components/States';
import { colors, radius, space } from '@/theme';

/** Friend requests, comments, reactions, recommendations, messages. */
export default function NotificationsScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () => (
            <Pressable onPress={() => void markAllRead()} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Mark all read</Text>
            </Pressable>
          ),
        }}
      />
      <RequireAuth what="notifications">
        <List />
      </RequireAuth>
    </>
  );
}

/** Desktop paths that the phone has a screen for under another name. */
function toAppPath(href: string): string {
  if (href.startsWith('/friends')) return '/friends';
  if (href.startsWith('/messages?thread=')) return `/messages/${href.split('=')[1]}`;
  return href;
}

function List() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    getNotifications(50)
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, !item.read_at && styles.unread, pressed && { opacity: 0.7 }]}
          onPress={() => {
            void markRead(item.id);
            router.push(toAppPath(notificationHref(item)) as never);
          }}
        >
          <Avatar uri={item.actor?.avatar_url} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.text}>{describeNotification(item)}</Text>
            <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
          </View>
          {!item.read_at && <View style={styles.dot} />}
        </Pressable>
      )}
      ListEmptyComponent={loading ? undefined : <EmptyState title="You're all caught up" />}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.white5 },
  unread: { backgroundColor: 'rgba(255,153,0,0.07)' },
  text: { color: colors.foreground, fontSize: 14, lineHeight: 19 },
  time: { color: colors.muted, fontSize: 12, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
