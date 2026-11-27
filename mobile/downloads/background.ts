import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';
import { formatBytes, formatEta } from '@shared/lib/downloads';
import { LwfDownloads } from '@/modules/lwf-downloads';
import { cancelDownload, pauseDownload, resumeDownload } from './engine';
import { getSettings, onSettings } from './settings';
import { getDownloads, isActive, onDownloads, type StoredDownload } from './store';

// The ongoing download notification (progress, MB so far, speed, time
// left; Pause / Resume / Cancel all) and, behind it, the background service
// that keeps downloads going when Lwedflix isn't on screen
// (modules/lwf-downloads). A notification when each one finishes or fails.
// With the notification switched off in the settings, downloads only run
// while Lwedflix is open.

const TASK = 'LwfDownloads';
const UPDATE_MS = 1000;

/** Roughly what a download will weigh in the end: what it has, scaled by how far along it is. */
export function expectedBytes(d: StoredDownload): number | null {
  if (d.totalBytes) return d.totalBytes;
  return d.progress > 0.02 && d.bytes > 0 ? d.bytes / d.progress : null;
}

/** "312 MB of ≈ 1.1 GB" — what a download has, and roughly what it will. */
export function sizeLine(d: StoredDownload): string {
  const total = expectedBytes(d);
  const have = formatBytes(d.bytes) || '0 MB';
  return total ? `${have} of ${d.totalBytes ? '' : '≈ '}${formatBytes(total)}` : have;
}

const running = (d: StoredDownload) => isActive(d) && !d.held;

let taskDone: (() => void) | null = null;
let shown = false;
let lastUpdate = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const lastState = new Map<string, StoredDownload['state']>();

/** In index.js, before the app starts: the task the background service runs. */
export function registerDownloadTask() {
  AppRegistry.registerHeadlessTask(TASK, () => () =>
    new Promise<void>((resolve) => {
      taskDone = resolve;
      refresh();
    })
  );
}

function summary(list: StoredDownload[]) {
  const paused = list.every((d) => d.state === 'paused');
  const moving = list.filter((d) => d.state === 'downloading');
  const bytes = list.reduce((s, d) => s + d.bytes, 0);
  const totals = list.map(expectedBytes);
  const total = totals.every((t) => t) ? totals.reduce((s, t) => s! + t!, 0)! : null;
  const speed = moving.reduce((s, d) => s + d.speed, 0);
  const percent = total ? Math.min(100, Math.round((bytes / total) * 100)) : Math.round((list.reduce((s, d) => s + d.progress, 0) / list.length) * 100);
  const eta = moving.length ? Math.max(...moving.map((d) => d.eta ?? 0)) : null;

  const title =
    list.length === 1
      ? `${paused ? 'Paused' : 'Downloading'} · ${list[0].title}`
      : `${paused ? 'Paused' : 'Downloading'} ${list.length} titles${moving.length && moving.length < list.length ? ` · ${moving.length} now` : ''}`;
  const parts = [
    total ? `${formatBytes(bytes) || '0 MB'} of ≈ ${formatBytes(total)}` : `${formatBytes(bytes) || '0 MB'}`,
    paused ? null : speed ? `${formatBytes(speed)}/s` : list.some((d) => d.state === 'resolving') ? 'finding the stream…' : 'starting…',
    paused ? null : eta ? formatEta(eta) : null,
  ];
  return { title, text: parts.filter(Boolean).join(' · '), percent, indeterminate: !speed && percent === 0 && !paused, paused };
}

function refresh() {
  if (!LwfDownloads) return;
  const now = Date.now();
  if (now - lastUpdate < UPDATE_MS) {
    timer ??= setTimeout(() => {
      timer = null;
      refresh();
    }, UPDATE_MS);
    return;
  }
  lastUpdate = now;

  const list = getDownloads();
  // Finished and failed since last time: one notification each.
  for (const d of list) {
    const before = lastState.get(d.id);
    if (before && before !== d.state && isActive({ ...d, state: before })) {
      if (d.state === 'done') LwfDownloads.notify(d.id, 'Ready to watch offline', d.title);
      else if (d.state === 'failed') LwfDownloads.notify(d.id, `Couldn't download ${d.title}`, d.error ?? 'Tap to see it in Downloads.');
    }
    lastState.set(d.id, d.state);
  }

  const active = list.filter(running);
  if (active.length === 0 || !getSettings().notification) {
    if (shown) LwfDownloads.hide();
    shown = false;
    taskDone?.();
    taskDone = null;
    return;
  }
  const s = summary(active);
  LwfDownloads.show(s.title, s.text, s.percent, s.indeterminate, s.paused);
  shown = true;
}

let started = false;
/** From the root layout: follows the downloads, asks once to show notifications, wires the buttons. */
export function startBackgroundDownloads() {
  if (started || !LwfDownloads || Platform.OS !== 'android') return;
  started = true;
  for (const d of getDownloads()) lastState.set(d.id, d.state);
  onDownloads(refresh);
  onSettings(refresh);
  LwfDownloads.addListener('onAction', ({ action }) => {
    const list = getDownloads().filter(running);
    if (action === 'pause') list.forEach((d) => pauseDownload(d.id));
    else if (action === 'resume') list.forEach((d) => resumeDownload(d.id));
    else if (action === 'cancel') list.forEach((d) => cancelDownload(d.id));
    lastUpdate = 0;
    refresh();
  });
  if (Number(Platform.Version) >= 33) {
    void PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(() => {});
  }
  refresh();
}
