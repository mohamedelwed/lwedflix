import { SHIM_SOURCE, WRAPPER_HTML } from './bridge.generated.ts';

// A fresh token per player: the wrapper page and the frames only listen to
// messages that carry it.
export function makeToken(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

export function shimFor(token: string, platform: string): string {
  return SHIM_SOURCE.replace('__LWF_TOKEN__', token).replace("'__PLATFORM__'", JSON.stringify(platform));
}

export function wrapperFor(token: string, initialUrl: string, autoplay: boolean): string {
  return WRAPPER_HTML.replace('__LWF_TOKEN__', token)
    .replace("'__INITIAL_URL__'", JSON.stringify(initialUrl))
    .replace("'__AUTOPLAY__'", autoplay ? "'yes'" : "'no'");
}

/** JavaScript to run in the wrapper page (react-native-webview's injectJavaScript). */
export const js = {
  command: (command: unknown) => `window.__lwfCommand && window.__lwfCommand(${JSON.stringify(command)}); true;`,
  load: (url: string, autoplay: boolean) =>
    `${autoplay ? 'window.__lwfAutoplay && window.__lwfAutoplay();' : ''}window.__lwfLoad && window.__lwfLoad(${JSON.stringify(url)}); true;`,
  autoplay: () => 'window.__lwfAutoplay && window.__lwfAutoplay(); true;',
};

/** Where the wrapper page claims to be; frames see it as their parent's origin. */
export const WRAPPER_BASE_URL = 'https://localhost/player/';

/** What the screens call on a player WebView. */
export interface WebViewRef {
  injectJavaScript(script: string): void;
}
