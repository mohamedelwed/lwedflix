import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { imageUrl } from '@/lib/media';
import { colors, radius, space, type } from '@/theme';

export interface Person {
  id: number;
  name: string;
  character?: string;
  job?: string;
  profile_path?: string | null;
}

export default function CastRow({ title, people }: { title: string; people: Person[] }) {
  if (!people.length) return null;
  return (
    <View style={{ marginTop: space.xl }}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(p, i) => `${p.id}-${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        renderItem={({ item }) => (
          <PressableScale style={styles.person} onPress={() => router.push(`/person/${item.id}`)}>
            <View style={styles.photo}>
              {item.profile_path ? (
                <Image source={imageUrl(item.profile_path, 'w185')} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <UserRound color={colors.muted} size={28} />
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.role} numberOfLines={1}>{item.character || item.job || ''}</Text>
          </PressableScale>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.h2, color: colors.foreground, paddingHorizontal: space.lg, marginBottom: space.md },
  person: { width: 88 },
  photo: { width: 88, height: 88, borderRadius: radius.lg, backgroundColor: colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  name: { color: colors.foreground, fontSize: 12, fontWeight: '600', marginTop: 6 },
  role: { color: colors.muted, fontSize: 11 },
});
