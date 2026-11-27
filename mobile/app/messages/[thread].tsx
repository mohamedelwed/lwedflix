import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';
import { getMessages, getThreads, markRead, sendMessage, subscribeToMessages, type DmMessage } from '@shared/lib/dm';
import { timeAgo } from '@shared/lib/posts';
import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { imageUrl } from '@/lib/media';
import { colors, radius, space } from '@/theme';

/** One conversation (src/components/DmThreadView.tsx). */
export default function ThreadScreen() {
  return (
    <RequireAuth what="messages">
      <Thread />
    </RequireAuth>
  );
}

function Thread() {
  const { thread } = useLocalSearchParams<{ thread: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const sending = useRef(false);

  const load = useCallback(() => {
    getMessages(thread)
      .then((m) => setMessages(m))
      .catch(() => {});
    void markRead(thread).catch(() => {});
  }, [thread]);

  useEffect(() => {
    load();
    getThreads()
      .then((all) => {
        const t = all.find((x) => x.thread_id === thread);
        if (t) setName(t.display_name || t.username);
      })
      .catch(() => {});
    return subscribeToMessages(() => load(), thread);
  }, [thread, load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending.current) return;
    sending.current = true;
    setDraft('');
    try {
      await sendMessage(thread, body);
      load();
    } catch {
      setDraft(body);
    } finally {
      sending.current = false;
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: name || 'Messages' }} />
      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        renderItem={({ item }) => {
          const mine = item.sender_id === user?.id;
          return (
            <View style={[styles.bubbleWrap, mine && { alignItems: 'flex-end' }]}>
              {item.media_type && item.media_id && (
                <Pressable style={styles.shared} onPress={() => router.push(item.media_type === 'tv' && item.season ? `/tv/${item.media_id}?season=${item.season}&episode=${item.episode ?? 1}` : `/${item.media_type}/${item.media_id}`)}>
                  {item.poster_path && <Image source={imageUrl(item.poster_path, 'w185')} style={styles.sharedPoster} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sharedLabel}>{item.media_type === 'tv' ? 'Show' : 'Movie'}</Text>
                    <Text style={styles.sharedTitle} numberOfLines={2}>{item.media_title}</Text>
                  </View>
                </Pressable>
              )}
              {!!item.body && (
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={[styles.body, mine && { color: '#000' }]}>{item.body}</Text>
                </View>
              )}
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
          );
        }}
      />
      <View style={[styles.bar, { paddingBottom: insets.bottom + space.sm }]}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Message…" placeholderTextColor={colors.muted} selectionColor={colors.accent} style={styles.input} multiline />
        <Pressable onPress={send} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]} accessibilityLabel="Send">
          <Send size={16} color="#000" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubbleWrap: { alignItems: 'flex-start', gap: 4 },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.white10, borderBottomLeftRadius: 4 },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 20 },
  time: { color: colors.muted, fontSize: 10, marginHorizontal: 4 },
  shared: { flexDirection: 'row', gap: space.md, alignItems: 'center', width: 240, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  sharedPoster: { width: 44, height: 66, borderRadius: 6 },
  sharedLabel: { color: colors.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  sharedTitle: { color: colors.foreground, fontWeight: '700' },
  bar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.white5 },
  input: { flex: 1, maxHeight: 120, color: colors.foreground, backgroundColor: colors.white5, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
});
