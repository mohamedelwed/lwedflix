import React from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Download } from 'lucide-react-native';
import { useAsync } from '@/lib/useAsync';
import { colors, radius, space } from '@/theme';

const REPO = (Constants.expoConfig?.extra as { releasesRepo?: string } | undefined)?.releasesRepo ?? 'maysalim-sudo/lwedflix';

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

/**
 * "A new version is out" — the APK doesn't update itself, so this links to
 * the latest GitHub release.
 */
export default function UpdateBanner() {
  const { data } = useAsync('latest-release', async () => {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return (await res.json()) as { tag_name: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
  });
  const current = Application.nativeApplicationVersion;
  if (!data || !current) return null;
  const latest = data.tag_name.replace(/^v/, '');
  if (!newer(latest, current)) return null;
  const apk = data.assets?.find((a) => a.name.endsWith('.apk'));
  return (
    <Pressable style={styles.banner} onPress={() => void Linking.openURL(apk?.browser_download_url ?? data.html_url)}>
      <Download size={16} color="#000" />
      <Text style={styles.text}>Lwedflix {latest} is out — tap to download</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, margin: space.lg, marginBottom: 0, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.accent },
  text: { color: '#000', fontWeight: '700', flex: 1 },
});
