import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Popcorn } from 'lucide-react-native';
import Field from '@/components/Field';
import PrimaryButton from '@/components/PrimaryButton';
import { colors, space } from '@/theme';
import { parseRoomCode } from '@/lib/party';

export default function JoinPartyScreen() {
  const [input, setInput] = useState('');
  const code = parseRoomCode(input);
  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Watch Party' }} />
      <Popcorn size={48} color={colors.accent} style={{ alignSelf: 'center' }} />
      <Text style={styles.title}>Join friends with a room code</Text>
      <Text style={styles.text}>Start a party from any title with “Watch party”. Anyone can join — on the phone or the computer, no account needed.</Text>
      <Field label="Room code or link" value={input} onChangeText={setInput} autoCapitalize="characters" autoCorrect={false} placeholder="ABC234" onSubmitEditing={() => code && router.push(`/watch/${code}`)} />
      <PrimaryButton label="Join party" disabled={!code} onPress={() => code && router.push(`/watch/${code}`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, padding: space.xl, gap: space.lg },
  title: { color: colors.foreground, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
