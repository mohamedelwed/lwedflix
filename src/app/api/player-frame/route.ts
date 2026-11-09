// A page holding one server's player, embedded the way VideoPlayer embeds
// it (no referrer). The desktop app's hidden helper (electron/resolver.js)
// loads it to find an episode's stream for a season download. Only the
// servers the app uses may be framed.

const HOSTS = new Set(['vidsrc.me', 'vidcore.org', 'www.2embed.cc', 'player.videasy.to']);

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET(request: Request) {
  const src = new URL(request.url).searchParams.get('src') ?? '';
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return new Response('Bad src', { status: 400 });
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return new Response('Not a player', { status: 400 });
  const html = `<!doctype html><html><body style="margin:0;background:#000"><iframe src="${escape(url.href)}" style="border:0;width:100vw;height:100vh" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture *; fullscreen" referrerpolicy="no-referrer"></iframe></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
