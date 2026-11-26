// What the player's WebView may navigate to. The servers' ads try to take
// over the whole page (a top-frame redirect) or hand off to another app
// (intent://, market://); only the wrapper page itself may be the top frame,
// and frames may only load web pages.
import { WRAPPER_BASE_URL } from './bridge';

export function isAllowedPlayerNavigation(url: string, isTopFrame: boolean, _navigationType?: string): boolean {
  if (url === 'about:blank' || url.startsWith('about:srcdoc')) return true;
  if (isTopFrame) return url.startsWith(WRAPPER_BASE_URL) || url.startsWith('data:');
  return /^(https?|blob|data):/i.test(url);
}
