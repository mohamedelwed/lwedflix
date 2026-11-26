import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Search, UserRound } from 'lucide-react-native';
import Logo from './Logo';
import { colors, space } from '@/theme';
import { useAuth } from '@/lib/auth';
import { useNavBadges } from '@/lib/badges';

/** The glass bar over the top of the main tabs: logo, search, notifications, account. */
export default function TopBar({ transparent }: { transparent?: boolean }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { notifications } = useNavBadges();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      {!transparent && <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, styles.glass]} />}
      <View style={styles.bar}>
        <Pressable onPress={() => router.navigate('/')} hitSlop={8}>
          <Logo height={18} />
        </Pressable>
        <View style={styles.actions}>
          <Pressable onPress={() => router.push('/search')} hitSlop={10} accessibilityLabel="Search">
            <Search size={22} color={colors.foreground} />
          </Pressable>
          {user && (
            <Pressable onPress={() => router.push('/notifications')} hitSlop={10} accessibilityLabel="Notifications">
              <Bell size={22} color={colors.foreground} />
              {notifications > 0 && <View style={styles.badge} />}
            </Pressable>
          )}
          <Pressable onPress={() => router.push(user ? '/me' : '/login')} hitSlop={10} accessibilityLabel={user ? 'Account' : 'Sign in'}>
            <UserRound size={22} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  glass: { backgroundColor: colors.glass, borderBottomColor: colors.hairline, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  badge: { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
