import { useState, useEffect, useCallback } from 'react'
import Toolbar from './components/Toolbar'
import DockGrid from './components/DockGrid'
import ChatPanel from './components/ChatPanel'
import SettingsModal from './components/SettingsModal'
import MediaViewer, { classifyChatUrl } from './components/MediaViewer'
import { parseStreamUrl, streamKey } from './utils/streamParser'
import './App.css'

function migrateChatConfig(cfg) {
  if (!cfg) return null
  // "Chatango 2" became the only Chatango mode
  if (cfg.type === 'chatango2') cfg = { ...cfg, type: cfg.baseType || 'chatango' }
  // Migrate stale URLs/room names to current room
  if (cfg.type === 'custom' && cfg.customUrl && cfg.customUrl.includes('st.chatango.com')) {
    return { type: 'chatango', room: 'chatraszei', customUrl: '' }
  }
  if ((cfg.type === 'chatango' || !cfg.type) && (cfg.room === 'raszei' || cfg.room?.includes('st.chatango.com'))) {
    return { ...cfg, type: 'chatango', room: 'chatraszei' }
  }
  return cfg
}

// Re-parse embed URL to get correct wrapper format
function migrateDock(dock) {
  if (!dock.originalUrl) return dock
  const fresh = parseStreamUrl(dock.originalUrl)
  if (fresh) return { ...dock, embedUrl: fresh.embedUrl }
  return dock
}

const EMPTY_DOCK = { embedUrl: '', platform: '', label: '', id: '', originalUrl: '' }

const MAX_HISTORY = 30

const DEFAULT_STATE = {
  docks: [EMPTY_DOCK, EMPTY_DOCK, EMPTY_DOCK, EMPTY_DOCK],
  layout: 'quad',
  chatConfig: { type: 'chatango', room: 'chatraszei', customUrl: '' },
  activeAudioDock: 0,
  multiAudio: false,
  streamHistory: [],
  favorites: [],
  dualChat: false,
  chatConfig2: null,
  chatSplit: 0.5,
  gridSplit: { x: 0.5, y: 0.5 },
}

