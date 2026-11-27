import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius } from '@/theme';

export default function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.active]} hitSlop={4}>
      <Text style={[styles.text, active && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { color: colors.white70, fontSize: 13, fontWeight: '600' },
  activeText: { color: '#000' },
});
