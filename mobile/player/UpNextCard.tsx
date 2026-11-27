import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Play, X } from 'lucide-react-native';
import type { PlayerState } from './types';
import { colors, radius, space } from '@/theme';

/** Shown this close to the end, or when the episode ends (src/components/UpNextCard.tsx). */
const SHOW_WITHIN_S = 20;
const COUNTDOWN_S = 10;

/** "Up next" as an episode finishes, counting down to the next one. Give it a `key` per episode. */
export default function UpNextCard({
  state,
  next,
  name,
  onPlayNext,
}: {
  state: PlayerState | null;
  next: { season: number; episode: number };
  name?: string;
  onPlayNext: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState(COUNTDOWN_S);
  const nearEnd =
    state !== null && (state.event === 'ended' || (state.duration > 0 && state.duration - state.time <= SHOW_WITHIN_S && state.time > 60));
  const visible = nearEnd && !dismissed;

  const playNext = useRef(onPlayNext);
  playNext.current = onPlayNext;

  useEffect(() => {
    if (!visible) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const left = COUNTDOWN_S - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(left, 0));
      if (left <= 0) {
        clearInterval(timer);
        playNext.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(160)} style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Up next</Text>
          <Text style={styles.name} numberOfLines={1}>
            S{next.season} E{next.episode}
            {name ? ` · ${name}` : ''}
          </Text>
        </View>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} accessibilityLabel="Cancel autoplay">
          <X color={colors.white60} size={16} />
        </Pressable>
      </View>
      <Pressable onPress={onPlayNext} style={styles.button}>
        <View style={[styles.drain, { width: `${(remaining / COUNTDOWN_S) * 100}%` }]} />
        <Play size={14} color="#000" fill="#000" />
        <Text style={styles.buttonText}>Play now · {remaining}s</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', right: space.md, bottom: 64, width: 240, zIndex: 20, backgroundColor: 'rgba(0,0,0,0.85)', borderColor: colors.hairline, borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', gap: space.sm },
  label: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase' },
  name: { color: '#fff', fontSize: 13, fontWeight: '700' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.md, backgroundColor: '#fff', overflow: 'hidden' },
  drain: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,153,0,0.3)' },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 13 },
});
