import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space } from '@/theme';

/** A labelled text field in the desktop's form style. */
export default function Field({ label, hint, hintColor, ...props }: TextInputProps & { label: string; hint?: string; hintColor?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} selectionColor={colors.accent} style={styles.input} {...props} />
      {!!hint && <Text style={[styles.hint, hintColor ? { color: hintColor } : null]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginLeft: 4 },
  input: { color: colors.foreground, fontSize: 16, backgroundColor: colors.white5, borderColor: colors.hairline, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: 14 },
  hint: { color: colors.muted, fontSize: 11, marginLeft: 4 },
});
