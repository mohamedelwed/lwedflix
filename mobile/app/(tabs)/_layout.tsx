import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Download, Film, Home, Sparkles, Tv } from 'lucide-react-native';
import { colors } from '@/theme';
import { useActiveDownloads } from '@/downloads/store';

export default function TabsLayout() {
  const active = useActiveDownloads();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: { position: 'absolute', borderTopColor: colors.hairline, backgroundColor: 'transparent', elevation: 0 },
        tabBarBackground: () => <BlurView intensity={50} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Home color={color} size={size - 2} /> }} />
      <Tabs.Screen name="movies" options={{ title: 'Movies', tabBarIcon: ({ color, size }) => <Film color={color} size={size - 2} /> }} />
      <Tabs.Screen name="tv" options={{ title: 'TV Shows', tabBarIcon: ({ color, size }) => <Tv color={color} size={size - 2} /> }} />
      <Tabs.Screen name="anime" options={{ title: 'Anime', tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size - 2} /> }} />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarIcon: ({ color, size }) => <Download color={color} size={size - 2} />,
          tabBarBadge: active > 0 ? active : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#000', fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
