import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatBytes } from '@shared/lib/downloads';
import Chip from '@/components/Chip';
import { dialog } from '@/components/Dialog';
import { removeDownload } from '@/downloads/engine';
import { setSettings, useDownloadSettings, type DownloadSettings } from '@/downloads/settings';
import { useDownloadsList } from '@/downloads/store';
import { colors, radius, space, type } from '@/theme';

const QUALITIES: { label: string; value: DownloadSettings['quality'] }[] = [
  { label: 'Ask each time', value: 'ask' },
  { label: 'Best', value: null },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
];
const MB = 1024 * 1024;
const SPEEDS: { label: string; value: number }[] = [
  { label: 'No limit', value: 0 },
  { label: '500 KB/s', value: 512 * 1024 },
  { label: '1 MB/s', value: MB },
  { label: '2 MB/s', value: 2 * MB },
  { label: '5 MB/s', value: 5 * MB },
  { label: '10 MB/s', value: 10 * MB },
];
const PARALLEL: DownloadSettings['parallel'][] = [1, 2, 3];
const WATCHING: { label: string; value: DownloadSettings['whileWatching'] }[] = [
  { label: 'Slow down', value: 'slow' },
  { label: 'Pause', value: 'pause' },
  { label: 'Full speed', value: 'full' },
];

/** How downloads behave: quality, speed, Wi-Fi, how many at once, storage. */
export default function DownloadSettingsScreen() {
  const insets = useSafeAreaInsets();
  const settings = useDownloadSettings();
  const downloads = useDownloadsList();
  const done = downloads.filter((d) => d.state === 'done');
  const used = done.reduce((s, d) => s + (d.bytes || 0), 0);
  let free: number | null = null;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // Unknown on this phone.
  }

  const deleteAll = () =>
    dialog('Delete all downloads?', `${done.length} download${done.length === 1 ? '' : 's'} (${formatBytes(used)}) will be removed from this phone. Downloads in progress stay.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: () => done.forEach((d) => removeDownload(d.id)) },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
      <Stack.Screen options={{ title: 'Download settings' }} />

      <Section title="Quality" hint="Used for every download. Smaller takes less space and downloads faster.">
        <Chips>
          {QUALITIES.map((q) => (
            <Chip key={String(q.value)} label={q.label} active={settings.quality === q.value} onPress={() => setSettings({ quality: q.value })} />
          ))}
        </Chips>
      </Section>

      <Section title="Speed limit" hint="For all downloads together, so streaming and the rest of the phone stay quick.">
        <Chips>
          {SPEEDS.map((s) => (
            <Chip key={s.value} label={s.label} active={settings.speedLimit === s.value} onPress={() => setSettings({ speedLimit: s.value })} />
          ))}
        </Chips>
      </Section>

      <Section title="Downloads at once" hint="The rest wait their turn. One at a time finishes each sooner.">
        <Chips>
          {PARALLEL.map((n) => (
            <Chip key={n} label={String(n)} active={settings.parallel === n} onPress={() => setSettings({ parallel: n })} />
          ))}
        </Chips>
      </Section>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heading}>Wi-Fi only</Text>
          <Text style={styles.hint}>Downloads wait for Wi-Fi, and pause when it goes, so they never use mobile data.</Text>
        </View>
        <Switch
          value={settings.wifiOnly}
          onValueChange={(wifiOnly) => setSettings({ wifiOnly })}
          trackColor={{ true: colors.accent, false: colors.white20 }}
          thumbColor="#fff"
        />
      </View>

      <Section title="While you watch" hint="What downloads do while something plays in Lwedflix, so the picture doesn't stutter.">
        <Chips>
          {WATCHING.map((w) => (
            <Chip key={w.value} label={w.label} active={settings.whileWatching === w.value} onPress={() => setSettings({ whileWatching: w.value })} />
          ))}
        </Chips>
      </Section>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heading}>Download notification</Text>
          <Text style={styles.hint}>
            Progress, MB downloaded, speed and time left, with Pause and Cancel. It also keeps downloads going when Lwedflix is in the background; with it off,
            downloads only run while Lwedflix is open.
          </Text>
        </View>
        <Switch
          value={settings.notification}
          onValueChange={(notification) => setSettings({ notification })}
          trackColor={{ true: colors.accent, false: colors.white20 }}
          thumbColor="#fff"
        />
      </View>

      <Section title="Storage" hint={`Downloads use ${formatBytes(used) || '0 B'}${free != null ? ` · ${formatBytes(free)} free on this phone` : ''}.`}>
        {done.length > 0 && (
          <Pressable onPress={deleteAll} style={({ pressed }) => [styles.danger, pressed && { opacity: 0.8 }]}>
            <Text style={styles.dangerText}>Delete all downloads</Text>
          </Pressable>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.heading}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const Chips = ({ children }: { children: React.ReactNode }) => <View style={styles.chips}>{children}</View>;

const styles = StyleSheet.create({
  heading: { ...type.h2, fontSize: 17, color: colors.foreground },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  danger: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: space.lg, height: 42, borderRadius: radius.full, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
  dangerText: { color: colors.danger, fontWeight: '700' },
});
