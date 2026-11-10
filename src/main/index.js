import { app, BrowserWindow, ipcMain, dialog, protocol, webContents, webFrameMain, net } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { writeFileSync, readFile } from 'fs'
import { createServer } from 'http'
import { normalize, extname, sep } from 'path'
import appIcon from '../../resources/icon.png?asset'

// Enable autoplay without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Register custom protocol for stream wrappers BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appstream',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      allowServiceWorkers: false,
    }
  }
])

const store = new Store()

// Production renderer is served over http://localhost (not file://), exactly
// like the dev server. YouTube embeds refuse to play without an HTTP Referer
// (error 153) and Twitch embeds check parent=localhost — both fail on file://.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
}

function startRendererServer() {
  const root = join(__dirname, '../renderer')
  return new Promise(resolve => {
    const srv = createServer((req, res) => {
      let rel = decodeURIComponent((req.url || '/').split('?')[0])
      if (rel === '/') rel = '/index.html'
      const file = normalize(join(root, rel))
      if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
      readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' })
        res.end(data)
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port))
  })
}

function chatWrapperHtml(room) {
  const safeRoom = room.replace(/[^a-zA-Z0-9_-]/g, '')
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#1a1a1a}</style>
</head>
<body>
<script>
var s=document.createElement('script');s.async=true;s.setAttribute('data-cfasync','false');
s.setAttribute('data-cid','${safeRoom}');s.style.cssText='width:100%;height:100%;';
s.src='https://st.chatango.com/js/gz/emb.js';document.body.appendChild(s);
</script>
</body></html>`
}

function streamWrapperHtml(src) {
  const safeSrc = src.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100vw;height:100vh;overflow:hidden;background:#000}
iframe{position:fixed;top:0;left:0;width:100vw;height:100vh;border:0}
</style>
</head>
<body>
<iframe
  src="${safeSrc}"
  allowfullscreen
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  frameborder="0"
  scrolling="no"
></iframe>
</body>
</html>`
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'default',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  // Strip Electron identifier from UA — some embeds (YouTube) reject non-browser agents
  const rawUA = mainWindow.webContents.session.getUserAgent()
  mainWindow.webContents.session.setUserAgent(rawUA.replace(/\s*Electron\/[^\s]+/, ''))

  // Allow all permissions for stream embeds (autoplay, fullscreen, media)
  mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback) => {
    callback(true)
  })

  // Allow navigation in webviews (needed for stream players)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"]
      }
    })
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    startRendererServer().then(port => mainWindow.loadURL(`http://localhost:${port}/`))
  }

  return mainWindow
}

