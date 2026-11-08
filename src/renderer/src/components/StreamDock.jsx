import { useRef, useEffect, useState, useCallback } from 'react'
import { getPlatformMeta } from '../utils/streamParser'
import AddStreamModal from './AddStreamModal'

function volIcon(v) {
  if (v === 0) return '🔇'
  if (v < 34) return '🔈'
  if (v < 67) return '🔉'
  return '🔊'
}

export default function StreamDock({ dock, dockIndex, hasAudio, multiAudio, muteAll, nativeMuted, streamHistory, onAction }) {
  const containerRef = useRef(null)
  const webviewRef = useRef(null)
  const wcIdRef = useRef(null)
  const hasAudioRef = useRef(hasAudio)
  const volumeRef = useRef(100)
  const containerSizeRef = useRef({ w: 0, h: 0 })
  const [showAdd, setShowAdd] = useState(false)
  const [volume, setVolume] = useState(100)
  const [liveSrc, setLiveSrc] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const isEmpty = !dock.embedUrl
  const isYouTube = dock.platform === 'youtube'

  // Keep refs in sync for use inside event handlers
  useEffect(() => { hasAudioRef.current = hasAudio }, [hasAudio])
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
        window.electronAPI?.setWebContentsMuted(id, !hasAudioRef.current)
        window.electronAPI?.setWebContentsVolume(id, volumeRef.current / 100)
      } catch {}
    }

    // did-finish-load fires after all subresources load — re-apply size in case
    // the inner player iframe reset the layout
    const handleFinish = () => {
      const id = wcIdRef.current
      if (id) applySize(id)
    }

    wv.addEventListener('dom-ready', handleReady)
    wv.addEventListener('did-finish-load', handleFinish)
    return () => {
      wv.removeEventListener('dom-ready', handleReady)
      wv.removeEventListener('did-finish-load', handleFinish)
    }
  }, [liveSrc])

  // Mute/unmute — YouTube uses frame injection by video ID; others use webview setAudioMuted
  useEffect(() => {
    if (!liveSrc) return
    const effectiveMuted = muteAll || !hasAudio
    if (isYouTube) {
      window.electronAPI?.setYouTubeAudio(dock.id, effectiveMuted, effectiveMuted ? 0 : volume / 100)
    } else {
      const id = wcIdRef.current
      if (!id) return
      window.electronAPI?.setWebContentsMuted(id, effectiveMuted)
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
          src={liveSrc}
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

          {/* Focus single */}
          <button
            className="dock-btn"
            onClick={() => onAction('focusSingle', dockIndex)}
            title="Pokaż tylko ten stream (solo widok + dźwięk)"
          >
            ⊡
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
