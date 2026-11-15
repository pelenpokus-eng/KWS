// kwsplayer:// — KWS's own HLS player for sites that publish a plain HLS
// stream but have no embeddable player (goodzone.live).
//
//   kwsplayer://goodzone/live/<handle>  → player page for that channel
//   kwsplayer://goodzone/hls.js         → bundled hls.js
//
// The stream address is looked up fresh on every load (main fetches the
// channel page and pulls "playbackUrl" out of it), so a dock never keeps a
// stale address. The page is a bare <video>, so the docks' existing mute,
// volume (webContents) and recording (captureStream) work unchanged.
import { protocol, net } from 'electron'
import hlsSource from '../../node_modules/hls.js/dist/hls.min.js?raw'

export const PLAYER_SCHEME = 'kwsplayer'

export const playerSchemePrivileges = {
  scheme: PLAYER_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}$/

// → { ok: true, url } | { ok: false, offline: true } | { ok: false, error }
async function resolveGoodzone(handle) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await net.fetch(`https://goodzone.live/live/${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pl,en;q=0.8' },
      signal: ctrl.signal,
    })
    if (res.status === 404) return { ok: false, error: 'Nie ma takiego kanału na goodzone.live' }
    if (!res.ok) return { ok: false, error: `goodzone.live odpowiada błędem ${res.status}` }
    const html = await res.text()
    // the page's data is JSON embedded in a script, with escaped quotes
    const m = html.match(/playbackUrl\\?"\s*:\s*\\?"(https:\/\/[^"\\\s]+\.m3u8[^"\\\s]*)/)
    if (!m) return { ok: false, offline: true }
    const url = new URL(m[1])
    if (url.hostname !== 'goodzone.live' && !url.hostname.endsWith('.goodzone.live')) {
      return { ok: false, error: 'Nieoczekiwany adres streamu' }
    }
    return { ok: true, url: url.toString() }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'goodzone.live nie odpowiada' : 'Brak połączenia z goodzone.live' }
  } finally {
    clearTimeout(t)
  }
}

function playerHtml(source) {
  const cfg = JSON.stringify(source).replace(/</g, '\\u003c')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${source.title}</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
  #msg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
       padding:16px;color:#cbd5e1;font:14px/1.5 system-ui,sans-serif;pointer-events:none}
  #msg b{display:block;color:#fff;font-size:16px;margin-bottom:4px}
</style></head>
<body><video id="v" autoplay playsinline></video><div id="msg"></div>
<script src="kwsplayer://goodzone/hls.js"></script>
<script>
(function () {
  var S = ${cfg};
  var video = document.getElementById('v'), msg = document.getElementById('msg');
  function say(title, text) { msg.innerHTML = title ? '<div><b></b><span></span></div>' : ''; if (title) { msg.querySelector('b').textContent = title; msg.querySelector('span').textContent = text || ''; } }
  function retry(sec) { setTimeout(function () { location.reload(); }, sec * 1000); }

  if (!S.url) {
    if (S.offline) { say('Kanał ' + S.handle + ' jest offline', 'Sprawdzam ponownie co 30 s'); retry(30); }
    else { say('Nie udało się wczytać streamu', S.error + ' — ponowna próba za 20 s'); retry(20); }
    return;
  }

  // Quality from the dock's picker: auto | max | 1080 | 720 | 480 | 360
  var wanted = 'auto', hls = null;
  function applyQuality() {
    if (!hls || !hls.levels || !hls.levels.length) return;
    if (wanted === 'auto') { hls.currentLevel = -1; return; }
    var best = -1, bestH = -1, lowest = 0;
    hls.levels.forEach(function (l, i) {
      var h = l.height || 0;
      if (h < (hls.levels[lowest].height || 0)) lowest = i;
      if ((wanted === 'max' || h <= +wanted) && h > bestH) { best = i; bestH = h; }
    });
    hls.currentLevel = best >= 0 ? best : lowest;
  }
  window.__kwsQuality = function (q) { wanted = String(q || 'auto'); applyQuality(); };

  if (!window.Hls || !Hls.isSupported()) { say('Brak obsługi HLS', ''); return; }
  hls = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10, backBufferLength: 30 });
  var mediaErrors = 0, netErrors = 0;
  hls.on(Hls.Events.MANIFEST_PARSED, function () { applyQuality(); video.play().catch(function () {}); });
  hls.on(Hls.Events.FRAG_BUFFERED, function () { say(''); netErrors = 0; });
  hls.on(Hls.Events.ERROR, function (_, d) {
    if (!d.fatal) return;
    console.warn('[kwsplayer] fatal', d.type, d.details, d.response && d.response.code);
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrors++ < 3) { hls.recoverMediaError(); return; }
    // a dropped request: keep the player, just resume loading
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netErrors++ < 4) { setTimeout(function () { hls.startLoad(); }, 2000); return; }
    // stream ended / network dropped: look the channel up again (it may be offline now)
    say('Stream przerwany', 'Ponowna próba za 5 s');
    hls.destroy();
    retry(5);
  });
  say('Ładowanie…', S.handle);
  hls.loadSource(S.url);
  hls.attachMedia(video);
})();
</script></body></html>`
}

export function registerPlayerProtocol() {
  protocol.handle(PLAYER_SCHEME, async (request) => {
    const u = new URL(request.url)
    if (u.hostname !== 'goodzone') return new Response('Not found', { status: 404 })
    if (u.pathname === '/hls.js') {
      return new Response(hlsSource, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })
    }
    const m = u.pathname.match(/^\/live\/([^/]+)\/?$/)
    const handle = m ? decodeURIComponent(m[1]) : ''
    if (!HANDLE_RE.test(handle)) return new Response('Bad channel', { status: 400 })
    const r = await resolveGoodzone(handle)
    const html = playerHtml({ handle, title: `goodzone: ${handle}`, url: r.ok ? r.url : '', offline: !!r.offline, error: r.error || '' })
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  })
}
