import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import PressableScale from './PressableScale';
import { colors, radius } from '@/theme';

export default function PrimaryButton({ label, onPress, busy, disabled, secondary }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled || busy} style={[styles.button, secondary && styles.secondary, (disabled || busy) && { opacity: 0.5 }]}>
      {busy ? <ActivityIndicator color={secondary ? colors.foreground : '#000'} /> : <Text style={[styles.text, secondary && { color: colors.foreground }]}>{label}</Text>}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center' },
  secondary: { backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  text: { color: '#000', fontWeight: '800', fontSize: 15 },
});
