import { useRef, useState, useCallback, useEffect } from 'react'

const DEFAULT_ROOM = 'chatraszei'

// The room's own page (https://<room>.chatango.com/) is what renders reliably;
// the dark theme is injected into it from main ('inject-chatango-dark').
function chatangoUrl(room) {
  const r = String(room || '').trim().toLowerCase()
  return `https://${/^[a-z0-9-]+$/.test(r) ? r : DEFAULT_ROOM}.chatango.com/`
}

// Chat page in a webview that reloads itself if its renderer crashes
// (same backoff as stream docks: 1 s, 2 s, ...; gives up after 5 crashes/min).
// darkTheme: inject the Chatango dark theme after each load.
function ChatWebview({ src, darkTheme = false }) {
  const ref = useRef(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const timers = []
    const onReady = () => {
      if (!darkTheme) return
      const run = () => {
        try { window.electronAPI?.injectChatangoDark(el.getWebContentsId()) } catch {}
      }
      run()
      for (const ms of [1200, 3000, 6000, 10000]) timers.push(setTimeout(run, ms))
    }
    let crashes = []
    const onGone = (e) => {
      const now = Date.now()
      crashes = crashes.filter(t => now - t < 60000)
      crashes.push(now)
      if (crashes.length > 5) return
      const delay = 1000 * crashes.length
      console.warn(`[chat] webview gone (${e?.details?.reason || e?.reason || '?'}), reload in ${delay}ms`)
      timers.push(setTimeout(() => {
        try { el.reload() } catch { setNonce(n => n + 1) }
      }, delay))
    }
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('render-process-gone', onGone)
    return () => {
      timers.forEach(clearTimeout)
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('render-process-gone', onGone)
    }
  }, [src, darkTheme, nonce])

  return (
    <webview
      key={`${src}#${nonce}`}
      ref={ref}
      src={src}
      allowpopups="true"
      style={{ position: 'absolute', inset: 0, border: 'none' }}
    />
  )
}

function getChatSources(docks) {
  return docks
    .filter(d => d.platform === 'twitch' || d.platform === 'kick')
    .map(d => ({ type: d.platform, channel: d.id, label: d.label || d.id }))
    .filter((s, i, arr) => arr.findIndex(x => x.type === s.type && x.channel === s.channel) === i)
}

export default function ChatPanel({ chatConfig, docks = [], onChatConfigChange }) {
  const panelRef = useRef(null)
  const [width, setWidth] = useState(310)
  const [dragging, setDragging] = useState(false)
  const chatEmbedUrl = chatConfig.type === 'custom' && chatConfig.customUrl
    ? chatConfig.customUrl
    : chatangoUrl(chatConfig.room)

  const streamSources = getChatSources(docks)
  const isChatango = chatConfig.type !== 'twitch' && chatConfig.type !== 'kick'

  const startDrag = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = width
    function onMove(ev) {
      setWidth(Math.max(200, Math.min(500, startW + startX - ev.clientX)))
    }
    function onUp() {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width])

  return (
    <div ref={panelRef} className="chat-panel" style={{ width }}>
      <div className={`chat-resize-handle ${dragging ? 'dragging' : ''}`} onMouseDown={startDrag} />

      {streamSources.length > 0 && (
        <div className="chat-source-bar">
          <button
            className={`chat-source-btn ${isChatango ? 'active' : ''}`}
            onClick={() => onChatConfigChange({ ...chatConfig, type: chatConfig.baseType || 'chatango', channel: undefined })}
          >
            Chatango
          </button>
          {streamSources.map(src => (
            <button
              key={`${src.type}-${src.channel}`}
              className={`chat-source-btn ${chatConfig.type === src.type && chatConfig.channel === src.channel ? 'active' : ''}`}
              onClick={() => onChatConfigChange({
                ...chatConfig,
                type: src.type,
                channel: src.channel,
                // remember chatango/custom so the first button can return to it
                baseType: isChatango ? (chatConfig.type || 'chatango') : chatConfig.baseType,
              })}
              style={{ color: src.type === 'twitch' ? '#9146ff' : '#53fc18' }}
            >
              {src.type === 'twitch' ? '▶' : '●'} {src.channel}
            </button>
          ))}
        </div>
      )}

      <div className="chat-webview-wrap">
        {chatConfig.type === 'kick' && chatConfig.channel ? (
          // Kick's own popout chat — its realtime config changes server-side,
          // so a hand-rolled Pusher client keeps breaking
          <ChatWebview key={`kick-${chatConfig.channel}`} src={`https://kick.com/popout/${encodeURIComponent(chatConfig.channel)}/chat`} />
        ) : chatConfig.type === 'twitch' && chatConfig.channel ? (
          <iframe
            key={chatConfig.channel}
            src={`https://www.twitch.tv/embed/${chatConfig.channel}/chat?parent=localhost&darkpopout`}
            allow="autoplay"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <ChatWebview key={chatEmbedUrl} src={chatEmbedUrl} darkTheme={chatConfig.type !== 'custom'} />
        )}
      </div>
    </div>
  )
}
