// Types for the desktop download modules reused from ../electron (CommonJS).
declare module '@electron/hls' {
  export interface Segment {
    url: string;
    duration: number;
    sequence: number;
    range?: { offset: number; length: number } | null;
    key?: { method: string; uri: string | null; iv: Uint8Array | null } | null;
  }
  export interface Variant {
    url: string;
    bandwidth: number;
    height: number;
    audio?: string | null;
  }
  export interface Playlist {
    variants: Variant[];
    audio: { group: string; uri?: string | null }[];
    segments: Segment[];
    map: { url: string; range?: { offset: number; length: number } | null } | null;
    master: boolean;
    endList: boolean;
    duration: number;
  }
  export function parsePlaylist(text: string, baseUrl: string): Playlist;
  export function qualities(playlist: Playlist, durationSeconds: number): { index: number; height: number; label: string; bytes: number | null; supported: boolean }[];
  export function pickVariant(playlist: Playlist, index?: number | null, maxHeight?: number | null): Variant | null;
  export function ivFor(segment: Segment): Uint8Array;
  export function tsStart(buf: Uint8Array): number;
}

declare module '@electron/mp4' {
  export interface Init {
    tracks: { id: number; handler: string; width?: number }[];
  }
  export interface FileHandleLike {
    write(buf: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
    close(): Promise<void>;
  }
  export function parseInit(buf: Uint8Array): Init;
  export function parseFragments(buf: Uint8Array, init: Init | null): unknown[];
  export class Mp4Writer {
    static create(file: string, open?: (path: string) => Promise<FileHandleLike>): Promise<Mp4Writer>;
    offset: number;
    readonly duration: number;
    setTracks(init: Init): void;
    addRuns(runs: unknown[]): Promise<void>;
    finish(): Promise<void>;
    abort(): Promise<void>;
  }
}

declare module '@electron/streams' {
  export function classify(url: string, contentType?: string, size?: number): 'hls' | 'dash' | 'file' | null;
  export function qualityOf(url: string): string | null;
  export function formatBytes(bytes?: number): string;
  export function titleFor(meta: { title?: string; type?: string; season?: number; episode?: number }): string;
  export class Registry {
    add(stream: { frameUrl?: string | null; url: string; kind: string; size?: number; mime?: string; requestHeaders?: Record<string, string> }): {
      id: string;
      url: string;
      kind: 'hls' | 'dash' | 'file';
      size?: number;
      frameUrl: string | null;
      requestHeaders: Record<string, string>;
    };
    clear(): void;
    list(origins?: string[]): import('@shared/lib/downloads').StreamOption[];
    get(id: string): { id: string; url: string; kind: 'hls' | 'dash' | 'file'; size?: number; frameUrl: string | null; requestHeaders: Record<string, string> } | null;
  }
}

declare module 'mux.js';
