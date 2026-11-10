import { useRef, useState, useCallback, useEffect } from 'react'
import { parseStreamUrl } from '../utils/streamParser'

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

const isStreamChat = (cfg) => (cfg?.type === 'twitch' || cfg?.type === 'kick') && !!cfg?.channel

// chatango / custom — whatever Settings chose, even while a stream chat is shown
function baseChatType(settings) {
  return isStreamChat(settings) ? (settings.baseType || 'chatango') : (settings?.type || 'chatango')
}

const PLATFORM_COLOR = { twitch: '#9146ff', kick: '#53fc18' }
const PLATFORM_NAME = { twitch: 'Twitch', kick: 'Kick' }

// "kick.com/x" / "twitch.tv/x" -> that channel; a bare nick -> offer both
function parseChatInput(raw) {
  const v = raw.trim()
  if (!v) return []
  if (/[./:]/.test(v)) {
    const p = parseStreamUrl(v)
    return p && (p.platform === 'twitch' || p.platform === 'kick') && p.type === 'live'
      ? [{ type: p.platform, channel: p.id.toLowerCase() }]
      : []
  }
  const nick = v.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!nick) return []
  return [
    { type: 'twitch', channel: nick.replace(/-/g, '_') },
    { type: 'kick', channel: nick },
  ]
}

// Chooser shown in an empty pane or after "+ Inny": nothing loads until the
// user picks - adding a stream to a dock never opens its chat by itself.
function ChatPicker({ base, sources, onPick, onCancel }) {
  const [text, setText] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const typed = parseChatInput(text)

  return (
    <div className="chat-picker">
      <div className="chat-picker-title">Wybierz czat</div>

      <button className="chat-picker-item" onClick={() => onPick({ type: base, channel: undefined })}>
        <span className="chat-picker-dot" style={{ color: 'var(--accent)' }}>●</span>
        {base === 'custom' ? 'Własny czat (z ustawień)' : 'Chatango (raszei)'}
      </button>

      {sources.length > 0 && <div className="chat-picker-sub">Ze streamów w dockach</div>}
      {sources.map(src => (
        <button key={`${src.type}-${src.channel}`} className="chat-picker-item" onClick={() => onPick(src)}>
          <span className="chat-picker-dot" style={{ color: PLATFORM_COLOR[src.type] }}>●</span>
          {PLATFORM_NAME[src.type]}: {src.channel}
        </button>
      ))}

      <div className="chat-picker-sub">Dowolny kanał</div>
      <input
        ref={inputRef}
        className="modal-input chat-picker-input"
        placeholder="nick albo link Twitch / Kick"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && typed.length === 1) onPick(typed[0])
          if (e.key === 'Escape') onCancel?.()
        }}
      />
      {typed.map(c => (
        <button key={`${c.type}-${c.channel}`} className="chat-picker-item" onClick={() => onPick(c)}>
          <span className="chat-picker-dot" style={{ color: PLATFORM_COLOR[c.type] }}>●</span>
          Czat {PLATFORM_NAME[c.type]}: {c.channel}
        </button>
      ))}

      {onCancel && <button className="btn chat-picker-cancel" onClick={onCancel}>Anuluj</button>}
    </div>
  )
}

// One chat: source bar + the chat itself.
// config: { type, channel } of this pane, or null = nothing chosen yet (picker);
// settings: Chatango room / custom URL from Settings
function ChatPane({ index, config, settings, sources, showBar, onChange, onClear }) {
  const [picking, setPicking] = useState(false)
  const base = baseChatType(settings)
  const empty = !config
  const stream = !empty && isStreamChat(config)
  const embedUrl = base === 'custom' && settings.customUrl ? settings.customUrl : chatangoUrl(settings.room)
  // A channel picked by hand (not from a dock) still gets its own button
  const barSources = stream && !sources.some(s => s.type === config.type && s.channel === config.channel)
    ? [...sources, { type: config.type, channel: config.channel }]
    : sources
  const pick = (c) => { setPicking(false); onChange({ type: c.type, channel: c.channel, baseType: base }) }

  return (
    <div className="chat-pane">
      {showBar && !empty && (
        <div className="chat-source-bar">
          {index != null && <span className="chat-pane-num" title={`Czat ${index}`}>{index}</span>}
          <button
            className={`chat-source-btn ${!stream && !picking ? 'active' : ''}`}
            onClick={() => pick({ type: base, channel: undefined })}
          >
            {base === 'custom' ? 'Własny' : 'Chatango'}
          </button>
          {barSources.map(src => {
            const active = !picking && config.type === src.type && config.channel === src.channel
            return (
              <button
                key={`${src.type}-${src.channel}`}
                className={`chat-source-btn ${active ? 'active' : ''}`}
                onClick={() => pick(src)}
                // platform colour only when inactive — on the accent background it was unreadable
                style={active ? undefined : { color: PLATFORM_COLOR[src.type] }}
              >
                {src.type === 'twitch' ? '▶' : '●'} {src.channel}
              </button>
            )
          })}
          <button
            className={`chat-source-btn ${picking ? 'active' : ''}`}
            onClick={() => setPicking(p => !p)}
            title="Wybierz dowolny kanał Twitch / Kick"
          >
            ＋ Inny
          </button>
          {onClear && (
            <button className="chat-source-btn chat-source-close" onClick={onClear} title="Zamknij ten czat">✕</button>
          )}
        </div>
      )}

      <div className="chat-webview-wrap">
        {empty || picking ? (
          <ChatPicker
            base={base}
            sources={sources}
            onPick={pick}
            onCancel={picking ? () => setPicking(false) : undefined}
          />
        ) : config.type === 'kick' && stream ? (
          // Kick's own popout chat — its realtime config changes server-side,
          // so a hand-rolled Pusher client keeps breaking
          <ChatWebview key={`kick-${config.channel}`} src={`https://kick.com/popout/${encodeURIComponent(config.channel)}/chat`} />
        ) : config.type === 'twitch' && stream ? (
          <iframe
            key={config.channel}
            src={`https://www.twitch.tv/embed/${config.channel}/chat?parent=localhost&darkpopout`}
            allow="autoplay"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <ChatWebview key={embedUrl} src={embedUrl} darkTheme={base !== 'custom'} />
        )}
      </div>
    </div>
  )
}

