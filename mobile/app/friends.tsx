import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Check, MessageCircle, UserPlus, X } from 'lucide-react-native';
import {
  buildInviteUrl,
  getFriends,
  getIncomingRequests,
  getMyInviteCode,
  getOutgoingRequests,
  respondToRequest,
  cancelRequest,
  type Friend,
  type PendingRequest,
  type PublicProfile,
} from '@shared/lib/friends';
import { getFriendsWatching, type WatchingFriend } from '@shared/lib/presence';
import { openThread } from '@shared/lib/dm';
import PersonRow from '@/components/PersonRow';
import RequireAuth from '@/components/RequireAuth';
import { EmptyState } from '@/components/States';
import { colors, radius, space, type } from '@/theme';

/** Friends, requests, and what friends are watching now (src/app/friends/page.tsx). */
export default function FriendsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Friends' }} />
      <RequireAuth what="friends">
        <Friends />
      </RequireAuth>
    </>
  );
}

function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [watching, setWatching] = useState<WatchingFriend[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getFriends(), getIncomingRequests(), getOutgoingRequests(), getFriendsWatching().catch(() => [])])
      .then(([f, i, o, w]) => {
        setFriends(f);
        setIncoming(i);
        setOutgoing(o);
        setWatching(w);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  const invite = async () => {
    const code = await getMyInviteCode().catch(() => null);
    if (code) void Share.share({ message: `Be my friend on Lwedflix: ${buildInviteUrl(code)}` });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Pressable style={styles.invite} onPress={invite}>
        <UserPlus size={18} color="#000" />
        <Text style={styles.inviteText}>Invite a friend</Text>
      </Pressable>
      <Text style={styles.tip}>Or find people by name in Search.</Text>

      {watching.length > 0 && (
        <Section title="Watching now">
          {watching.map((w) => (
            <PersonRow
              key={w.user_id}
              profile={{ username: w.username, display_name: w.display_name, avatar_url: w.avatar_url }}
              detail={w.media_type ? `${w.title}${w.season ? ` · S${w.season}E${w.episode}` : ''}` : 'Watching something'}
              onPress={() =>
                !w.media_type || !w.media_id
                  ? router.push(`/u/${w.username}`)
                  : router.push(w.media_type === 'tv' && w.season ? `/tv/${w.media_id}?season=${w.season}&episode=${w.episode ?? 1}` : `/${w.media_type}/${w.media_id}`)
              }
            />
          ))}
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title="Requests">
          {incoming.map((r) => (
            <PersonRow key={r.requestId} profile={r.profile} detail="wants to be friends" onPress={() => router.push(`/u/${r.profile.username}`)}>
              <RoundButton label="Accept" onPress={() => respondToRequest(r.requestId, true).then(load)}>
                <Check size={16} color="#000" />
              </RoundButton>
              <RoundButton label="Decline" secondary onPress={() => respondToRequest(r.requestId, false).then(load)}>
                <X size={16} color={colors.foreground} />
              </RoundButton>
            </PersonRow>
          ))}
        </Section>
      )}

      <Section title={`Friends · ${friends.length}`}>
        {friends.length === 0 && !loading ? (
          <EmptyState title="No friends yet" text="Invite someone, or accept a request when one comes in." />
        ) : (
          friends.map((f) => (
            <PersonRow key={f.requestId} profile={f.profile} detail={`@${f.profile.username}`} onPress={() => router.push(`/u/${f.profile.username}`)}>
              <RoundButton
                label="Message"
                secondary
                onPress={async () => {
                  const thread = await openThread(f.profile.id);
                  router.push(`/messages/${thread}`);
                }}
              >
                <MessageCircle size={16} color={colors.foreground} />
              </RoundButton>
            </PersonRow>
          ))
        )}
      </Section>

      {outgoing.length > 0 && (
        <Section title="Sent">
          {outgoing.map((r) => (
            <PersonRow key={r.requestId} profile={r.profile} detail="request sent" onPress={() => router.push(`/u/${r.profile.username}`)}>
              <RoundButton label="Cancel request" secondary onPress={() => cancelRequest(r.requestId).then(load)}>
                <X size={16} color={colors.foreground} />
              </RoundButton>
            </PersonRow>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

function RoundButton({ children, onPress, label, secondary }: { children: React.ReactNode; onPress: () => void; label: string; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={[styles.round, secondary && styles.roundSecondary]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  invite: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: 14 },
  inviteText: { color: '#000', fontWeight: '800' },
  tip: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: -space.md },
  section: { ...type.label, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5 },
  name: { color: colors.foreground, fontWeight: '700', fontSize: 15 },
  detail: { color: colors.muted, fontSize: 12 },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  roundSecondary: { backgroundColor: colors.white10 },
});
