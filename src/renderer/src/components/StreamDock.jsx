import { useRef, useEffect, useState, useCallback } from 'react'
import { getPlatformMeta, streamKey } from '../utils/streamParser'
import AddStreamModal from './AddStreamModal'

// Twitch shows a "mature content" gate (Zacznij oglądać / Start Watching) that
// keeps the stream paused+muted. Docks don't take mouse input, so click it for
// the user — checked every second because it can appear after load too.
const TWITCH_GATE_JS = `(function(){
  if (window.__kwsGate) return;
  window.__kwsGate = true;
  setInterval(function(){
    var b = document.querySelector('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    if (b && !b.__kwsClicked) { b.__kwsClicked = true; b.click(); }
  }, 1000);
})()`

// YouTube embeds always start muted (mute=1). The audio controller injected
// by main only runs once the frame has loaded, and until then the player
// would play at its own saved volume — after every (re)load (adding a stream,
// Jeden↔Cztery, ↺, swap) a dock that should be silent could start playing.
// Now it's silent until the controller unmutes the dock that has audio.
function ytMutedSrc(src) {
  try {
    const u = new URL(src)
    u.searchParams.set('mute', '1')
    return u.toString()
  } catch { return src }
}

function volIcon(v) {
  if (v === 0) return '🔇'
  if (v < 34) return '🔈'
  if (v < 67) return '🔉'
  return '🔊'
}