// Mouse-drag helper. Webviews/iframes swallow mousemove, so a transparent
// shield covers the panel while dragging.
function useDrag(onMove) {
  const [dragging, setDragging] = useState(false)
  const start = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const sx = e.clientX, sy = e.clientY
    const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy)
    const up = () => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [onMove])
  return [dragging, start]
}

export default function ChatPanel({
  chatConfig, chatConfig2, dualChat, splitRatio = 0.5, docks = [],
  onChatConfigChange, onChatConfig2Change, onSplitRatioChange,
}) {
  const panelRef = useRef(null)
  // Separate widths: one chat is narrow, two side-by-side chats need room
  const [singleWidth, setSingleWidth] = useState(310)
  const [dualWidth, setDualWidth] = useState(620)
  const width = dualChat ? dualWidth : singleWidth
  const widthAtStart = useRef(width)
  const ratioAtStart = useRef(splitRatio)
  const streamSources = getChatSources(docks)

  const [resizing, startResize] = useDrag(useCallback((dx) => {
    const w = widthAtStart.current - dx
    if (dualChat) setDualWidth(Math.max(400, Math.min(1100, w)))
    else setSingleWidth(Math.max(200, Math.min(500, w)))
  }, [dualChat]))
  // Panes sit side by side: dragging the divider right grows the left chat
  const [splitting, startSplit] = useDrag(useCallback((dx) => {
    const w = panelRef.current?.clientWidth || 1
    onSplitRatioChange?.(Math.max(0.2, Math.min(0.8, ratioAtStart.current + dx / w)))
  }, [onSplitRatioChange]))

  const pane1 = (
    <ChatPane
      index={dualChat ? 1 : null}
      config={chatConfig}
      settings={chatConfig}
      sources={streamSources}
      showBar
      onChange={patch => onChatConfigChange({ ...chatConfig, ...patch })}
    />
  )

  return (
    <div ref={panelRef} className={`chat-panel ${dualChat ? 'dual' : ''}`} style={{ width }}>
      <div
        className={`chat-resize-handle ${resizing ? 'dragging' : ''}`}
        onMouseDown={e => { widthAtStart.current = width; startResize(e) }}
      />

      {dualChat ? (
        <>
          <div className="chat-slot" style={{ flex: `${splitRatio} 1 0` }}>{pane1}</div>
          <div
            className={`chat-split-handle ${splitting ? 'dragging' : ''}`}
            onMouseDown={e => { ratioAtStart.current = splitRatio; startSplit(e) }}
            title="Przeciągnij, aby zmienić proporcje czatów"
          />
          <div className="chat-slot" style={{ flex: `${1 - splitRatio} 1 0` }}>
            <ChatPane
              index={2}
              config={chatConfig2}
              settings={chatConfig}
              sources={streamSources}
              showBar
              onChange={patch => onChatConfig2Change({ ...(chatConfig2 || {}), ...patch })}
              onClear={() => onChatConfig2Change(null)}
            />
          </div>
        </>
      ) : (
        <div className="chat-slot" style={{ flex: '1 1 0' }}>{pane1}</div>
      )}

      {(resizing || splitting) && (
        <div className="chat-drag-shield" style={{ cursor: 'col-resize' }} />
      )}
    </div>
  )
}
