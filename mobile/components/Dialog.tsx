import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '@/theme';

// The app's own dialog, in place of the system's Alert: same arguments as
// Alert.alert, drawn in the app's design. <DialogHost /> sits once in the
// root layout; dialog() can be called from anywhere.

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface Open {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let current: Open | null = null;
const queue: Open[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());

/** Shows a dialog; with no buttons, a single OK. Dialogs opened meanwhile wait their turn. */
export function dialog(title: string, message?: string, buttons?: DialogButton[]) {
  const next = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
  if (current) queue.push(next);
  else current = next;
  publish();
}

function close(button?: DialogButton) {
  current = queue.shift() ?? null;
  publish();
  // After the dialog is gone: the button may open another, or navigate.
  if (button?.onPress) setTimeout(button.onPress, 0);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => current;

export function DialogHost() {
  const open = useSyncExternalStore(subscribe, snapshot, snapshot);
  const shown = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    shown.setValue(0);
    Animated.timing(shown, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, shown]);

  if (!open) return null;
  const cancel = open.buttons.find((b) => b.style === 'cancel');
  // The main action: the last button that isn't Cancel.
  const main = [...open.buttons].reverse().find((b) => b.style !== 'cancel');
  const stacked = open.buttons.length > 2;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => close(cancel)}>
      <Animated.View style={[styles.scrim, { opacity: shown }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel ? () => close(cancel) : undefined} accessibilityLabel={cancel ? cancel.text : undefined} />
        <Animated.View
          style={[styles.card, { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <Text style={styles.title}>{open.title}</Text>
          {open.message ? <Text style={styles.message}>{open.message}</Text> : null}
          <View style={[styles.buttons, stacked && styles.stacked]}>
            {open.buttons.map((b, i) => {
              const tone = b.style === 'destructive' ? 'danger' : b === main ? 'main' : 'plain';
              return (
                <Pressable
                  key={i}
                  onPress={() => close(b)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, !stacked && styles.grow, tone === 'main' && styles.mainButton, tone === 'danger' && styles.dangerButton, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.buttonText, tone === 'main' && styles.mainText, tone === 'danger' && styles.dangerText]}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.sm,
  },
  title: { ...type.h2, color: colors.foreground },
  message: { ...type.body, color: colors.muted },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  stacked: { flexDirection: 'column-reverse' },
  grow: { flex: 1 },
  button: {
    minHeight: 46,
    paddingHorizontal: space.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white5,
    borderWidth: 1,
    borderColor: colors.white10,
  },
  mainButton: { backgroundColor: colors.accent, borderColor: colors.accent },
  dangerButton: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonText: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  mainText: { color: '#000', fontWeight: '800' },
  dangerText: { color: '#fff', fontWeight: '800' },
});
