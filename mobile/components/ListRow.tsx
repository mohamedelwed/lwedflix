import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { colors, radius, space } from '@/theme';

/** A menu row: icon, label, optional badge, chevron. */
export default function ListRow({ icon: Icon, label, detail, badge, onPress, destructive }: { icon: LucideIcon; label: string; detail?: string; badge?: number; onPress: () => void; destructive?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.white5 }]}>
      <View style={styles.icon}>
        <Icon size={18} color={destructive ? colors.danger : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, destructive && { color: colors.danger }]}>{label}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {!!badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      {!destructive && <ChevronRight size={18} color={colors.white20} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 },
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: 'rgba(255,153,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12, marginTop: 1 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#000', fontSize: 11, fontWeight: '800' },
});
