import { app, BrowserWindow, ipcMain, dialog, protocol, webContents } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { writeFileSync } from 'fs'
import { createServer } from 'http'

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

// Local HTTP server serving the Chatango embed widget (same approach as raszei.eu)
// Using localhost means the Chatango script sees a valid HTTP origin.
let chatServerPort = 0
const chatHtml = (() => {
  const room = 'chatraszei'
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#0d0d10}
</style>
</head>
<body>
<script>
var s=document.createElement('script');
s.async=true;
s.setAttribute('data-cfasync','false');
s.setAttribute('data-cid','${room}');
s.src='https://st.chatango.com/js/gz/emb.js';
document.body.appendChild(s);
</script>
</body>
</html>`
})()

const chatServerReady = new Promise(resolve => {
  const srv = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(chatHtml)
  })
  srv.listen(0, '127.0.0.1', () => {
    chatServerPort = srv.address().port
    resolve(chatServerPort)
  })
})

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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  ipcMain.handle('get-chat-port', () => chatServerReady)

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

  // Per-videoId cancellation tokens so a newer command kills the old injection loop
  const ytAudioAborts = new Map()

  // YouTube iframe audio — targets by video ID in the frame URL path.
  // Uses defineProperty to LOCK the video element's volume/muted setters so
  // YouTube's player-init cannot reset them after our injection.
  ipcMain.handle('set-youtube-audio', async (_, videoId, muted, volume) => {
    const m = !!muted
    const vol = Math.max(0, Math.min(1, Number(volume)))
    const targetPath = `/embed/${videoId}`

    const prev = ytAudioAborts.get(videoId)
    if (prev) prev.cancelled = true
    const token = { cancelled: false }
    ytAudioAborts.set(videoId, token)

    // Lock: intercept the prototype setters so any future v.volume = X or v.muted = X
    // from YouTube's own JS always resolves to silent/muted.
    const lockScript = `(function(){
      var v = document.querySelectorAll('video')[0];
      if (!v) return 0;
      if (v.__kwsLocked) return 1;
      var proto = HTMLMediaElement.prototype;
      var vd = Object.getOwnPropertyDescriptor(proto, 'volume');
      var md = Object.getOwnPropertyDescriptor(proto, 'muted');
      Object.defineProperty(v, 'volume', {
        get: function(){ return 0; },
        set: function(){ try{ vd.set.call(v, 0); }catch(e){} },
        configurable: true, enumerable: true
      });
      Object.defineProperty(v, 'muted', {
        get: function(){ return true; },
        set: function(){ try{ md.set.call(v, true); }catch(e){} },
        configurable: true, enumerable: true
      });
      try{ vd.set.call(v, 0); md.set.call(v, true); }catch(e){}
      v.__kwsLocked = true;
      return 1;
    })()`

    const unlockScript = `(function(){
      var v = document.querySelectorAll('video')[0];
      if (!v) return 0;
      var proto = HTMLMediaElement.prototype;
      var vd = Object.getOwnPropertyDescriptor(proto, 'volume');
      var md = Object.getOwnPropertyDescriptor(proto, 'muted');
      delete v.volume; delete v.muted;
      v.__kwsLocked = false;
      try{ vd.set.call(v, ${vol}); md.set.call(v, false); }catch(e){}
      return 1;
    })()`

    const script = m ? lockScript : unlockScript

    async function tryInject() {
      for (const frame of mainWindow.webContents.mainFrame.framesInSubtree) {
        if (!frame.url) continue
        try {
          const fUrl = new URL(frame.url)
          if (!fUrl.hostname.endsWith('youtube-nocookie.com') && !fUrl.hostname.endsWith('youtube.com')) continue
          if (!fUrl.pathname.startsWith(targetPath)) continue
          const result = await frame.executeJavaScript(script)
          if (result > 0) return true
        } catch {}
      }
      return false
    }

    // Retry until the video element exists (player init is async)
    for (let i = 0; i < 30; i++) {
      if (token.cancelled) return
      if (await tryInject()) { ytAudioAborts.delete(videoId); return }
      await new Promise(r => setTimeout(r, 300))
    }
    ytAudioAborts.delete(videoId)
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
      for (const frame of wc.mainFrame.framesInSubtree) {
        try { await frame.executeJavaScript(`(function(){var v=document.querySelectorAll('video')[0];if(v)v.volume=${vol}})()`) } catch {}
      }
    } catch {}
  })

  ipcMain.handle('get-kick-chatroom-id', async (_, channel) => {
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      })
      const data = await res.json()
      return data?.chatroom?.id ?? null
    } catch { return null }
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
        wc.on('did-frame-finish-load', async (_, _isMain, _pid, routingId) => {
          try {
            for (const frame of wc.mainFrame.framesInSubtree) {
              if (frame.routingId === routingId) {
                await injectIntoFrame(frame, cssScript)
                break
              }
            }
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
