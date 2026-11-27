import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { REACTIONS, type Reaction } from '@shared/lib/watchRoom';
import { colors, radius } from '@/theme';

export interface FloatingReaction {
  id: string;
  emoji: Reaction;
  name: string;
  /** Horizontal start, as a percentage of the player's width. */
  x: number;
}

function Floating({ r }: { r: FloatingReaction }) {
  const t = useSharedValue(0);
  React.useEffect(() => {
    t.value = withTiming(1, { duration: 2600, easing: Easing.out(Easing.cubic) });
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.15 ? t.value / 0.15 : t.value > 0.8 ? (1 - t.value) / 0.2 : 1,
    transform: [{ translateY: -180 * t.value }, { scale: 0.7 + 0.4 * Math.min(1, t.value * 3) }],
  }));
  return (
    <Animated.View style={[styles.floating, { left: `${r.x}%` }, style]}>
      <Text style={styles.emoji}>{r.emoji}</Text>
      <Text style={styles.name}>{r.name}</Text>
    </Animated.View>
  );
}

/** Reactions rising over the video (src/components/party/Reactions.tsx). */
export function ReactionsOverlay({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {reactions.map((r) => (
        <Floating key={r.id} r={r} />
      ))}
    </View>
  );
}

/** The row of reaction buttons, rate-limited so holding one can't flood the room. */
export function ReactionBar({ onReact }: { onReact: (emoji: Reaction) => void }) {
  const last = useRef(0);
  return (
    <Animated.View entering={FadeIn} style={styles.bar}>
      {REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => {
            if (Date.now() - last.current < 350) return;
            last.current = Date.now();
            void Haptics.selectionAsync();
            onReact(emoji);
          }}
          style={({ pressed }) => [styles.button, pressed && { transform: [{ scale: 0.88 }], backgroundColor: colors.white10 }]}
          accessibilityLabel={`React ${emoji}`}
        >
          <Text style={{ fontSize: 22 }}>{emoji}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute', bottom: 24, alignItems: 'center' },
  emoji: { fontSize: 34, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 10 },
  name: { marginTop: 2, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)', color: colors.white90, fontSize: 10, fontWeight: '700' },
  bar: { flexDirection: 'row', gap: 2 },
  button: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
