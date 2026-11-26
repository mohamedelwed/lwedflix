import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@/theme';

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** Shown when a screen's data didn't load — usually no connection. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Couldn't load this</Text>
      <Text style={styles.text}>{message ?? 'Check your connection and try again.'}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {!!text && <Text style={styles.text}>{text}</Text>}
      {action && (
        <Pressable onPress={action.onPress} style={styles.button}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm, minHeight: 240 },
  title: { color: colors.foreground, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  text: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: { marginTop: space.md, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 20, paddingVertical: 10 },
  buttonText: { color: '#000', fontWeight: '700' },
});
