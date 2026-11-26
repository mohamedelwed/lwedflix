import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';
import { addComment, getComments, getPostById, timeAgo, type Post, type PostComment } from '@shared/lib/posts';
import Avatar from '@/components/Avatar';
import PostCard from '@/components/PostCard';
import { EmptyState, Loading } from '@/components/States';
import { useAuth } from '@/lib/auth';
import { colors, radius, space } from '@/theme';

/** One post and its comments (src/app/p/[id]/page.tsx). */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);

  const loadComments = useCallback(() => {
    getComments(id).then(setComments).catch(() => {});
  }, [id]);

  useEffect(() => {
    getPostById(id).then(setPost).catch(() => setPost(null));
    loadComments();
  }, [id, loadComments]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    if (!user) return router.push('/login');
    setDraft('');
    try {
      await addComment(id, body, replyTo?.id ?? null);
      setReplyTo(null);
      loadComments();
    } catch {
      setDraft(body);
    }
  };

  if (post === undefined) return <Loading />;
  if (post === null) return <EmptyState title="This post isn't available" text="It may have been deleted, or it's only visible to friends." />;

  const renderComment = (c: PostComment, reply = false) => (
    <View key={c.id} style={[styles.comment, reply && { marginLeft: 40 }]}>
      <Avatar uri={c.author?.avatar_url} size={reply ? 26 : 32} />
      <View style={{ flex: 1 }}>
        <Text style={styles.muted}>
          <Text style={styles.author}>{c.author?.display_name || c.author?.username || 'Someone'}</Text> · {timeAgo(c.created_at)}
        </Text>
        <Text style={styles.body}>{c.body}</Text>
        {!reply && user && (
          <Pressable onPress={() => setReplyTo(c)} hitSlop={6}>
            <Text style={styles.reply}>Reply</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Post' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <PostCard post={post} linkToPost={false} />
        <Text style={styles.heading}>Comments</Text>
        {comments.length === 0 ? <Text style={styles.muted}>No comments yet.</Text> : comments.map((c) => [renderComment(c), ...c.replies.map((r) => renderComment(r, true))])}
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: insets.bottom + space.sm }]}>
        {replyTo && (
          <Pressable onPress={() => setReplyTo(null)}>
            <Text style={styles.replying}>Replying to {replyTo.author?.display_name || replyTo.author?.username} · cancel</Text>
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput value={draft} onChangeText={setDraft} placeholder={user ? 'Add a comment…' : 'Sign in to comment'} editable={!!user} placeholderTextColor={colors.muted} selectionColor={colors.accent} style={styles.input} multiline />
          <Pressable onPress={send} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]} accessibilityLabel="Send">
            <Send size={16} color="#000" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  comment: { flexDirection: 'row', gap: space.sm },
  author: { color: colors.white90, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12 },
  body: { color: colors.white90, fontSize: 14, lineHeight: 19, marginTop: 2 },
  reply: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 },
  bar: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 6, borderTopWidth: 1, borderTopColor: colors.white5 },
  replying: { color: colors.accent, fontSize: 12 },
  input: { flex: 1, maxHeight: 120, color: colors.foreground, backgroundColor: colors.white5, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
});
