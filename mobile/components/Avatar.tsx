import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { colors } from '@/theme';

export default function Avatar({ uri, size }: { uri: string | null | undefined; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline }}>
      {uri ? <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" /> : <UserRound color={colors.muted} size={size * 0.45} />}
    </View>
  );
}

