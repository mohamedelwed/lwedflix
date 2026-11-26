import { useSyncExternalStore } from 'react';
import type { Download } from '@shared/lib/downloads';

// The download list: kept in localStorage (expo-sqlite's) so it survives
// restarts, published to every screen that shows it. engine.ts is the only
// writer.

const KEY = 'lwedflix:downloads';

/** A download as the phone keeps it: the desktop's shape, plus where its files are. */
export interface StoredDownload extends Download {
  /** The video file's URI once finished (or while being written, for HLS). */
  fileUri: string | null;
  /** The saved poster's URI. */
  posterUri: string | null;
}

let list: StoredDownload[] = load();
const listeners = new Set<() => void>();

function load(): StoredDownload[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // Storage full: the files are still there; the list rebuilds what it can.
    }
  }, 400);
}

export function getDownloads(): StoredDownload[] {
  return list;
}

export function getDownload(id: string): StoredDownload | undefined {
  return list.find((d) => d.id === id);
}

export function putDownload(download: StoredDownload) {
  const i = list.findIndex((d) => d.id === download.id);
  list = i === -1 ? [download, ...list] : list.map((d) => (d.id === download.id ? download : d));
  persist();
  listeners.forEach((l) => l());
}

export function updateDownload(id: string, patch: Partial<StoredDownload>) {
  const current = getDownload(id);
  if (current) putDownload({ ...current, ...patch });
}

export function deleteDownload(id: string) {
  list = list.filter((d) => d.id !== id);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const isActive = (d: Download) => d.state === 'queued' || d.state === 'resolving' || d.state === 'downloading' || d.state === 'paused';

export function useDownloadsList(): StoredDownload[] {
  return useSyncExternalStore(subscribe, getDownloads, getDownloads);
}

/** How many are downloading or waiting, for the tab badge. */
export function useActiveDownloads(): number {
  return useDownloadsList().filter(isActive).length;
}
