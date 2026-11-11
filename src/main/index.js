import { app, BrowserWindow, ipcMain, dialog, protocol, webContents, webFrameMain, net, shell, Menu, clipboard } from 'electron'
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
    // No system title bar — the app's toolbar is the title bar (drag region)
    // and has its own minimise / maximise / close buttons
    frame: false,
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
      // Take over the element's volume/muted setters: whatever YouTube's own
      // JS writes (it restores its saved volume, often 100%, a few seconds
      // after start) resolves to the dock's wanted state instead — so no loud
      // blip and the slider stays true. Getters report the real values.
      function own(v) {
        if (v.__kwsOwned) return;
        Object.defineProperty(v, 'volume', {
          get: function(){ return vd.get.call(v); },
          set: function(){ var s = window.__kwsYt; try { vd.set.call(v, s.muted ? 0 : s.vol); } catch(e){} },
          configurable: true
        });
        Object.defineProperty(v, 'muted', {
          get: function(){ return md.get.call(v); },
          set: function(){ try { md.set.call(v, !!window.__kwsYt.muted); } catch(e){} },
          configurable: true
        });
        v.__kwsOwned = true;
      }
      // Also re-applied every tick for new/replaced <video> elements
      function apply() {
        var s = window.__kwsYt;
        var want = s.muted ? 0 : s.vol;
        document.querySelectorAll('video').forEach(function(v){
          own(v);
          try {
            if (Math.abs(vd.get.call(v) - want) > 0.005) vd.set.call(v, want);
            if (md.get.call(v) !== !!s.muted) md.set.call(v, !!s.muted);
          } catch(e){}
        });
      }
      window.__kwsYt = { muted: m, vol: vol };
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

  // ── Site check window (strumyk.cv behind Cloudflare) ───────────────────
  // Docks don't take clicks, so a dock that lands on the site's "are you
  // human" page offers this window: an ordinary page on the default session
  // (shared with the docks) where the user completes the check themselves.
  // Closing it reloads the docks of that site.
  let siteCheckWin = null
  ipcMain.handle('open-site-check', (_, rawUrl) => {
    let url
    try { url = new URL(String(rawUrl)) } catch { return }
    if (url.protocol !== 'https:' || url.hostname !== 'strumyk.cv') return
    if (siteCheckWin && !siteCheckWin.isDestroyed()) {
      siteCheckWin.loadURL(url.toString())
      siteCheckWin.focus()
      return
    }
    siteCheckWin = new BrowserWindow({
      width: 1100,
      height: 800,
      parent: mainWindow,
      title: 'strumyk.cv — potwierdź weryfikację i zamknij okno',
      backgroundColor: '#0a0a0a',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    siteCheckWin.webContents.setAudioMuted(true)
    siteCheckWin.on('page-title-updated', e => e.preventDefault())
    siteCheckWin.loadURL(url.toString())
    siteCheckWin.on('closed', () => {
      siteCheckWin = null
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('site-session-changed', 'strumyk.cv')
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

  // ── Chatango: chat only + links handled by the app ─────────────────────
  // The room page is a table: logo/ad row, description row, then the chat
  // iframe (st.chatango.com/h5/...), plus a bottom bar. Instead of hiding
  // those by selectors, the chat iframe itself is pinned over the whole
  // page, so whatever Chatango puts around it is simply covered. It is also
  // shifted up by the height of the chat's own room-URL strip (#HEAD, measured
  // from the chat frame into --kws-shift): hiding #HEAD inside the chat made
  // Chatango's layout overflow; pushing it off-screen keeps its native layout.
  const CHATANGO_COMPACT_JS = `(function(){
    var css = 'html,body{overflow:hidden!important;margin:0!important}' +
      'iframe.kws-chat{position:fixed!important;left:0!important;top:calc(-1 * var(--kws-shift, 0px))!important;' +
      'width:100vw!important;height:calc(100vh + var(--kws-shift, 0px))!important;max-width:none!important;max-height:none!important;' +
      'border:0!important;margin:0!important;z-index:2147483647!important;visibility:visible!important}';
    var st = document.getElementById('kws-compact');
    if (!st) { st = document.createElement('style'); st.id = 'kws-compact'; (document.head || document.documentElement).appendChild(st); }
    st.textContent = css;
    function pin() {
      var f = document.querySelector('iframe[src*="st.chatango.com/h5"], #flashcontent iframe');
      if (f && !f.classList.contains('kws-chat')) f.classList.add('kws-chat');
      return !!f;
    }
    pin();
    if (!window.__kwsCompact) {
      window.__kwsCompact = true;
      // Chatango may rebuild the iframe (reconnect, room switch)
      new MutationObserver(pin).observe(document.documentElement, { childList: true, subtree: true });
    }
    return pin();
  })()`

  // Inside the chat iframe: give the chat the app's background. Surgical overrides of Chatango's own rules only —
  // no blanket recolouring, so user colours (inline styles), images, hover
  // previews and videos stay exactly as Chatango draws them.
  const CHATANGO_FRAME_CSS = [
    'html,body,#OWBG{background:#101010!important}',
    '#CGW,#FTR,#IW{color:#d6d6d6}',
    '.msg-fg,.msg .at-quote{color:#d6d6d6!important}',
    '.ubdr,#OW,.msg{border-color:#242424!important}',
    '#IWW #input-field{background:#1a1a1a!important;color:#e0e0e0!important;border-color:#2c2c2c!important}',
    '.input-field[contenteditable="true"]:empty:not(:focus)::before{color:#777!important}',
    '.kws-nosel,.kws-nosel *{-webkit-user-select:none!important;user-select:none!important}',
  ].join('')
  const CHATANGO_FRAME_JS = `(function(){
    if (!document.getElementById('kws-compact-frame')) {
      var st = document.createElement('style'); st.id = 'kws-compact-frame';
      st.textContent = ${JSON.stringify(CHATANGO_FRAME_CSS)};
      (document.head || document.documentElement).appendChild(st);
    }
    // Chatango's scrollbar is a plain div next to the message list (#OM in
    // #OMW). Dragging it selected message text, and dragging over a selection
    // starts a native drag that swallows mouseup — the scrollbar then stuck
    // to the cursor. While it is held: no text selection, no native drag; and
    // a move with no button pressed hands Chatango the mouseup it missed.
    if (!window.__kwsNoSel) {
      window.__kwsNoSel = true;
      var root = document.documentElement;
      var held = function(){ return root.classList.contains('kws-nosel'); };
      var release = function(){ root.classList.remove('kws-nosel'); };
      document.addEventListener('mousedown', function(e){
        var t = e.target;
        if (t && t.closest && t.closest('#OMW') && !t.closest('#OM')) {
          root.classList.add('kws-nosel');
          try { getSelection().removeAllRanges(); } catch(_) {}
        }
      }, true);
      window.addEventListener('mouseup', release, true);
      document.addEventListener('dragstart', function(e){ if (held()) e.preventDefault(); }, true);
      document.addEventListener('mousemove', function(e){
        if (held() && e.buttons === 0) {
          release();
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
        }
      }, true);
    }
    // YouTube links show as a thumbnail (.video-thumb, img.youtube.com/vi/<id>/)
    // that Chatango plays in a tiny in-chat player. Catch the click first
    // (capture phase) and open the video through window.open instead — the
    // app's window-open handler turns that into its own viewer popup.
    if (!window.__kwsVideo) {
      window.__kwsVideo = true;
      var videoUrl = function(t){
        var th = t && t.closest && t.closest('.video-thumb');
        if (!th) return null;
        var img = th.querySelector('img');
        var m = img && /\\/vi\\/([A-Za-z0-9_-]{6,})\\//.exec(img.getAttribute('src') || '');
        return m ? 'https://www.youtube.com/watch?v=' + m[1] : null;
      };
      ['mousedown', 'mouseup', 'click'].forEach(function(type){
        document.addEventListener(type, function(e){
          var url = videoUrl(e.target);
          if (!url || e.button !== 0) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === 'click') window.open(url, '_blank');
        }, true);
      });
    }
    // bottom edge of the room-URL strip = how far to push the frame up;
    // msgs = chat history already drawn (the app shows the chat only then)
    var h = document.getElementById('HEAD');
    return {
      shift: h ? Math.round(h.getBoundingClientRect().bottom) : 0,
      msgs: document.querySelectorAll('#OW .msg').length
    };
  })()`
  const isChatFrame = (f) => !!f && /st\.chatango\.com\/h5\//.test(f.url || '')

  // Message text size (Settings → Chatango): #OM is the message list, its
  // texts use % sizes, so one rule scales messages only — not the input or
  // toolbar. After a change the list is wheeled to the bottom (Chatango keeps
  // its old scroll offset otherwise).
  const chatangoFontJs = (pct) => `(function(p){
    var s = document.getElementById('kws-font');
    if (!s) { s = document.createElement('style'); s.id = 'kws-font'; (document.head || document.documentElement).appendChild(s); }
    if (window.__kwsFont === p) return;
    var first = window.__kwsFont === undefined;
    window.__kwsFont = p;
    s.textContent = p === 100 ? '' : '#OM{font-size:' + p + '%!important}';
    if (first) return;
    // Chatango scrolls on the legacy 'mousewheel' event from inside the list
    setTimeout(function(){
      var m = document.querySelector('#OM .msg');
      if (!m) return;
      var e = new Event('mousewheel', { bubbles: true, cancelable: true });
      e.wheelDelta = -1000000; e.wheelDeltaY = -1000000;
      m.dispatchEvent(e);
    }, 50);
  })(${Number(pct) || 100})`

  // Styles the chat frame; resolves to the number of messages shown (-1 = failed)
  async function styleChatFrame(wc, f) {
    try {
      await f.executeJavaScript(chatangoFontJs(wc._kwsFont)).catch(() => {})
      const r = await f.executeJavaScript(CHATANGO_FRAME_JS)
      const shift = Number(r?.shift) || 0
      if (!wc.isDestroyed() && shift > 0 && shift < 80) {
        await wc.mainFrame.executeJavaScript(`document.documentElement.style.setProperty('--kws-shift', '${shift}px')`)
      }
      return Number(r?.msgs) || 0
    } catch { return -1 }
  }

  const isHttpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }

  ipcMain.handle('chatango-compact', async (_, webviewId, fontPct) => {
    try {
      const wc = webContents.fromId(Number(webviewId))
      if (!wc || wc.isDestroyed()) return false
      const pct = Math.max(50, Math.min(300, Math.round(Number(fontPct) || 100)))
      wc._kwsFont = pct
      // Links, image thumbnails and videos open with target=_blank — don't
      // spawn bare Electron windows; the app decides (viewer, dock, browser)
      if (!wc._kwsLinkHandler) {
        wc._kwsLinkHandler = true
        wc.setWindowOpenHandler(({ url }) => {
          if (isHttpUrl(url) && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat-open-url', url)
          return { action: 'deny' }
        })
        // A link that would navigate the chat page itself away from Chatango
        wc.on('will-navigate', (e, url) => {
          try {
            if (/(^|\.)chatango\.com$/.test(new URL(url).hostname)) return
          } catch {}
          e.preventDefault()
          if (isHttpUrl(url) && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat-open-url', url)
        })
        wc.on('did-frame-finish-load', (_, _isMain, pid, routingId) => {
          try {
            const f = webFrameMain.fromId(pid, routingId)
            if (isChatFrame(f)) styleChatFrame(wc, f)
          } catch {}
        })
      }
      // Pin first (the shift var lands on the pinned frame), then style the
      // chat. Ready = frame pinned + styled + chat history drawn; the
      // renderer keeps a dark cover over the chat until then.
      const pinned = await wc.mainFrame.executeJavaScript(CHATANGO_COMPACT_JS)
      let msgs = -1
      for (const f of wc.mainFrame.framesInSubtree) {
        if (isChatFrame(f)) msgs = Math.max(msgs, await styleChatFrame(wc, f))
      }
      return { pinned: !!pinned, styled: msgs >= 0, msgs: Math.max(0, msgs) }
    } catch { return false }
  })

  // ── Kick / Twitch chat font size (Settings) ─────────────────────────────
  // Both chats size text in rem, so scaling the root font size enlarges the
  // text (and rem paddings) without zooming the whole page. The page's own
  // base size is remembered the first time, so 100% restores it exactly.
  const remScaleJs = (pct) => `(function(p){
    var r = document.documentElement;
    if (window.__kwsBase === undefined) {
      r.style.removeProperty('font-size');
      window.__kwsBase = parseFloat(getComputedStyle(r).fontSize) || 16;
    }
    if (p === 100) r.style.removeProperty('font-size');
    else r.style.setProperty('font-size', (window.__kwsBase * p / 100) + 'px', 'important');
    return 1;
  })(${Math.max(50, Math.min(300, Math.round(Number(pct) || 100)))})`

  // Kick chat: its own webview
  ipcMain.handle('set-chat-font', async (_, webviewId, pct) => {
    try {
      const wc = webContents.fromId(Number(webviewId))
      if (!wc || wc.isDestroyed()) return
      wc._kwsChatFont = pct
      if (!wc._kwsChatFontHook) {
        wc._kwsChatFontHook = true
        wc.on('dom-ready', () => { wc.executeJavaScript(remScaleJs(wc._kwsChatFont)).catch(() => {}) })
      }
      await wc.executeJavaScript(remScaleJs(pct))
    } catch {}
  })

  // Twitch chat: an iframe in the main window (twitch.tv/embed/<ch>/chat)
  let twitchChatFont = 100
  const isTwitchChatFrame = (f) => !!f && /^https:\/\/(www\.)?twitch\.tv\/embed\/[^/]+\/chat/.test(f.url || '')
  const applyTwitchChatFont = () => {
    for (const f of mainWindow.webContents.mainFrame.framesInSubtree) {
      if (isTwitchChatFrame(f)) f.executeJavaScript(remScaleJs(twitchChatFont)).catch(() => {})
    }
  }
  mainWindow.webContents.on('did-frame-finish-load', (_, _isMain, pid, routingId) => {
    if (twitchChatFont === 100) return
    try {
      const f = webFrameMain.fromId(pid, routingId)
      if (isTwitchChatFrame(f)) f.executeJavaScript(remScaleJs(twitchChatFont)).catch(() => {})
    } catch {}
  })
  ipcMain.handle('set-twitch-chat-font', (_, pct) => {
    twitchChatFont = Math.max(50, Math.min(300, Math.round(Number(pct) || 100)))
    applyTwitchChatFont()
  })

  ipcMain.handle('open-external', (_, url) => {
    if (isHttpUrl(url)) shell.openExternal(url)
  })

  // Toolbar X: close the app (state is saved continuously by the renderer)
  ipcMain.handle('quit-app', () => { app.quit() })
  ipcMain.handle('window-minimize', () => { mainWindow.minimize() })
  ipcMain.handle('window-toggle-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize()
  })
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized())
  const sendMax = () => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('maximized-changed', mainWindow.isMaximized()) }
  mainWindow.on('maximize', sendMax)
  mainWindow.on('unmaximize', sendMax)

  ipcMain.handle('set-always-on-top', (_, flag) => {
    mainWindow.setAlwaysOnTop(flag, 'floating')
  })

  // ── Fullscreen (toolbar button + F11) ───────────────────────────────────
  const toggleFullScreen = () => {
    if (!mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen())
  }
  const sendFullScreen = () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('fullscreen-changed', mainWindow.isFullScreen())
  }
  mainWindow.on('enter-full-screen', sendFullScreen)
  mainWindow.on('leave-full-screen', sendFullScreen)
  ipcMain.handle('toggle-fullscreen', () => { toggleFullScreen(); return mainWindow.isFullScreen() })
  ipcMain.handle('is-fullscreen', () => mainWindow.isFullScreen())
  // F11 must work wherever focus is — main window, a dock's webview or the
  // chat webview — so hook every webContents of this window
  const hookF11 = (wc) => {
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) {
        e.preventDefault()
        toggleFullScreen()
      }
    })
  }
  hookF11(mainWindow.webContents)
  mainWindow.webContents.on('did-attach-webview', (_, wc) => hookF11(wc))

  // ── Right-click menu (Electron has none by default) ─────────────────────
  // Text fields: cut/copy/paste/select all; selected text: copy; links: copy
  // address / open in browser. Over a dock, favourite or history entry the
  // renderer first reports that stream's link and name ('context-extra'),
  // which adds "copy stream link / name".
  let ctxExtra = null
  ipcMain.on('context-extra', (_, extra) => { ctxExtra = extra ? { ...extra, t: Date.now() } : null })

  const showContextMenu = (wc, params, withExtra) => {
    const extra = withExtra && ctxExtra && Date.now() - ctxExtra.t < 1000 ? ctxExtra : null
    ctxExtra = null
    const items = []
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }) }
    if (extra?.link) items.push({ label: 'Kopiuj link streamu', click: () => clipboard.writeText(extra.link) })
    if (extra?.name) items.push({ label: 'Kopiuj nazwę', click: () => clipboard.writeText(extra.name) })
    const link = params.linkURL
    if (link && /^https?:/i.test(link)) {
      sep()
      items.push({ label: 'Kopiuj adres linku', click: () => clipboard.writeText(link) })
      items.push({ label: 'Otwórz link w przeglądarce', click: () => shell.openExternal(link) })
    }
    if (params.isEditable) {
      sep()
      const f = params.editFlags || {}
      items.push({ label: 'Wytnij', role: 'cut', enabled: !!f.canCut })
      items.push({ label: 'Kopiuj', role: 'copy', enabled: !!f.canCopy })
      items.push({ label: 'Wklej', role: 'paste', enabled: !!f.canPaste })
      items.push({ type: 'separator' })
      items.push({ label: 'Zaznacz wszystko', role: 'selectAll' })
    } else if (params.selectionText && params.selectionText.trim()) {
      sep()
      items.push({ label: 'Kopiuj', role: 'copy' })
    }
    if (!items.length) return
    Menu.buildFromTemplate(items).popup({ window: mainWindow })
  }
  mainWindow.webContents.on('context-menu', (_, params) => showContextMenu(mainWindow.webContents, params, true))
  // chats and other webviews (docks ignore the mouse, so they never get here)
  mainWindow.webContents.on('did-attach-webview', (_, wc) => {
    wc.on('context-menu', (_, params) => showContextMenu(wc, params, false))
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
