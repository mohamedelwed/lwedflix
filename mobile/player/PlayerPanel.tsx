import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Captions, Check, Gauge, Server, SlidersHorizontal, X } from 'lucide-react-native';
import { colors, radius, space } from '@/theme';

// The player's settings in one place — server, subtitles, speed and more —
// instead of a sheet per menu. In fullscreen it slides in from the right
// and leaves the picture in view; on the small player it's a bottom sheet.

export type PanelTab = 'server' | 'subtitles' | 'speed' | 'more';

export interface PanelData {
  servers: { name: string; selected: boolean }[];
  tracks: { label: string; language?: string; selected: boolean }[];
  subtitlesOff: boolean;
  speeds: number[];
  rate: number;
  serverControls: boolean;
  gestures: boolean;
}

export interface PanelActions {
  pickServer(index: number): void;
  pickTrack(index: number): void;
  pickSpeed(rate: number): void;
  setServerControls(on: boolean): void;
  setGestures(on: boolean): void;
}

const TABS: { key: PanelTab; label: string; icon: typeof Server }[] = [
  { key: 'server', label: 'Server', icon: Server },
  { key: 'subtitles', label: 'Subtitles', icon: Captions },
  { key: 'speed', label: 'Speed', icon: Gauge },
  { key: 'more', label: 'More', icon: SlidersHorizontal },
];

export default function PlayerPanel({
  open,
  tab,
  fullscreen,
  data,
  actions,
  onTab,
  onClose,
}: {
  open: boolean;
  tab: PanelTab;
  fullscreen: boolean;
  data: PanelData;
  actions: PanelActions;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shown = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(shown, { toValue: open ? 1 : 0, duration: open ? 220 : 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, shown]);

  const body = <PanelBody tab={tab} data={data} actions={actions} onTab={onTab} onClose={onClose} compact={fullscreen} />;

  if (fullscreen) {
    if (!mounted) return null;
    const panelWidth = Math.min(400, Math.max(300, width * 0.4));
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
        {/* The picture stays in view; a tap on it closes the panel. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: shown }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close settings" />
        </Animated.View>
        <Animated.View
          style={[
            styles.side,
            { width: panelWidth + insets.right, paddingRight: insets.right, paddingTop: Math.max(insets.top, space.md), paddingBottom: Math.max(insets.bottom, space.md) },
            { transform: [{ translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [panelWidth + insets.right, 0] }) }] },
          ]}
        >
          {body}
        </Animated.View>
      </View>
    );
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close settings" />
      <View style={[styles.sheet, { maxHeight: height * 0.72, paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.handle} />
        {body}
      </View>
    </Modal>
  );
}

function PanelBody({
  tab,
  data,
  actions,
  onTab,
  onClose,
  compact,
}: {
  tab: PanelTab;
  data: PanelData;
  actions: PanelActions;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  compact: boolean;
}) {
  const tabs = TABS.filter((t) => t.key !== 'subtitles' || data.tracks.length > 0);
  return (
    <View style={{ flexShrink: 1 }}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((t) => {
            const active = t.key === tab;
            const Icon = t.icon;
            return (
              <Pressable key={t.key} onPress={() => onTab(t.key)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Icon size={15} color={active ? '#000' : colors.white90} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close settings">
          <X size={18} color={colors.white90} />
        </Pressable>
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: space.sm }} bounces={false}>
        {tab === 'server' && (
          <>
            <Text style={styles.hint}>If it doesn’t play, another server usually does. Lwedflix also switches by itself.</Text>
            {data.servers.map((s, i) => (
              <Row key={s.name} label={s.name} selected={s.selected} tag={s.selected ? 'Playing' : undefined} onPress={() => actions.pickServer(i)} compact={compact} />
            ))}
          </>
        )}

        {tab === 'subtitles' && (
          <>
            <Row label="Off" selected={data.subtitlesOff} onPress={() => actions.pickTrack(-1)} compact={compact} />
            {data.tracks.map((t, i) => (
              <Row key={`${i}-${t.label}`} label={t.label} tag={t.language} selected={t.selected} onPress={() => actions.pickTrack(i)} compact={compact} />
            ))}
          </>
        )}

        {tab === 'speed' && (
          <View style={styles.speedGrid}>
            {data.speeds.map((s) => {
              const active = s === data.rate;
              return (
                <Pressable key={s} onPress={() => actions.pickSpeed(s)} style={[styles.speed, active && styles.speedActive]} accessibilityState={{ selected: active }}>
                  <Text style={[styles.speedText, active && styles.speedTextActive]}>{s === 1 ? 'Normal' : `${s}×`}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === 'more' && (
          <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.rowLabel}>Gestures</Text>
              <Text style={styles.rowDetail}>Double-tap the sides to skip 10 s; in fullscreen, swipe up and down on the left for brightness, on the right for volume.</Text>
            </View>
            <Switch value={data.gestures} onValueChange={actions.setGestures} trackColor={{ true: colors.accent, false: colors.white20 }} thumbColor="#fff" />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.rowLabel}>Server’s own controls</Text>
              <Text style={styles.rowDetail}>Shows the server’s menus instead of Lwedflix’s — for its qualities or its own subtitles. Its ads can come with them.</Text>
            </View>
            <Switch value={data.serverControls} onValueChange={actions.setServerControls} trackColor={{ true: colors.accent, false: colors.white20 }} thumbColor="#fff" />
          </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, tag, selected, onPress, compact }: { label: string; tag?: string; selected: boolean; onPress: () => void; compact: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, selected && styles.rowSelected, pressed && { backgroundColor: colors.white10 }]}
    >
      <Text style={[styles.rowLabel, selected && { color: colors.accent }]} numberOfLines={1}>
        {label}
      </Text>
      {tag ? (
        <View style={[styles.tag, selected && styles.tagSelected]}>
          <Text style={[styles.tagText, selected && { color: colors.accent }]}>{tag}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {selected && <Check size={18} color={colors.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  side: { position: 'absolute', top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16,16,16,0.97)', borderLeftWidth: 1, borderColor: colors.border, paddingLeft: space.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderColor: colors.border, borderWidth: 1, paddingTop: space.sm, paddingHorizontal: space.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.white20, marginBottom: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  tabs: { gap: 6, paddingRight: space.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.full, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.white10 },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { color: colors.white90, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: '#000' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white5, marginLeft: 'auto' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, paddingHorizontal: space.sm, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md },
  rowCompact: { minHeight: 46 },
  rowSelected: { backgroundColor: 'rgba(255,153,0,0.1)' },
  rowLabel: { color: colors.foreground, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowDetail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.white10 },
  tagSelected: { backgroundColor: 'rgba(255,153,0,0.18)' },
  tagText: { color: colors.white70, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  speedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xs, paddingTop: space.xs },
  speed: { minWidth: 76, height: 48, paddingHorizontal: space.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.white10 },
  speedActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  speedText: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  speedTextActive: { color: '#000' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, paddingVertical: space.sm },
});
