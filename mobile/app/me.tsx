import React from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, router, Stack } from 'expo-router';
import * as Application from 'expo-application';
import { Bell, Bookmark, Download, EyeOff, History, LogOut, MapIcon, MessageCircle, Popcorn, Rss, Users } from 'lucide-react-native';
import { getMyProfile } from '@shared/lib/profile';
import { getIncognito, setIncognito } from '@shared/lib/presence';
import ListRow from '@/components/ListRow';
import Avatar from '@/components/Avatar';
import UpdateBanner from '@/components/UpdateBanner';
import { useAuth } from '@/lib/auth';
import { useNavBadges } from '@/lib/badges';
import { useAsync } from '@/lib/useAsync';
import { colors, radius, space } from '@/theme';

/** You: profile, everything from the desktop sidebar, sign out. */
export default function MeScreen() {
  const { user, signOut } = useAuth();
  const badges = useNavBadges();
  const profile = useAsync(user ? `me:${user.id}` : null, getMyProfile);
  const incognito = useAsync(user ? `incognito:${user.id}` : null, getIncognito);
  const [hidden, setHidden] = React.useState<boolean | null>(null);
  const isHidden = hidden ?? incognito.data ?? false;

  if (!user) return <Redirect href="/login" />;
  const p = profile.data;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: 'You' }} />
      <UpdateBanner />
      <View style={styles.cover}>
        {p?.cover_url && <Image source={p.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" />}
      </View>
      <View style={styles.head}>
        <Avatar uri={p?.avatar_url} size={76} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{p?.display_name || p?.username || user.email}</Text>
          {!!p?.username && <Text style={styles.username}>@{p.username}</Text>}
        </View>
      </View>
      {!!p?.bio && <Text style={styles.bio}>{p.bio}</Text>}

      <View style={styles.group}>
        {p?.username && <ListRow icon={Rss} label="Profile & posts" onPress={() => router.push(`/u/${p.username}`)} />}
        <ListRow icon={Bookmark} label="Watchlist" onPress={() => router.push('/watchlist')} />
        <ListRow icon={History} label="History" onPress={() => router.push('/history')} />
        <ListRow icon={Download} label="Downloads" onPress={() => router.navigate('/downloads')} />
      </View>
      <View style={styles.group}>
        <ListRow icon={Popcorn} label="Watch party" detail="Join with a code" onPress={() => router.push('/watch')} />
        <ListRow icon={Users} label="Friends" badge={badges.requests} onPress={() => router.push('/friends')} />
        <ListRow icon={MessageCircle} label="Messages" badge={badges.messages} onPress={() => router.push('/messages')} />
        <ListRow icon={Bell} label="Notifications" badge={badges.notifications} onPress={() => router.push('/notifications')} />
        <ListRow icon={MapIcon} label="Movie Map" detail="35,000 films on one map" onPress={() => router.push('/map')} />
      </View>
      <View style={[styles.group, styles.switchRow]}>
        <View style={styles.switchIcon}>
          <EyeOff size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Incognito</Text>
          <Text style={styles.switchDetail}>Friends don't see what you're watching</Text>
        </View>
        <Switch
          value={isHidden}
          trackColor={{ true: colors.accent, false: colors.white20 }}
          thumbColor="#fff"
          onValueChange={(v) => {
            setHidden(v);
            setIncognito(v).catch(() => setHidden(!v));
          }}
        />
      </View>
      <View style={styles.group}>
        <ListRow
          icon={LogOut}
          label="Sign out"
          destructive
          onPress={() =>
            Alert.alert('Sign out?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                  await signOut();
                  router.replace('/');
                },
              },
            ])
          }
        />
      </View>
      <Text style={styles.version}>Lwedflix {Application.nativeApplicationVersion ?? ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cover: { height: 120, backgroundColor: colors.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, marginTop: -32 },
  name: { color: colors.foreground, fontSize: 22, fontWeight: '800', marginTop: 28 },
  username: { color: colors.muted },
  bio: { color: colors.white70, paddingHorizontal: space.lg, marginTop: space.md },
  group: { marginTop: space.xl, marginHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  switchIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: 'rgba(255,153,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  switchLabel: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  switchDetail: { color: colors.muted, fontSize: 12 },
  version: { color: colors.muted, textAlign: 'center', marginTop: space.xl, fontSize: 12 },
});
