import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { MessageCircle, Repeat2 } from 'lucide-react-native';
import { applyReactionDelta, REACTION_EMOJI, REACTIONS, setReaction, timeAgo, type Post, type Reaction } from '@shared/lib/posts';
import Avatar from './Avatar';
import { useAuth } from '@/lib/auth';
import { imageUrl } from '@/lib/media';
import { colors, radius, space } from '@/theme';

/** A post: author, text, image, the title it's about, reactions (src/components/PostCard.tsx). */
export default function PostCard({ post: initial, linkToPost = true }: { post: Post; linkToPost?: boolean }) {
  const { user } = useAuth();
  const [post, setPost] = useState(initial);
  const [picking, setPicking] = useState(false);
  const shown = post.repost_source && !post.body ? post.repost_source : post;

  const react = (reaction: Reaction | null) => {
    if (!user) return router.push('/login');
    const previous = post;
    setPost({ ...post, my_reaction: reaction, reaction_counts: applyReactionDelta(post.reaction_counts, post.my_reaction, reaction) });
    setPicking(false);
    setReaction(post.id, reaction).catch(() => setPost(previous));
  };
  const total = Object.values(post.reaction_counts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Pressable disabled={!linkToPost} onPress={() => router.push(`/p/${post.id}`)} style={styles.card}>
      {post.repost_source && !post.body && (
        <View style={styles.repostLine}>
          <Repeat2 size={13} color={colors.muted} />
          <Text style={styles.muted}>{post.display_name || post.username} reposted</Text>
        </View>
      )}
      <Pressable style={styles.author} onPress={() => router.push(`/u/${shown.username}`)}>
        <Avatar uri={shown.avatar_url} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{shown.display_name || shown.username}</Text>
          <Text style={styles.muted}>
            @{shown.username} · {timeAgo(shown.created_at)}
            {post.channel_name ? ` · #${post.channel_name}` : ''}
          </Text>
        </View>
      </Pressable>
      {!!shown.body && <Text style={styles.body}>{shown.body}</Text>}
      {shown.image_url && <Image source={shown.image_url} style={styles.image} contentFit="cover" />}
      {shown.media_type && shown.media_id && (
        <Pressable
          style={styles.media}
          onPress={() => router.push(shown.media_type === 'tv' && shown.season ? `/tv/${shown.media_id}?season=${shown.season}&episode=${shown.episode ?? 1}` : `/${shown.media_type}/${shown.media_id}`)}
        >
          {shown.poster_path && <Image source={imageUrl(shown.poster_path, 'w185')} style={styles.poster} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.mediaLabel}>{shown.media_type === 'tv' ? 'TV show' : 'Movie'}</Text>
            <Text style={styles.mediaTitle} numberOfLines={2}>
              {shown.media_title}
              {shown.season ? ` · S${shown.season}E${shown.episode ?? 1}` : ''}
            </Text>
          </View>
        </Pressable>
      )}
      {picking && (
        <View style={styles.picker}>
          {REACTIONS.map((r) => (
            <Pressable key={r} onPress={() => react(post.my_reaction === r ? null : r)} style={[styles.pick, post.my_reaction === r && { backgroundColor: 'rgba(255,153,0,0.2)' }]}>
              <Text style={{ fontSize: 22 }}>{REACTION_EMOJI[r]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.actions}>
        <Pressable onPress={() => setPicking((p) => !p)} onLongPress={() => setPicking(true)} style={styles.action} hitSlop={6}>
          <Text style={{ fontSize: 15 }}>{post.my_reaction ? REACTION_EMOJI[post.my_reaction] : '🙂'}</Text>
          <Text style={[styles.actionText, post.my_reaction && { color: colors.accent }]}>{total || 'React'}</Text>
        </Pressable>
        <View style={styles.action}>
          <MessageCircle size={16} color={colors.muted} />
          <Text style={styles.actionText}>{post.comment_count}</Text>
        </View>
        <View style={styles.action}>
          <Repeat2 size={16} color={post.i_reposted ? colors.accent : colors.muted} />
          <Text style={styles.actionText}>{post.repost_count}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: colors.white5 },
  repostLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { color: colors.foreground, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12 },
  body: { color: colors.white90, fontSize: 15, lineHeight: 21 },
  image: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.md, backgroundColor: colors.card },
  media: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  poster: { width: 40, height: 60, borderRadius: 6 },
  mediaLabel: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  mediaTitle: { color: colors.foreground, fontWeight: '700' },
  picker: { flexDirection: 'row', gap: 4, alignSelf: 'flex-start', padding: 4, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  pick: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.xl },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