export default function StreamDock({ dock, dockIndex, hasAudio, multiAudio, muteAll, nativeMuted, streamHistory, favorites = [], onAction, single = false }) {
  const containerRef = useRef(null)
  const webviewRef = useRef(null)
  const wcIdRef = useRef(null)
  const hasAudioRef = useRef(hasAudio)
  const muteAllRef = useRef(muteAll)
  const volumeRef = useRef(dock.volume ?? 100)
  const containerSizeRef = useRef({ w: 0, h: 0 })
  const [showAdd, setShowAdd] = useState(false)
  // Volume lives in the dock itself (persisted, follows the stream on swap,
  // survives layout switches and restarts)
  const volume = dock.volume ?? 100
  const setVolume = (v) => onAction('setVolume', dockIndex, typeof v === 'function' ? v(volume) : v)
  const [liveSrc, setLiveSrc] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const isEmpty = !dock.embedUrl
  const isYouTube = dock.platform === 'youtube'
  const isFavorite = !isEmpty && favorites.some(f => streamKey(f) === streamKey(dock))

  // Keep refs in sync for use inside event handlers
  useEffect(() => { hasAudioRef.current = hasAudio }, [hasAudio])
  useEffect(() => { muteAllRef.current = muteAll }, [muteAll])
  useEffect(() => { volumeRef.current = volume }, [volume])


  const handleDragStart = useCallback((e) => {
    e.dataTransfer.setData('text/plain', String(dockIndex))
    e.dataTransfer.effectAllowed = 'move'
    document.body.classList.add('is-dragging')
  }, [dockIndex])

  const handleDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging')
    setIsDragOver(false)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    document.body.classList.remove('is-dragging')
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (isNaN(sourceIndex) || sourceIndex === dockIndex) return
    onAction('swapDocks', sourceIndex, dockIndex)
  }, [dockIndex, onAction])

  // ResizeObserver: mount webview once container has size; update viewport on resize.
  useEffect(() => {
    if (isEmpty) {
      setLiveSrc('')
      return
    }
    setLiveSrc('')
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0]?.contentRect ?? {}
      if (width > 50 && height > 50) {
        const w = Math.round(width), h = Math.round(height)
        containerSizeRef.current = { w, h }
        setLiveSrc(dock.embedUrl)
        // Keep webview guest viewport in sync when container resizes
        const id = wcIdRef.current
        if (id) window.electronAPI?.setWebviewSize(id, w, h)
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [isEmpty, dock.embedUrl])

  const reload = useCallback(() => {
    setLiveSrc('')
    setTimeout(() => setLiveSrc(dock.embedUrl), 50)
  }, [dock.embedUrl])

  // When webview loads a new src, attach dom-ready to get WebContents ID
  useEffect(() => {
    const wv = webviewRef.current
    wcIdRef.current = null
    if (!wv || !liveSrc) return

    const applySize = (id) => {
      const { w, h } = containerSizeRef.current
      if (w && h) window.electronAPI?.setWebviewSize(id, w, h)
    }

    const handleReady = () => {
      try {
        const id = wv.getWebContentsId()
        wcIdRef.current = id
        applySize(id)
        // Runs after every (re)load — manual ↺, crash auto-reload, navigation —
        // so a muted dock must come back muted: global Mute, not the active
        // dock, or its own volume at 0 (the dock's mute icon)
        window.electronAPI?.setWebContentsMuted(id, muteAllRef.current || !hasAudioRef.current || volumeRef.current === 0)
        window.electronAPI?.setWebContentsVolume(id, volumeRef.current / 100)
        // Sites without an embed player: strip the page down to its video
        if (dock.platform === 'showup') window.electronAPI?.focusVideoPlayer(id)
        if (dock.platform === 'twitch') wv.executeJavaScript(TWITCH_GATE_JS).catch(() => {})
      } catch {}
    }

    // did-finish-load fires after all subresources load — re-apply size in case
    // the inner player iframe reset the layout
    const handleFinish = () => {
      const id = wcIdRef.current
      if (id) applySize(id)
    }

    // Guest crashed (gray dock) — reload automatically, with backoff so a
    // stream that crashes in a loop doesn't hammer the CPU.
    let crashTimes = []
    let reloadTimer = null
    const handleGone = (e) => {
      const now = Date.now()
      crashTimes = crashTimes.filter(t => now - t < 60000)
      crashTimes.push(now)
      if (crashTimes.length > 5) return // give up; user can re-add the stream
      const delay = 1000 * crashTimes.length
      reloadTimer = setTimeout(() => {
        try { wv.reload() } catch { setLiveSrc(null); setTimeout(() => setLiveSrc(dock.embedUrl), 50) }
      }, delay)
      console.warn(`[dock] webview gone (${e?.details?.reason || e?.reason || '?'}), reload in ${delay}ms`)
    }

    wv.addEventListener('dom-ready', handleReady)
    wv.addEventListener('did-finish-load', handleFinish)
    wv.addEventListener('render-process-gone', handleGone)
    return () => {
      clearTimeout(reloadTimer)
      wv.removeEventListener('dom-ready', handleReady)
      wv.removeEventListener('did-finish-load', handleFinish)
      wv.removeEventListener('render-process-gone', handleGone)
    }
  }, [liveSrc])

  // ShowUp: reload after login/logout so the dock uses the new session cookies
  useEffect(() => {
    if (dock.platform !== 'showup') return
    return window.electronAPI?.onShowupSessionChanged?.(() => {
      try { webviewRef.current?.reload() } catch {}
    })
  }, [dock.platform])

  // Mute/unmute — YouTube uses frame injection by video ID; others use webview setAudioMuted
  useEffect(() => {
    if (!liveSrc) return
    const effectiveMuted = muteAll || !hasAudio
    if (isYouTube) {
      window.electronAPI?.setYouTubeAudio(dock.id, effectiveMuted, effectiveMuted ? 0 : volume / 100)
    } else {
      const id = wcIdRef.current
      if (!id) return
      // Volume 0 also mutes the whole guest — silent even before the player's
      // <video> exists, and regardless of what the player does with volume
      window.electronAPI?.setWebContentsMuted(id, effectiveMuted || volume === 0)
    }
  }, [hasAudio, muteAll, liveSrc, isYouTube, dock.id, volume])

  // Volume — YouTube uses frame injection; others use webview injection
  useEffect(() => {
    if (!liveSrc || !hasAudio || muteAll) return
    if (isYouTube) {
      window.electronAPI?.setYouTubeAudio(dock.id, false, volume / 100)
    } else {
      const id = wcIdRef.current
      if (!id) return
      window.electronAPI?.setWebContentsVolume(id, volume / 100)
    }
  }, [volume, liveSrc, isYouTube, dock.id, hasAudio, muteAll])


  if (isEmpty) {
    return (
      <div
        className={`stream-dock empty-dock${isDragOver ? ' drag-over' : ''}`}
        onClick={() => setShowAdd(true)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="add-icon">＋</div>
        <div className="add-hint">Kliknij aby dodać stream</div>
        <div className="shortcut-hint">Dock #{dockIndex + 1}</div>

        {showAdd && (
          <AddStreamModal
            dockIndex={dockIndex}
            streamHistory={streamHistory}
            favorites={favorites}
            onAction={onAction}
            onAdd={(streamData) => {
              onAction('setStream', dockIndex, streamData)
              setShowAdd(false)
            }}
            onClose={() => setShowAdd(false)}
          />
        )}
      </div>
    )
  }

  const meta = getPlatformMeta(dock.platform)

  return (
    <div
      ref={containerRef}
      className={`stream-dock ${hasAudio ? 'has-audio' : ''}${isDragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {liveSrc && isYouTube && (
        <iframe
          key={liveSrc}
          src={ytMutedSrc(liveSrc)}
          allowFullScreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      )}
      {liveSrc && !isYouTube && (
        <webview
          key={liveSrc}
          ref={webviewRef}
          src={liveSrc}
          allowpopups="true"
          style={{ position: 'absolute', inset: 0, border: 'none', pointerEvents: 'none' }}
        />
      )}

      {/* Hover overlay controls */}
      <div className="dock-controls">
        <div className="dock-controls-left">
          <span
            className="dock-drag-handle"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            title="Przeciągnij stream"
          >⠿</span>
          <span
            className="platform-badge"
            style={{ color: meta.color }}
          >
            <span className="platform-dot" style={{ color: meta.color }}>■</span>
            {meta.name}
          </span>
          <span className="dock-label">{dock.label}</span>
        </div>

        <div className="dock-controls-right">
          {/* Audio + Volume — hover to expand slider */}
          <div className="vol-control">
            <div className="vol-track">
              <div className="vol-track-inner">
                <span className="vol-pct">{volume}%</span>
                <input
                  type="range"
                  className="vol-slider-h"
                  min={0} max={100}
                  value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  onClick={e => e.stopPropagation()}
                />
              </div>
            </div>
            <button
              className={`dock-btn ${!muteAll && hasAudio && volume > 0 ? 'active' : ''}`}
              onClick={() => {
                if (muteAll) onAction(multiAudio ? 'soloFromMute' : 'soloFromMuteSolo', dockIndex)
                else if (!hasAudio) onAction('setAudio', dockIndex)
                else setVolume(v => v === 0 ? 100 : 0)
              }}
              title={muteAll ? 'Kliknij aby słuchać tylko tego streama' : !hasAudio ? 'Aktywuj dźwięk' : volume === 0 ? 'Odcisz' : `Głośność: ${volume}%`}
            >
              {volIcon(muteAll ? 0 : (hasAudio ? volume : 0))}
            </button>
          </div>

          {/* Favorite */}
          <button
            className={`dock-btn fav-btn ${isFavorite ? 'on' : ''}`}
            onClick={() => onAction('toggleFavorite', dockIndex, dock)}
            title={isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
          >
            {isFavorite ? '★' : '☆'}
          </button>

          {/* Focus single */}
          {/* Grid: show only this stream · single view: back to the 2×2 grid */}
          <button
            className="dock-btn"
            onClick={() => onAction(single ? 'showQuad' : 'focusSingle', dockIndex)}
            title={single ? 'Wróć do widoku czterech streamów' : 'Pokaż tylko ten stream (solo widok + dźwięk)'}
          >
            {single ? '⊞' : '⊡'}
          </button>

          {/* Change stream */}
          <button
            className="dock-btn"
            onClick={() => setShowAdd(true)}
            title="Zmień stream"
          >
            ✎
          </button>

          {/* Reload */}
          <button
            className="dock-btn"
            onClick={reload}
            title="Przeładuj"
          >
            ↺
          </button>

          {/* Remove stream */}
          <button
            className="dock-btn danger"
            onClick={() => onAction('remove', dockIndex)}
            title="Usuń stream"
          >
            ✕
          </button>
        </div>
      </div>

      {showAdd && (
        <AddStreamModal
          dockIndex={dockIndex}
          streamHistory={streamHistory}
          favorites={favorites}
          onAction={onAction}
          onAdd={(streamData) => {
            onAction('setStream', dockIndex, streamData)
            setShowAdd(false)
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
