import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { colors, radius, space } from '@/theme';

export interface SheetOption {
  key: string;
  label: string;
  detail?: string;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** A bottom sheet of choices — the phone's stand-in for the desktop's dropdown menus. */
export default function Sheet({
  visible,
  title,
  options,
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  options?: SheetOption[];
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.handle} />
        {!!title && <Text style={styles.title}>{title}</Text>}
        <ScrollView style={{ maxHeight: 460 }} bounces={false}>
          {options?.map((o) => (
            <Pressable
              key={o.key}
              disabled={o.disabled}
              onPress={() => {
                onClose();
                o.onPress();
              }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.white5 }, o.disabled && { opacity: 0.4 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, o.selected && { color: colors.accent }, o.destructive && { color: colors.danger }]}>{o.label}</Text>
                {!!o.detail && <Text style={styles.detail}>{o.detail}</Text>}
              </View>
              {o.selected && <Check size={18} color={colors.accent} />}
            </Pressable>
          ))}
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderColor: colors.border, borderWidth: 1, paddingTop: space.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.white20, marginBottom: space.sm },
  title: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: space.xl, paddingVertical: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: 14, gap: space.md },
  label: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
