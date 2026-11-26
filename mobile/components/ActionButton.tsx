import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius } from '@/theme';

/** The rounded glass buttons under a title (watchlist, share, party…). */
export default function ActionButton({
  icon: Icon,
  label,
  onPress,
  active,
  busy,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  const fg = primary ? '#000' : active ? colors.accent : colors.foreground;
  return (
    <PressableScale onPress={onPress} style={[styles.button, primary && styles.primary, active && styles.active]} disabled={busy}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon size={16} color={fg} fill={active && !primary ? colors.accent : 'transparent'} />}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.lg, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  active: { borderColor: 'rgba(255,153,0,0.4)', backgroundColor: 'rgba(255,153,0,0.08)' },
  label: { fontSize: 13, fontWeight: '700' },
});
