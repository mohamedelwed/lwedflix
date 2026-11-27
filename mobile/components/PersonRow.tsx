import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PublicProfile } from '@shared/lib/friends';
import Avatar from './Avatar';
import { colors, radius, space } from '@/theme';

export default function PersonRow({
  profile,
  detail,
  onPress,
  children,
}: {
  profile: Pick<PublicProfile, 'username' | 'display_name' | 'avatar_url'>;
  detail?: string;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
      <Avatar uri={profile.avatar_url} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{profile.display_name || profile.username}</Text>
        {!!detail && <Text style={styles.detail} numberOfLines={1}>{detail}</Text>}
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5 },
  name: { color: colors.foreground, fontWeight: '700', fontSize: 15 },
  detail: { color: colors.muted, fontSize: 12 },
});
