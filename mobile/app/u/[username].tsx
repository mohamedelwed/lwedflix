import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { MessageCircle, UserCheck, UserPlus, Clock } from 'lucide-react-native';
import { supabase } from '@shared/lib/supabase';
import { getProfileByUsername } from '@shared/lib/profile';
import { cancelRequest, respondToRequest, sendFriendRequest, unfriend, type PublicProfile } from '@shared/lib/friends';
import { getUserPosts, type Post } from '@shared/lib/posts';
import { openThread } from '@shared/lib/dm';
import Avatar from '@/components/Avatar';
import ActionButton from '@/components/ActionButton';
import PostCard from '@/components/PostCard';
import { EmptyState, Loading } from '@/components/States';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/theme';

type Relationship = { status: 'none' | 'outgoing' | 'incoming' | 'friends'; requestId?: string };

/** Someone's profile and posts (src/app/u/[username]/page.tsx). */
export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [relation, setRelation] = useState<Relationship>({ status: 'none' });
  const [busy, setBusy] = useState(false);

  const loadRelation = useCallback(
    async (p: PublicProfile) => {
      if (!user || user.id === p.id) return;
      const { data } = await supabase
        .from('friend_requests')
        .select('id, requester_id, addressee_id, status')
        .or(`and(requester_id.eq.${user.id},addressee_id.eq.${p.id}),and(requester_id.eq.${p.id},addressee_id.eq.${user.id})`)
        .in('status', ['pending', 'accepted'])
        .limit(1);
      const row = data?.[0];
      if (!row) return setRelation({ status: 'none' });
      setRelation({ status: row.status === 'accepted' ? 'friends' : row.requester_id === user.id ? 'outgoing' : 'incoming', requestId: String(row.id) });
    },
    [user]
  );

  useEffect(() => {
    let live = true;
    getProfileByUsername(username)
      .then((p) => {
        if (!live) return;
        setProfile(p);
        if (p) {
          void loadRelation(p);
          getUserPosts(p.id)
            .then((rows) => live && setPosts(rows))
            .catch(() => {});
        }
      })
      .catch(() => live && setProfile(null));
    return () => {
      live = false;
    };
  }, [username, loadRelation]);

  if (profile === undefined) return <Loading />;
  if (profile === null) return <EmptyState title="No one by that name" text={`@${username} doesn't exist.`} />;

  const isMe = user?.id === profile.id;
  const run = async (task: () => Promise<void>) => {
    if (!user) return router.push('/login');
    setBusy(true);
    try {
      await task();
      await loadRelation(profile);
    } catch {
      // The button stays as it was.
    } finally {
      setBusy(false);
    }
  };

  const friendButton =
    relation.status === 'friends' ? (
      <ActionButton icon={UserCheck} label="Friends" active busy={busy} onPress={() => run(() => unfriend(relation.requestId!))} />
    ) : relation.status === 'outgoing' ? (
      <ActionButton icon={Clock} label="Requested" busy={busy} onPress={() => run(() => cancelRequest(relation.requestId!))} />
    ) : relation.status === 'incoming' ? (
      <ActionButton icon={UserPlus} label="Accept request" primary busy={busy} onPress={() => run(() => respondToRequest(relation.requestId!, true))} />
    ) : (
      <ActionButton icon={UserPlus} label="Add friend" primary busy={busy} onPress={() => run(() => sendFriendRequest(profile.id))} />
    );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={posts}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ paddingBottom: space.xxl, gap: space.md }}
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: profile.display_name || profile.username }} />
          <View style={styles.cover}>{profile.cover_url && <Image source={profile.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" />}</View>
          <View style={styles.head}>
            <Avatar uri={profile.avatar_url} size={84} />
            <Text style={styles.name}>{profile.display_name || profile.username}</Text>
            <Text style={styles.username}>@{profile.username}</Text>
            {!!profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
            {!isMe && (
              <View style={styles.buttons}>
                {friendButton}
                {relation.status === 'friends' && (
                  <ActionButton
                    icon={MessageCircle}
                    label="Message"
                    onPress={async () => {
                      const thread = await openThread(profile.id);
                      router.push(`/messages/${thread}`);
                    }}
                  />
                )}
              </View>
            )}
          </View>
          <Text style={styles.section}>Posts</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: space.lg }}>
          <PostCard post={item} />
        </View>
      )}
      ListEmptyComponent={<Pressable><Text style={[styles.username, { textAlign: 'center', padding: space.xl }]}>No posts to show.</Text></Pressable>}
    />
  );
}

const styles = StyleSheet.create({
  cover: { height: 140, backgroundColor: colors.card },
  head: { alignItems: 'center', marginTop: -42, paddingHorizontal: space.lg, gap: 4 },
  name: { color: colors.foreground, fontSize: 22, fontWeight: '800', marginTop: space.sm },
  username: { color: colors.muted },
  bio: { color: colors.white70, textAlign: 'center', marginTop: space.sm, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  section: { color: colors.foreground, fontSize: 18, fontWeight: '700', padding: space.lg, paddingBottom: space.sm },
});
