import { useRef, useState, useCallback, useEffect } from 'react'
import KickChat from './KickChat'

const FALLBACK_URL = 'https://chatraszei.chatango.com/'

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
  const [chatEmbedUrl, setChatEmbedUrl] = useState(null)

  useEffect(() => {
    setChatEmbedUrl(FALLBACK_URL)
    const p = window.electronAPI?.getChatPort?.()
    if (p instanceof Promise) {
      p.then(port => { if (port) setChatEmbedUrl(`http://127.0.0.1:${port}/`) }).catch(() => {})
    }
  }, [])

  const chatWvRef = useCallback((el) => {
    if (!el) return
    const run = () => {
      try {
        const id = el.getWebContentsId()
        window.electronAPI?.injectChatangoDark(id)
      } catch {}
    }
    const inject = () => { run(); setTimeout(run, 1200); setTimeout(run, 3000); setTimeout(run, 6000); setTimeout(run, 10000) }
    el.addEventListener('dom-ready', inject)
  }, [])

  const streamSources = getChatSources(docks)
  const isChatango = chatConfig.type === 'chatango' || (!chatConfig.type && !chatConfig.channel)

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
            onClick={() => onChatConfigChange({ type: 'chatango' })}
          >
            Chatango
          </button>
          {streamSources.map(src => (
            <button
              key={`${src.type}-${src.channel}`}
              className={`chat-source-btn ${chatConfig.type === src.type && chatConfig.channel === src.channel ? 'active' : ''}`}
              onClick={() => onChatConfigChange({ type: src.type, channel: src.channel })}
              style={{ color: src.type === 'twitch' ? '#9146ff' : '#53fc18' }}
            >
              {src.type === 'twitch' ? '▶' : '●'} {src.channel}
            </button>
          ))}
        </div>
      )}

      <div className="chat-webview-wrap">
        {chatConfig.type === 'kick' && chatConfig.channel ? (
          <KickChat key={chatConfig.channel} channel={chatConfig.channel} />
        ) : chatConfig.type === 'twitch' && chatConfig.channel ? (
          <iframe
            key={chatConfig.channel}
            src={`https://www.twitch.tv/embed/${chatConfig.channel}/chat?parent=localhost&darkpopout`}
            allow="autoplay"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : chatEmbedUrl ? (
          <webview
            ref={chatWvRef}
            src={chatEmbedUrl}
            allowpopups="true"
            style={{ position: 'absolute', inset: 0, border: 'none' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>
            Ładowanie czatu…
          </div>
        )}
      </div>
    </div>
  )
}
