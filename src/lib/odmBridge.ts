/**
 * The ODM bridge (electron/preload.js + electron/odm.js).
 *
 * Lwedflix plays through third-party iframes, so the page never sees a media
 * URL. The main process watches the session's media traffic instead, and this
 * is the typed way the player asks it what it saw and sends a choice to ODM.
 *
 * Only exists inside the app: under `npm run dev` in a browser
 * `window.lwedflixOdm` is missing and the download button stays hidden.
 */

export type OdmStreamKind = 'hls' | 'dash' | 'file';

export interface OdmStream {
  id: string;
  kind: OdmStreamKind;
  /** `<last path segment> · <size> · <host>`, for telling rows apart. */
  label: string;
  size?: number;
  host: string;
  /** How long ago it was captured; signed URLs go stale. */
  ageMs: number;
  /** DASH is listed but ODM cannot download it yet. */
  supported: boolean;
}

export interface OdmDownloadMeta {
  title?: string;
  type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export type OdmResult =
  | { ok: true; downloadId: string | null }
  | { ok: false; error: string };

export interface OdmStatus {
  /** ODM's executable is on this machine. */
  installed: boolean;
  /** Its pipe answers right now. */
  running: boolean;
}

export interface OdmBridge {
  /** Pings ODM's pipe; false when it is closed. */
  available(): Promise<boolean>;
  /** Installed vs running — a missing install gets the website, not an error. */
  status(): Promise<OdmStatus>;
  /** Opens ODM's download page in the system browser. */
  openSite(): Promise<{ ok: boolean }>;
  /** Captured streams belonging to the given provider origins. */
  streams(origins: string[]): Promise<OdmStream[]>;
  download(id: string, meta: OdmDownloadMeta): Promise<OdmResult>;
}

declare global {
  interface Window {
    lwedflixOdm?: OdmBridge;
  }
}

export function getOdmBridge(): OdmBridge | null {
  return typeof window === 'undefined' ? null : window.lwedflixOdm ?? null;
}
