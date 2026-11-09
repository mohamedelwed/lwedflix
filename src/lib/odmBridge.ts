/**
 * The ODM bridge (electron/preload.js + electron/odm.js), Windows only.
 *
 * ODM is a download manager; with it installed, the player's Download menu
 * can hand a stream to it instead of downloading it in Lwedflix. The streams
 * themselves come from the downloads bridge (src/lib/downloads.ts). Outside
 * the Windows app `window.lwedflixOdm` is missing and the option isn't shown.
 */

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
  status(): Promise<OdmStatus>;
  /** Opens ODM's download page in the system browser. */
  openSite(): Promise<{ ok: boolean }>;
  /** Sends a captured stream (by its id from the downloads bridge) to ODM. */
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