export default function App() {
  const [docks, setDocks] = useState(DEFAULT_STATE.docks)
  const [layout, setLayout] = useState(DEFAULT_STATE.layout)
  const [chatConfig, setChatConfig] = useState(DEFAULT_STATE.chatConfig)
  const [activeAudioDock, setActiveAudioDock] = useState(DEFAULT_STATE.activeAudioDock)
  const [streamHistory, setStreamHistory] = useState(DEFAULT_STATE.streamHistory)
  const [favorites, setFavorites] = useState(DEFAULT_STATE.favorites)
  const [multiAudio, setMultiAudio] = useState(DEFAULT_STATE.multiAudio)
  const [dualChat, setDualChat] = useState(DEFAULT_STATE.dualChat)
  const [chatConfig2, setChatConfig2] = useState(DEFAULT_STATE.chatConfig2)
  const [chatSplit, setChatSplit] = useState(DEFAULT_STATE.chatSplit)
  // flexible 2×2 grid: where the vertical (x) and horizontal (y) lines sit
  const [gridSplit, setGridSplit] = useState(DEFAULT_STATE.gridSplit)
  const [muteAll, setMuteAll] = useState(false)
  const [enabledDocks, setEnabledDocks] = useState(() => new Set([0]))
  const [nativeMuted, setNativeMuted] = useState({})
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Link / image / video clicked in the Chatango chat -> viewer, dock or browser
  const [viewerUrl, setViewerUrl] = useState(null)
  useEffect(() => window.electronAPI?.onChatOpenUrl?.(url => {
    if (classifyChatUrl(url).kind === 'external') window.electronAPI?.openExternal(url)
    else setViewerUrl(url)
  }), [])
  const [loaded, setLoaded] = useState(false)

  // Load persisted state
  useEffect(() => {
    if (!window.electronAPI) {
      setLoaded(true)
      return
    }
    window.electronAPI.store.get('app-state').then(state => {
      if (state) {
        if (Array.isArray(state.docks)) setDocks(state.docks.map(migrateDock))
        if (state.layout) setLayout(state.layout)
        if (state.chatConfig) setChatConfig(migrateChatConfig(state.chatConfig) ?? DEFAULT_STATE.chatConfig)
        if (typeof state.activeAudioDock === 'number') setActiveAudioDock(state.activeAudioDock)
        if (Array.isArray(state.streamHistory)) setStreamHistory(state.streamHistory)
        if (Array.isArray(state.favorites)) setFavorites(state.favorites)
        if (typeof state.multiAudio === 'boolean') setMultiAudio(state.multiAudio)
        if (typeof state.muteAll === 'boolean') setMuteAll(state.muteAll)
        if (typeof state.dualChat === 'boolean') setDualChat(state.dualChat)
        if (state.chatConfig2 && typeof state.chatConfig2 === 'object') setChatConfig2(migrateChatConfig(state.chatConfig2))
        if (typeof state.chatSplit === 'number') setChatSplit(Math.max(0.2, Math.min(0.8, state.chatSplit)))
        if (state.gridSplit && typeof state.gridSplit.x === 'number' && typeof state.gridSplit.y === 'number') {
          setGridSplit({ x: Math.max(0.15, Math.min(0.85, state.gridSplit.x)), y: Math.max(0.15, Math.min(0.85, state.gridSplit.y)) })
        }
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const addToHistory = useCallback((streamData) => {
    setStreamHistory(prev => {
      const without = prev.filter(s => s.embedUrl !== streamData.embedUrl)
      return [{ ...streamData, lastUsed: Date.now() }, ...without].slice(0, MAX_HISTORY)
    })
  }, [])

  // Persist state on change (debounced — volume sliders fire on every step)
  useEffect(() => {
    if (!loaded || !window.electronAPI) return
    const t = setTimeout(() => {
      window.electronAPI.store.set('app-state', {
        docks,
        layout,
        chatConfig,
        activeAudioDock,
        multiAudio,
        muteAll,
        streamHistory,
        favorites,
        dualChat,
        chatConfig2,
        chatSplit,
        gridSplit,
      })
    }, 300)
    return () => clearTimeout(t)
  }, [docks, layout, chatConfig, activeAudioDock, multiAudio, muteAll, streamHistory, favorites, dualChat, chatConfig2, chatSplit, gridSplit, loaded])

  // Fullscreen state comes from main (button and F11 both toggle it there)
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => {
    window.electronAPI?.isFullScreen?.().then(f => setFullScreen(!!f)).catch(() => {})
    return window.electronAPI?.onFullScreenChanged?.(setFullScreen)
  }, [])

  // Always on top
  useEffect(() => {
    window.electronAPI?.setAlwaysOnTop(alwaysOnTop)
  }, [alwaysOnTop])

  // Sync mute state from native player controls
  useEffect(() => {
    function handleMessage(e) {
      if (e.data?.type !== 'kws-mute-sync') return
      const { dockIndex, muted } = e.data
      setNativeMuted(prev => {
        if (prev[dockIndex] === muted) return prev
        return { ...prev, [dockIndex]: muted }
      })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [multiAudio])

  // If activeAudioDock points to an empty slot, move it to the first loaded dock
  useEffect(() => {
    if (!loaded || multiAudio) return
    if (docks[activeAudioDock]?.embedUrl) return
    const first = docks.findIndex(d => d.embedUrl)
    if (first >= 0) setActiveAudioDock(first)
  }, [docks, activeAudioDock, multiAudio, loaded])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const idx = parseInt(e.key) - 1
        if (layout === 'quad' || idx === 0) {
          setActiveAudioDock(idx)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [layout])

  const handleDockAction = useCallback((action, dockIndex, payload) => {
    switch (action) {
      case 'openFavorite': {
        // Favourite from the toolbar menu -> dock. Re-parse the link so an old
        // embed-URL format gets refreshed; the user's name for it stays.
        const fresh = payload.originalUrl ? parseStreamUrl(payload.originalUrl) : null
        payload = fresh ? { ...fresh, label: payload.label } : payload
      }
      // falls through
      case 'setStream':
        setDocks(prev => {
          const next = [...prev]
          next[dockIndex] = payload
          return next
        })
        addToHistory(payload)
        setActiveAudioDock(prev => prev === null ? dockIndex : prev)
        break

      case 'setVolume': {
        const vol = Math.max(0, Math.min(100, Math.round(Number(payload))))
        setDocks(prev => {
          if (!prev[dockIndex]?.embedUrl || prev[dockIndex].volume === vol) return prev
          const next = [...prev]
          next[dockIndex] = { ...next[dockIndex], volume: vol }
          return next
        })
        break
      }

      case 'removeHistory': {
        const key = streamKey(payload)
        setStreamHistory(prev => prev.filter(s => streamKey(s) !== key))
        break
      }

      case 'toggleFavorite': {
        const key = streamKey(payload)
        if (!key) break
        setFavorites(prev => prev.some(f => streamKey(f) === key)
          ? prev.filter(f => streamKey(f) !== key)
          : [...prev, {
              embedUrl: payload.embedUrl, platform: payload.platform, label: payload.label,
              id: payload.id, originalUrl: payload.originalUrl,
            }])
        break
      }

      case 'updateFavorite': {
        // payload: { oldKey, fav } — edited name and/or link
        const { oldKey, fav } = payload
        const newKey = streamKey(fav)
        if (!newKey) break
        setFavorites(prev => {
          const i = prev.findIndex(f => streamKey(f) === oldKey)
          if (i < 0) return prev
          // a changed link may now equal another favourite: keep just this one
          const next = prev.filter((f, j) => j === i || streamKey(f) !== newKey)
          next[next.indexOf(prev[i])] = fav
          return next
        })
        // only the name changed: docks playing this stream show the new name
        if (newKey === oldKey) {
          setDocks(prev => prev.some(d => d.embedUrl && streamKey(d) === oldKey && d.label !== fav.label)
            ? prev.map(d => (d.embedUrl && streamKey(d) === oldKey ? { ...d, label: fav.label } : d))
            : prev)
        }
        break
      }

      case 'remove':
        setDocks(prev => {
          const next = [...prev]
          next[dockIndex] = EMPTY_DOCK
          return next
        })
        setEnabledDocks(prev => { const n = new Set(prev); n.delete(dockIndex); return n })
        break

      case 'setAudio':
        if (multiAudio) {
          setEnabledDocks(prev => {
            const n = new Set(prev)
            if (n.has(dockIndex)) n.delete(dockIndex)
            else n.add(dockIndex)
            return n
          })
        } else {
          setActiveAudioDock(dockIndex)
        }
        break

      case 'showQuad':
        setLayout('quad')
        break

      case 'focusSingle':
        // Switch to single layout + solo audio on this dock
        setMultiAudio(false)
        setActiveAudioDock(dockIndex)
        setLayout('single')
        break

      case 'soloFromMute':
        setMuteAll(false)
        setMultiAudio(false)
        setActiveAudioDock(dockIndex)
        break

      case 'soloFromMuteSolo':
        setMuteAll(false)
        setActiveAudioDock(dockIndex)
        break

      case 'toggleMuteAll':
        setMuteAll(p => !p)
        break

      case 'swapDocks': {
        const a = dockIndex
        const b = payload
        setDocks(prev => {
          const next = [...prev]
          ;[next[a], next[b]] = [next[b], next[a]]
          return next
        })
        setActiveAudioDock(prev => {
          if (prev === a) return b
          if (prev === b) return a
          return prev
        })
        setEnabledDocks(prev => {
          const n = new Set(prev)
          const hasA = n.has(a), hasB = n.has(b)
          if (hasA && !hasB) { n.delete(a); n.add(b) }
          else if (!hasA && hasB) { n.delete(b); n.add(a) }
          return n
        })
        break
      }
    }
  }, [multiAudio])

  if (!loaded) {
    return <div className="loading">Ładowanie...</div>
  }

  return (
    <div className="app">
      <Toolbar
        layout={layout}
        multiAudio={multiAudio}
        muteAll={muteAll}
        alwaysOnTop={alwaysOnTop}
        onLayoutChange={setLayout}
        onToggleMultiAudio={() => {
          setMultiAudio(p => {
            if (!p) setEnabledDocks(new Set([activeAudioDock]))
            return !p
          })
        }}
        onToggleMuteAll={() => setMuteAll(p => !p)}
        onToggleAlwaysOnTop={() => setAlwaysOnTop(p => !p)}
        fullScreen={fullScreen}
        onToggleFullScreen={() => window.electronAPI?.toggleFullScreen()}
        onOpenSettings={() => setShowSettings(true)}
        dualChat={dualChat}
        // 2nd pane starts empty (chooser) - nothing opens automatically
        onDualChatChange={setDualChat}
        favorites={favorites}
        docks={docks}
        onDockAction={handleDockAction}
      />

      <div className="app-body">
        <DockGrid
          docks={docks}
          layout={layout}
          activeAudioDock={activeAudioDock}
          multiAudio={multiAudio}
          enabledDocks={enabledDocks}
          split={gridSplit}
          onSplitChange={setGridSplit}
          muteAll={muteAll}
          nativeMuted={nativeMuted}
          streamHistory={streamHistory}
          favorites={favorites}
          onDockAction={handleDockAction}
        />
        <ChatPanel
          chatConfig={chatConfig}
          chatConfig2={chatConfig2}
          dualChat={dualChat}
          splitRatio={chatSplit}
          docks={docks}
          onChatConfigChange={setChatConfig}
          onChatConfig2Change={setChatConfig2}
          onSplitRatioChange={setChatSplit}
        />
      </div>

      {viewerUrl && (
        <MediaViewer
          url={viewerUrl}
          docks={docks}
          onOpenInDock={(i, stream) => handleDockAction('setStream', i, stream)}
          onClose={() => setViewerUrl(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          chatConfig={chatConfig}
          onSave={(config) => {
            setChatConfig(prev => {
              // Same chat source (only e.g. the font changed): keep whatever the
              // pane shows now (a Kick/Twitch chat stays), just update settings
              const prevBase = prev.type === 'twitch' || prev.type === 'kick' ? (prev.baseType || 'chatango') : prev.type
              const same = config.type === prevBase
                && config.room === (prev.room || 'chatraszei')
                && config.customUrl === (prev.customUrl || '')
              const fonts = { fontPct: config.fontPct, kickFontPct: config.kickFontPct, twitchFontPct: config.twitchFontPct }
              return same ? { ...prev, ...fonts } : config
            })
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