app.whenReady().then(() => {
  // Handle appstream:// — serves a full-viewport iframe wrapper for any player URL
  protocol.handle('appstream', (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'chat') {
      const room = url.searchParams.get('room') || 'raszei'
      const html = chatWrapperHtml(room)
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    // hostname 'localhost' used so Twitch parent=localhost check passes
    const src = url.searchParams.get('src') || ''
    const html = streamWrapperHtml(src)
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  })

  const mainWindow = createWindow()

  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))

  ipcMain.handle('save-screenshot', async (_, dataUrl, label) => {
    const name = (label || 'stream').replace(/[^a-zA-Z0-9_-]/g, '_')
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Zapisz screenshot',
      defaultPath: `${name}_${Date.now()}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      writeFileSync(filePath, base64, 'base64')
      return { success: true, path: filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  function findFrame(embedUrl) {
    try {
      const eUrl = new URL(embedUrl)
      for (const frame of mainWindow.webContents.mainFrame.framesInSubtree) {
        if (!frame.url || frame.url === 'about:blank') continue
        try {
          const fUrl = new URL(frame.url)
          if (fUrl.hostname !== eUrl.hostname) continue
          const match = eUrl.searchParams.has('channel')
            ? fUrl.searchParams.get('channel') === eUrl.searchParams.get('channel')
            : fUrl.pathname.split('?')[0] === eUrl.pathname.split('?')[0]
          if (match) return frame
        } catch { continue }
      }
    } catch {}
    return null
  }

  ipcMain.handle('inject-mute-monitor', async (_, dockIndex, embedUrl) => {
    const idx = Number(dockIndex)
    for (let i = 0; i < 20; i++) {
      const frame = findFrame(embedUrl)
      if (frame) {
        try {
          await frame.executeJavaScript(`(function(){
            if(window.__kwsMM)return;
            window.__kwsMM=true;
            function setup(n){
              var v=document.querySelectorAll('video')[0];
              if(!v){if(n<40)setTimeout(()=>setup(n+1),750);return}
              v.addEventListener('volumechange',function(){
                window.top.postMessage({type:'kws-mute-sync',dockIndex:${idx},muted:this.muted},'*')
              });
              window.top.postMessage({type:'kws-mute-sync',dockIndex:${idx},muted:v.muted},'*')
            }
            setup(0)
          })()`)
          return
        } catch {}
      }
      await new Promise(r => setTimeout(r, 500))
    }
  })

  ipcMain.handle('set-frame-muted', async (_, embedUrl, muted) => {
    const m = !!muted
    for (let i = 0; i < 20; i++) {
      const frame = findFrame(embedUrl)
      if (frame) {
        try {
          const done = await frame.executeJavaScript(`(function(){
            var v=document.querySelectorAll('video')[0];
            if(!v)return false;
            v.muted=${m};
            return true;
          })()`)
          if (done) return
        } catch {}
      }
      await new Promise(r => setTimeout(r, 500))
    }
  })

  ipcMain.handle('set-frame-volume', async (_, embedUrl, volume) => {
    const vol = Math.max(0, Math.min(1, Number(volume)))
    for (let i = 0; i < 20; i++) {
      const frame = findFrame(embedUrl)
      if (frame) {
        try {
          const done = await frame.executeJavaScript(`(function(){
            var v=document.querySelectorAll('video')[0];
            if(!v)return false;
            v.volume=${vol};
            return true;
          })()`)
          if (done) return
        } catch {}
      }
      await new Promise(r => setTimeout(r, 500))
    }
  })

  // ── YouTube audio ───────────────────────────────────────────────────────
  // YouTube docks are plain iframes in the main window (webview embeds get
  // error 153), so they can't use setAudioMuted. Instead a small controller
  // lives inside the embed frame and enforces the wanted state on EVERY
  // <video> every 500 ms — the player creates/replaces its video element late
  // and asynchronously, so one-shot injection used to miss it and the dock
  // played sound while showing the mute icon. The wanted state is kept here
  // and re-sent whenever a YouTube frame (re)loads, e.g. after a dock swap.
  const ytAudioState = new Map() // videoId -> { muted, vol }

  function ytControllerScript({ muted, vol }) {
    return `(function(m, vol){
      var proto = HTMLMediaElement.prototype;
      var vd = Object.getOwnPropertyDescriptor(proto, 'volume');
      var md = Object.getOwnPropertyDescriptor(proto, 'muted');
      // Muted: shadow the setters so YouTube's own JS can't turn sound back on
      function lock(v) {
        if (v.__kwsLocked) return;
        Object.defineProperty(v, 'volume', { get: function(){ return 0; }, set: function(){ try { vd.set.call(v, 0); } catch(e){} }, configurable: true });
        Object.defineProperty(v, 'muted', { get: function(){ return true; }, set: function(){ try { md.set.call(v, true); } catch(e){} }, configurable: true });
        v.__kwsLocked = true;
      }
      function apply() {
        var s = window.__kwsYt;
        document.querySelectorAll('video').forEach(function(v){
          if (s.muted) {
            lock(v);
            try { vd.set.call(v, 0); md.set.call(v, true); } catch(e){}
          } else if (v.__kwsLocked || !v.__kwsSeen || s.dirty) {
            if (v.__kwsLocked) { delete v.volume; delete v.muted; v.__kwsLocked = false; }
            try { vd.set.call(v, s.vol); md.set.call(v, false); } catch(e){}
          }
          v.__kwsSeen = true;
        });
        s.dirty = false;
      }
      window.__kwsYt = { muted: m, vol: vol, dirty: true };
      apply();
      if (!window.__kwsYtTimer) window.__kwsYtTimer = setInterval(apply, 500);
      return 1;
    })(${!!muted}, ${vol})`
  }

  function ytVideoIdOf(frameUrl) {
    try {
      const u = new URL(frameUrl)
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return null
      const m = u.pathname.match(/^\/embed\/([^/?#]+)/)
      return m ? m[1] : null
    } catch { return null }
  }

  async function pushYtState(videoId) {
    const state = ytAudioState.get(videoId)
    if (!state) return false
    let hit = false
    for (const frame of mainWindow.webContents.mainFrame.framesInSubtree) {
      if (ytVideoIdOf(frame.url) !== videoId) continue
      try { await frame.executeJavaScript(ytControllerScript(state)); hit = true } catch {}
    }
    return hit
  }

  // Any YouTube frame that (re)loads gets its wanted state again
  mainWindow.webContents.on('did-frame-finish-load', (_, _isMain, pid, routingId) => {
    try {
      const frame = webFrameMain.fromId(pid, routingId)
      const id = frame && ytVideoIdOf(frame.url)
      if (id && ytAudioState.has(id)) frame.executeJavaScript(ytControllerScript(ytAudioState.get(id))).catch(() => {})
    } catch {}
  })

  ipcMain.handle('set-youtube-audio', async (_, videoId, muted, volume) => {
    const id = String(videoId || '')
    if (!id) return
    ytAudioState.set(id, { muted: !!muted, vol: Math.max(0, Math.min(1, Number(volume) || 0)) })
    // The iframe may not exist yet (dock just mounted) — the load hook above
    // covers that, this loop covers a frame that's mid-load right now.
    for (let i = 0; i < 20; i++) {
      if (await pushYtState(id)) return
      await new Promise(r => setTimeout(r, 500))
    }
  })

  ipcMain.handle('set-webcontents-muted', (_, id, muted) => {
    try {
      const wc = webContents.fromId(Number(id))
      if (wc && !wc.isDestroyed()) wc.setAudioMuted(!!muted)
    } catch {}
  })

  ipcMain.handle('set-webcontents-volume', async (_, id, volume) => {
    try {
      const wc = webContents.fromId(Number(id))
      if (!wc || wc.isDestroyed()) return
      const vol = Math.max(0, Math.min(1, Number(volume)))
      // Players create their <video> late and restore their own saved volume
      // (Kick 0.6, Twitch 0.5), so a one-shot set got lost. Keep a tiny
      // enforcer in the page that holds every <video> at the dock's volume.
      const script = `(function(vol){
        window.__kwsVol = vol;
        function apply(){
          document.querySelectorAll('video').forEach(function(v){
            if (Math.abs(v.volume - window.__kwsVol) > 0.005) { try { v.volume = window.__kwsVol; } catch(e){} }
          });
        }
        apply();
        if (!window.__kwsVolTimer) window.__kwsVolTimer = setInterval(apply, 500);
      })(${vol})`
      for (const frame of wc.mainFrame.framesInSubtree) {
        try { await frame.executeJavaScript(script) } catch {}
      }
    } catch {}
  })

  // ── Video focus for sites without an embed player (ShowUp.tv) ───────────
  // Loads the full room page, then: auto-confirms the 18+ / cookie prompt,
  // and once a <video> exists hides everything else and stretches the video
  // over the whole viewport. Selector-free on purpose so site redesigns don't
  // break it. Until a video shows up, the page is left as-is (e.g. "offline").
  const FOCUS_VIDEO_JS = `(function(){
    if (window.__kwsFocus) return;
    window.__kwsFocus = true;
    var CONFIRM = /^(wchodz[eę]|wejd[zź]|mam\\s*(uko[nń]czone\\s*)?18|tak,?\\s*mam\\s*18|akceptuj(e|ę)?(\\s+wszystkie)?|zgadzam\\s*si[eę]|rozumiem|ok|i\\s*agree|accept(\\s+all)?|enter)(?![a-z0-9ąćęłńóśźż])/i;
    function clickPrompts() {
      var els = document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]');
      for (var i = 0; i < els.length; i++) {
        var b = els[i];
        if (b.__kwsClicked || !b.offsetParent) continue;
        var t = (b.innerText || b.value || '').trim();
        if (t.length > 40 || !CONFIRM.test(t)) continue;
        b.__kwsClicked = true;
        try { b.click(); } catch (e) {}
      }
    }
    function pickVideo() {
      var best = null, bestArea = 0;
      document.querySelectorAll('video').forEach(function(v){
        var r = v.getBoundingClientRect();
        var a = r.width * r.height;
        if (a > bestArea || (v.classList.contains('kws-focus') && a >= bestArea)) { best = v; bestArea = a; }
      });
      return best;
    }
    var styleEl = null;
    function focus(v) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.textContent =
          'html,body{overflow:hidden!important;background:#000!important}' +
          'body *{visibility:hidden!important}' +
          'video.kws-focus{visibility:visible!important;position:fixed!important;inset:0!important;' +
          'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;' +
          'margin:0!important;object-fit:contain!important;background:#000!important;z-index:2147483647!important;transform:none!important}' +
          '.kws-focus-anc{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important}';
        (document.head || document.documentElement).appendChild(styleEl);
      }
      if (!v.classList.contains('kws-focus')) {
        document.querySelectorAll('.kws-focus').forEach(function(o){ o.classList.remove('kws-focus'); });
        v.classList.add('kws-focus');
      }
      // Fixed positioning breaks inside transformed ancestors — neutralise them
      for (var p = v.parentElement; p && p !== document.body; p = p.parentElement) p.classList.add('kws-focus-anc');
      if (v.paused) { try { v.play(); } catch (e) {} }
    }
    function tick() {
      clickPrompts();
      var v = pickVideo();
      if (v && (v.readyState > 0 || v.classList.contains('kws-focus'))) focus(v);
    }
    tick();
    setInterval(tick, 1000);
  })()`

  ipcMain.handle('focus-video-player', async (_, id) => {
    try {
      const wc = webContents.fromId(Number(id))
      if (!wc || wc.isDestroyed()) return
      const inject = () => { wc.executeJavaScript(FOCUS_VIDEO_JS).catch(() => {}) }
      inject()
      // Re-inject after navigations (age gate often reloads the page)
      if (!wc._kwsFocusAttached) {
        wc._kwsFocusAttached = true
        wc.on('dom-ready', inject)
      }
    } catch {}
  })

  // ── ShowUp account login ────────────────────────────────────────────────
  // The login window uses the default session — the same one the dock
  // webviews use — so the cookies it gets are shared with every ShowUp dock.
  let showupLoginWin = null

  function notifyShowupSession() {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('showup-session-changed')
  }

  ipcMain.handle('showup-login', () => {
    if (showupLoginWin && !showupLoginWin.isDestroyed()) {
      showupLoginWin.focus()
      return
    }
    showupLoginWin = new BrowserWindow({
      width: 1100,
      height: 800,
      parent: mainWindow,
      title: 'Zaloguj do ShowUp — zamknij okno po zalogowaniu',
      backgroundColor: '#0a0a0a',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    // Keep our title so the hint stays visible
    showupLoginWin.on('page-title-updated', e => e.preventDefault())
    showupLoginWin.loadURL('https://showup.tv/')
    showupLoginWin.on('closed', () => {
      showupLoginWin = null
      notifyShowupSession() // docks reload and pick up the new cookies
    })
  })

  ipcMain.handle('showup-logout', async () => {
    const ses = mainWindow.webContents.session
    const cookies = await ses.cookies.get({ domain: 'showup.tv' })
    await Promise.all(cookies.map(c => {
      const host = c.domain.replace(/^\./, '')
      return ses.cookies.remove(`http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, c.name).catch(() => {})
    }))
    await ses.clearStorageData({ origin: 'https://showup.tv', storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] }).catch(() => {})
    notifyShowupSession()
    return cookies.length
  })

  // ── Channel search (Twitch + Kick) by creator nickname ──────────────────
  // Runs in main process to avoid CORS. net.fetch uses Chromium's network
  // stack, which gets through Kick's Cloudflare more reliably than Node fetch.
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  // Public client ID of the twitch.tv web app (unofficial, used by streamlink etc.)
  const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

  async function fetchJson(url, opts = {}, timeoutMs = 6000) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await net.fetch(url, { ...opts, signal: ctrl.signal })
      if (!res.ok) return null
      return await res.json()
    } catch { return null } finally { clearTimeout(t) }
  }

  function twitchGql(query, variables) {
    return fetchJson('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': TWITCH_GQL_CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
      body: JSON.stringify({ query, variables }),
    })
  }

  const TWITCH_USER_FIELDS = 'login displayName profileImageURL(width: 70) stream { viewersCount game { displayName } }'

  function mapTwitchUser(u) {
    if (!u?.login) return null
    return {
      platform: 'twitch',
      login: u.login,
      displayName: u.displayName || u.login,
      avatar: u.profileImageURL || null,
      live: !!u.stream,
      viewers: u.stream?.viewersCount ?? null,
      category: u.stream?.game?.displayName ?? null,
    }
  }

  async function searchTwitch(q) {
    const login = q.toLowerCase().replace(/[^a-z0-9_]/g, '')
    const [search, exact] = await Promise.all([
      twitchGql(
        `query($q: String!) { searchFor(userQuery: $q, platform: "web", options: { targets: [{ index: CHANNEL, limit: 8 }] }) { channels { edges { item { ... on User { ${TWITCH_USER_FIELDS} } } } } } }`,
        { q }
      ),
      login ? twitchGql(`query($l: String!) { user(login: $l) { ${TWITCH_USER_FIELDS} } }`, { l: login }) : null,
    ])
    const list = (search?.data?.searchFor?.channels?.edges || []).map(e => mapTwitchUser(e?.item))
    return [mapTwitchUser(exact?.data?.user), ...list].filter(Boolean)
  }

  function mapKickChannel(c) {
    const slug = c?.slug || c?.channel?.slug
    if (!slug) return null
    const user = c.user || c.channel?.user || {}
    const ls = c.livestream || null
    return {
      platform: 'kick',
      login: slug,
      displayName: user.username || c.username || slug,
      avatar: user.profile_pic || user.profilepic || c.profile_pic || null,
      live: !!(ls?.is_live ?? c.is_live ?? c.isLive ?? ls),
      viewers: ls?.viewer_count ?? ls?.viewers ?? null,
      category: ls?.categories?.[0]?.name ?? null,
    }
  }

  async function searchKick(q) {
    const slug = q.toLowerCase().replace(/[^a-z0-9_-]/g, '')
    const headers = { 'Accept': 'application/json', 'User-Agent': BROWSER_UA }
    const [search, exact] = await Promise.all([
      fetchJson(`https://kick.com/api/search?searched_word=${encodeURIComponent(q)}`, { headers }),
      slug ? fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers }) : null,
    ])
    const raw = Array.isArray(search?.channels) ? search.channels : (Array.isArray(search) ? search : [])
    return [mapKickChannel(exact), ...raw.map(mapKickChannel)].filter(Boolean)
  }

  function dedupe(list) {
    const seen = new Set()
    return list.filter(c => {
      const k = c.login.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 8)
  }

  ipcMain.handle('search-channels', async (_, rawQuery) => {
    const q = String(rawQuery || '').trim().slice(0, 50)
    if (q.length < 2) return { twitch: [], kick: [] }
    const [twitch, kick] = await Promise.all([
      searchTwitch(q).catch(() => []),
      searchKick(q).catch(() => []),
    ])
    return { twitch: dedupe(twitch), kick: dedupe(kick) }
  })

  const CHATANGO_DARK_CSS = `
    html, body { overflow: hidden !important; height: 100% !important; margin: 0 !important; padding: 0 !important; }
    * { background-color: #0d0d10 !important; }
    img, video, canvas, svg { background-color: transparent !important; }
    [style*="background-image"] { background-color: transparent !important; }

    body, div, span, p, td, li, input, textarea, button, a, table, tr, th {
      font-family: -apple-system, 'Segoe UI', system-ui, sans-serif !important;
      font-size: 13px !important;
      line-height: 1.55 !important;
    }

    input, textarea, select, [contenteditable] {
      background-color: #1a1a20 !important;
      border: 1px solid #2c2c35 !important;
      border-radius: 8px !important;
      padding: 7px 12px !important;
      caret-color: #7b8cde !important;
      transition: border-color .15s !important;
    }
    input:focus, textarea:focus, [contenteditable]:focus {
      outline: none !important;
      border-color: #3d3d52 !important;
    }
    ::placeholder { color: #4a4a5a !important; opacity: 1 !important; }

    a { color: #6b8fd4 !important; }
    a:hover { color: #89a7e6 !important; }

    button, [role="button"], a, label { cursor: pointer !important; }

    .topbar { display: none !important; height: 0 !important; overflow: hidden !important; }
    table { border-collapse: collapse !important; border: none !important; }
    td, th, tr { border: none !important; border-width: 0 !important; }

    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #38384a; }
  `

  // Inline !important styles beat Chatango's own inline styles and !important CSS rules.
  // Elements with background-image get transparent bg so the image shows through.
  const CHATANGO_DARK_JS = `(function(){
    var SKIP = {img:1,video:1,canvas:1,svg:1,script:1,style:1,link:1,meta:1,head:1,html:1};
    var busy = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    function isDarkColor(c) {
      var m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!m) return false;
      return +m[1] < 80 && +m[2] < 80 && +m[3] < 80;
    }
    function apply(el) {
      if (!el || el.nodeType !== 1) return;
      if (busy && busy.has(el)) return;
      var tag = el.tagName.toLowerCase();
      if (SKIP[tag]) return;
      if (el.classList && el.classList.contains('topbar')) {
        el.style.setProperty('display', 'none', 'important');
        return;
      }
      try {
        var cs = getComputedStyle(el);
        var bgImg = cs.backgroundImage;
        var hasBgImg = bgImg && bgImg !== 'none' && bgImg.indexOf('url') !== -1;
        if (hasBgImg || (el.querySelector && el.querySelector('img,video'))) {
          el.style.setProperty('background-color', 'transparent', 'important');
          return;
        }
        if (busy) { busy.add(el); setTimeout(function(){ busy.delete(el); }, 150); }
        if (tag === 'table' || tag === 'tr' || tag === 'td' || tag === 'th') {
          el.style.setProperty('border', 'none', 'important');
          if (tag === 'table') el.removeAttribute('border');
        }
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          el.style.setProperty('background-color', '#1a1a20', 'important');
          el.style.setProperty('border-color', '#2c2c35', 'important');
          el.style.setProperty('border-radius', '8px', 'important');
        } else if (el.isContentEditable) {
          var pos = cs.position;
          if (pos === 'absolute' || pos === 'fixed') {
            el.style.setProperty('background-color', 'transparent', 'important');
          } else {
            el.style.setProperty('background-color', '#1a1a20', 'important');
            el.style.setProperty('border-color', '#2c2c35', 'important');
            el.style.setProperty('border-radius', '8px', 'important');
          }
        } else {
          el.style.setProperty('background-color', '#0d0d10', 'important');
        }
        if (isDarkColor(cs.color)) {
          el.style.setProperty('color', '#d0d0d8', 'important');
        }
      } catch(e) {}
    }
    document.querySelectorAll('*').forEach(apply);
    if (!window.__kwsMO) {
      window.__kwsMO = true;
      new MutationObserver(function(muts) {
        muts.forEach(function(m) {
          if (m.type === 'attributes') { apply(m.target); }
          else { m.addedNodes.forEach(function(n) {
            if (n.nodeType !== 1) return;
            var t = n.tagName.toLowerCase();
            if ((t === 'img' || t === 'video') && n.parentElement) apply(n.parentElement);
            apply(n);
            try { n.querySelectorAll('*').forEach(apply); } catch(e){}
          }); }
        });
      }).observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class']
      });
    }
  })()`

  async function injectIntoFrame(frame, cssScript) {
    try { await frame.executeJavaScript(cssScript) } catch {}
    try { await frame.executeJavaScript(CHATANGO_DARK_JS) } catch {}
  }

  ipcMain.handle('inject-chatango-dark', async (_, webviewId) => {
    try {
      const wc = webContents.fromId(Number(webviewId))
      if (!wc || wc.isDestroyed()) return
      const cssScript = `(function(){
        var el = document.getElementById('kws-dark');
        if (!el) { el = document.createElement('style'); el.id = 'kws-dark'; (document.head || document.documentElement).appendChild(el); }
        el.textContent = ${JSON.stringify(CHATANGO_DARK_CSS)};
      })()`
      // Inject into all frames currently loaded
      for (const frame of wc.mainFrame.framesInSubtree) {
        await injectIntoFrame(frame, cssScript)
      }
      // Inject into every future frame as it finishes loading (catches async iframes)
      if (!wc._kwsDarkAttached) {
        wc._kwsDarkAttached = true
        wc.on('did-frame-finish-load', async (_, _isMain, pid, routingId) => {
          try {
            const frame = webFrameMain.fromId(pid, routingId)
            if (frame) await injectIntoFrame(frame, cssScript)
          } catch {}
        })
      }
    } catch {}
  })

  ipcMain.handle('set-always-on-top', (_, flag) => {
    mainWindow.setAlwaysOnTop(flag, 'floating')
  })

  // Force webview guest viewport via Chrome DevTools Protocol
  ipcMain.handle('set-webview-size', async (_, guestId, width, height) => {
    try {
      const { webContents } = await import('electron')
      const wc = webContents.fromId(guestId)
      if (!wc || wc.isDestroyed()) return
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
      }
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: Math.round(width),
        height: Math.round(height),
        deviceScaleFactor: 0,
        mobile: false,
      })
    } catch (e) {
      // debugger already attached or other error — ignore
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Log why a renderer/webview died (gray dock = crashed guest) so we can tell
// out-of-memory from GPU/media crashes.
app.on('render-process-gone', (_, wc, details) => {
  let url = ''
  try { url = wc.getURL() } catch {}
  console.log(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode} url=${url}`)
})
app.on('child-process-gone', (_, details) => {
  console.log(`[child-process-gone] type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name || ''}`)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
