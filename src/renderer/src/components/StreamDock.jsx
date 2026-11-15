import { useRef, useEffect, useState, useCallback } from 'react'
import { getPlatformMeta, streamKey } from '../utils/streamParser'
import AddStreamModal from './AddStreamModal'

// Twitch shows a "mature content" gate (Zacznij oglądać / Start Watching) that
// keeps the stream paused+muted. Docks don't take mouse input, so click it for
// the user — checked every second because it can appear after load too.
// Cloudflare "checking your browser" page titles (PL / EN)
const CHECK_TITLE = /cierpliwo|chwileczk|weryfikacj|just a moment|attention required|checking your browser/i

// Video quality per dock (stored in the dock). YouTube and Twitch let us pick
// it; Kick's embed and the others choose it themselves.
const QUALITIES = [
  { key: 'auto', label: 'Auto', hint: 'player dobiera sam' },
  { key: 'max', label: 'Max', hint: 'najwyższa dostępna' },
  { key: '1080', label: '1080p' },
  { key: '720', label: '720p' },
  { key: '480', label: '480p' },
  { key: '360', label: '360p' },
]
const qualityLabel = (q) => (QUALITIES.find(x => x.key === q) || QUALITIES[0]).label

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
  const quality = dock.quality || 'auto'
  const canQuality = dock.platform === 'youtube' || dock.platform === 'twitch'
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const [qualityOpen, setQualityOpen] = useState(false)
  // The stream shown by the user's own browser in a window glued over this
  // dock (YouTube 18+, Cloudflare sites): { state: 'opening' | 'open', browser }
  const [ext, setExt] = useState(null)
  const [extError, setExtError] = useState('')
  const EXT_BAR = 30 // the top strip of the dock stays KWS's: close / reload
  const dockRect = () => {
    const r = containerRef.current?.getBoundingClientRect()
    return r ? { x: r.left, y: r.top + EXT_BAR, w: r.width, h: Math.max(40, r.height - EXT_BAR) } : null
  }
  const extUrl = useRef('')
  const openExternal = async (url) => {
    extUrl.current = url
    setExtError('')
    setExt({ state: 'opening' })
    const res = await window.electronAPI?.extOpen(dockIndex, url, dockRect())
    if (res?.ok) setExt({ state: 'open', browser: res.browser, controlled: res.controlled })
    else { setExt(null); setExtError(res?.error || 'Nie udało się otworzyć przeglądarki') }
  }
  const closeExternal = () => { window.electronAPI?.extClose(dockIndex); setExt(null) }
  // keep the browser window on the dock: size/position changes (grid drag,
  // toolbar sliding, layout) + a slow fallback poll
  useEffect(() => {
    if (ext?.state !== 'open') return
    let last = ''
    const push = () => {
      const r = dockRect()
      if (!r) return
      const k = [r.x, r.y, r.w, r.h].map(Math.round).join(',')
      if (k !== last) { last = k; window.electronAPI?.extRect(dockIndex, r) }
    }
    const ro = new ResizeObserver(push)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', push)
    const t = setInterval(push, 400)
    push()
    return () => { ro.disconnect(); window.removeEventListener('resize', push); clearInterval(t) }
  }, [ext?.state, dockIndex])
  useEffect(() => window.electronAPI?.onExtClosed?.((k) => { if (k === dockIndex) setExt(null) }), [dockIndex])
  useEffect(() => {
    if (!ext) return
    window.electronAPI?.extAudio(dockIndex, muteAll || !hasAudio || volume === 0, volume)
  }, [ext, muteAll, hasAudio, volume, dockIndex])
  // another stream in this dock / dock goes away: close the browser window
  useEffect(() => () => { window.electronAPI?.extClose(dockIndex) }, [dock.embedUrl, dockIndex])

  // YouTube refused to play this video in an embed (age restriction etc.)
  const [ytError, setYtError] = useState(null) // { text, age }
  const meta = getPlatformMeta(dock.platform)
  // strumyk.cv sits behind Cloudflare: when the dock shows its check page,
  // offer a window where the user passes it (docks don't take clicks)
  const isCheckSite = dock.platform === 'strumyk'
  const [needsCheck, setNeedsCheck] = useState(false)
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

  // ── Recording this dock ──────────────────────────────────────────────
  const [rec, setRec] = useState(null)        // { id, start } while recording
  const [recNote, setRecNote] = useState(null) // { text, path } after it ends / fails
  const [, setTick] = useState(0)
  const recRef = useRef(null)
  recRef.current = rec
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [rec])
  useEffect(() => window.electronAPI?.onRecEnded?.((info) => {
    if (info.id !== recRef.current?.id) return
    setRec(null)
    const mb = (info.bytes / 1048576).toFixed(info.bytes > 104857600 ? 0 : 1)
    setRecNote(info.bytes > 0
      ? { text: `Zapisano nagranie (${mb} MB)${info.reason === 'stopped' ? '' : ' — stream przerwał nagrywanie'}`, path: info.path }
      : { text: 'Nagranie puste — nic nie zapisano' })
  }), [])
  useEffect(() => {
    if (!recNote) return
    const t = setTimeout(() => setRecNote(null), 9000)
    return () => clearTimeout(t)
  }, [recNote])
  // a new stream / reload ends the recording (the file keeps what was recorded)
  useEffect(() => () => { if (recRef.current) window.electronAPI?.recStop(recRef.current.id) }, [liveSrc])
  const toggleRecording = async () => {
    if (rec) { window.electronAPI?.recStop(rec.id); return }
    const target = isYouTube ? { ytId: dock.id } : { wcId: wcIdRef.current }
    const res = await window.electronAPI?.recStart(target, dock.label || meta.name)
    if (res?.ok) { setRec({ id: res.id, start: Date.now() }); setRecNote(null) }
    else setRecNote({ text: res?.error || 'Nie udało się nagrać' })
  }
  const recTime = rec ? (() => {
    const sec = Math.floor((Date.now() - rec.start) / 1000)
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, ss = sec % 60
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
  })() : ''

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
        if (dock.platform === 'showup' || dock.platform === 'strumyk') window.electronAPI?.focusVideoPlayer(id)
        if (isCheckSite) setNeedsCheck(CHECK_TITLE.test(wv.getTitle() || ''))
        if (dock.platform === 'twitch') wv.executeJavaScript(TWITCH_GATE_JS).catch(() => {})
        if (dock.platform === 'twitch' && qualityRef.current !== 'auto') window.electronAPI?.setTwitchQuality(id, qualityRef.current)
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

    // Site behind Cloudflare: its "are you human" page has a telltale title
    const handleTitle = (e) => { if (isCheckSite) setNeedsCheck(CHECK_TITLE.test(e.title || '')) }

    wv.addEventListener('dom-ready', handleReady)
    wv.addEventListener('did-finish-load', handleFinish)
    wv.addEventListener('render-process-gone', handleGone)
    wv.addEventListener('page-title-updated', handleTitle)
    return () => {
      wv.removeEventListener('page-title-updated', handleTitle)
      clearTimeout(reloadTimer)
      wv.removeEventListener('dom-ready', handleReady)
      wv.removeEventListener('did-finish-load', handleFinish)
      wv.removeEventListener('render-process-gone', handleGone)
    }
  }, [liveSrc])

  // strumyk.cv: reload once the user closes the check window (new cookies)
  useEffect(() => {
    if (!isCheckSite) return
    return window.electronAPI?.onSiteSessionChanged?.(() => {
      setNeedsCheck(false)
      try { webviewRef.current?.reload() } catch {}
    })
  }, [isCheckSite])

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

  // Quality: YouTube through main's frame controller; Twitch on change (its
  // load-time apply is in handleReady above)
  const qualityApplied = useRef(null)
  useEffect(() => {
    if (!liveSrc) return
    if (isYouTube) { window.electronAPI?.setYouTubeQuality(dock.id, quality); return }
    if (dock.platform === 'twitch') {
      const id = wcIdRef.current
      if (id && qualityApplied.current !== null && qualityApplied.current !== quality) window.electronAPI?.setTwitchQuality(id, quality)
      qualityApplied.current = quality
    }
  }, [quality, liveSrc, isYouTube, dock.id, dock.platform])

  // YouTube: check whether the embed can play it; poll — the message comes
  // a moment after load, and a retry may fix a temporary error
  useEffect(() => {
    setYtError(null)
    if (!isYouTube || !liveSrc) return
    let stop = false, timer = null
    const check = async () => {
      if (stop) return
      let st = null
      try { st = await window.electronAPI?.ytStatus(dock.id) } catch {}
      if (stop) return
      if (st && st.ok === false) {
        const age = /wiek|age|18|confirm your|potwierd/i.test(st.text || '') || /AGE|LOGIN_REQUIRED/.test(st.status || '')
        setYtError({ text: st.text, age })
      } else if (st && st.ok) setYtError(null)
      timer = setTimeout(check, st && st.ok && !st.unknown ? 15000 : 3000)
    }
    timer = setTimeout(check, 2500)
    return () => { stop = true; clearTimeout(timer) }
  }, [isYouTube, liveSrc, dock.id])

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


  return (
    <div
      ref={containerRef}
      className={`stream-dock ${hasAudio ? 'has-audio' : ''}${isDragOver ? ' drag-over' : ''}`}
      data-copy-link={dock.originalUrl || dock.embedUrl}
      data-copy-name={dock.label}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {liveSrc && isYouTube && !ext && (
        <iframe
          key={liveSrc}
          src={ytMutedSrc(liveSrc)}
          allowFullScreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      )}
      {liveSrc && !isYouTube && !ext && (
        <webview
          key={liveSrc}
          ref={webviewRef}
          src={liveSrc}
          allowpopups="true"
          style={{ position: 'absolute', inset: 0, border: 'none', pointerEvents: 'none' }}
        />
      )}
      {liveSrc && needsCheck && !ext && (
        <div className="dock-check">
          <div className="dock-check-title">Strona wymaga weryfikacji</div>
          <div className="dock-check-text">strumyk.cv sprawdza, czy jesteś człowiekiem (Cloudflare). W aplikacji ta weryfikacja potrafi się zapętlać — wtedy otwórz stream w przeglądarce.</div>
          <div className="dock-check-actions">
            <button className="btn active" onClick={() => openExternal(dock.embedUrl)} title="Twój Chrome jako okno przyklejone do tego docka">⧉ Otwórz w Chrome w docku</button>
            <button className="btn" onClick={() => window.electronAPI?.openExternal(dock.embedUrl)}>↗ W przeglądarce</button>
            <button className="btn" onClick={() => window.electronAPI?.openSiteCheck(dock.embedUrl)}>Spróbuj weryfikacji tutaj</button>
          </div>
        </div>
      )}

      {/* YouTube can't play this one in an embed: say why, offer the browser */}
      {liveSrc && ytError && !ext && (
        <div className="dock-check">
          <div className="dock-check-title">{ytError.age ? 'Film z ograniczeniem wiekowym' : 'YouTube nie odtworzy tego filmu tutaj'}</div>
          <div className="dock-check-text">
            {ytError.age
              ? 'YouTube nie pozwala odtwarzać filmów 18+ w osadzonych playerach (takich jak docki). Obejrzysz go w przeglądarce, w której jesteś zalogowany na konto z potwierdzonym wiekiem.'
              : (ytError.text || 'Film jest niedostępny w osadzonym playerze.')}
          </div>
          {ytError.age && ytError.text && <div className="dock-check-text" style={{ opacity: 0.7 }}>YouTube: {ytError.text}</div>}
          <div className="dock-check-actions">
            <button className="btn active" onClick={() => openExternal(`https://www.youtube.com/watch?v=${dock.id}`)} title="Twój Chrome (profil z zalogowanym kontem) jako okno przyklejone do tego docka">⧉ Otwórz w Chrome w docku</button>
            <button className="btn" onClick={() => window.electronAPI?.openExternal(`https://www.youtube.com/watch?v=${dock.id}`)}>↗ W przeglądarce</button>
            <button className="btn" onClick={() => { setYtError(null); reload() }}>↻ Spróbuj ponownie</button>
          </div>
        </div>
      )}

      {/* the browser window sits on top of this; visible if it isn't there */}
      {ext && (
        <div className="dock-ext-bar">
          <span className="dock-ext-title">⧉ {ext.state === 'opening' ? 'Otwieram przeglądarkę…' : `${ext.browser}${ext.controlled === false ? ' (bez sterowania dźwiękiem)' : ''}`}</span>
          <button
            className={`dock-ext-btn ${!muteAll && hasAudio && volume > 0 ? 'on' : ''}`}
            onClick={() => {
              if (muteAll) onAction(multiAudio ? 'soloFromMute' : 'soloFromMuteSolo', dockIndex)
              else if (!hasAudio) onAction('setAudio', dockIndex)
              else setVolume(v => v === 0 ? 100 : 0)
            }}
            title={muteAll ? 'Kliknij aby słuchać tylko tego streama' : !hasAudio ? 'Aktywuj dźwięk' : volume === 0 ? 'Odcisz' : 'Wycisz'}
          >{volIcon(muteAll ? 0 : (hasAudio ? volume : 0))}</button>
          <input
            type="range"
            className="dock-ext-vol"
            min={0} max={100}
            value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            title={`Głośność: ${volume}%`}
          />
          <button className="dock-ext-btn" onClick={() => openExternal(extUrl.current)} title="Otwórz jeszcze raz">↻</button>
          <button className="dock-ext-btn close" onClick={closeExternal} title="Zamknij okno przeglądarki">✕</button>
        </div>
      )}
      {ext && (
        <div className="dock-check dock-ext">
          <div className="dock-check-title">{ext.state === 'opening' ? 'Otwieram przeglądarkę…' : `Stream w oknie ${ext.browser}`}</div>
          <div className="dock-check-text">Okno przeglądarki jest przyklejone do tego docka i przesuwa się razem z nim. Dźwięk i jakość ustawiasz w samym playerze.</div>
          <div className="dock-check-actions">
            <button className="btn" onClick={closeExternal}>✕ Zamknij okno przeglądarki</button>
          </div>
        </div>
      )}
      {extError && !ext && (
        <div className="dock-rec-note">
          <span>{extError}</span>
          <button className="dock-rec-note-x" onClick={() => setExtError('')} title="Zamknij">✕</button>
        </div>
      )}

      {/* recording: always-visible badge + the "saved" note */}
      {rec && (
        <button className="dock-rec-badge" onClick={toggleRecording} title="Nagrywanie — kliknij, aby zatrzymać">
          <span className="dock-rec-dot" /> REC {recTime}
        </button>
      )}
      {recNote && (
        <div className="dock-rec-note">
          <span>{recNote.text}</span>
          {recNote.path && <button className="btn" onClick={() => window.electronAPI?.showInFolder(recNote.path)}>Pokaż w folderze</button>}
          <button className="dock-rec-note-x" onClick={() => setRecNote(null)} title="Zamknij">✕</button>
        </div>
      )}

      {/* Hover overlay controls */}
      <div className="dock-controls" style={ext ? { display: 'none' } : undefined}>
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

          {/* Video quality */}
          <div className="dock-quality">
            <button
              className={`dock-btn dock-quality-btn ${quality !== 'auto' ? 'set' : ''}`}
              onClick={() => canQuality && setQualityOpen(o => !o)}
              disabled={!canQuality}
              title={canQuality ? `Jakość obrazu: ${qualityLabel(quality)} (wpływa też na nagranie)` : 'Ten player sam dobiera jakość — nie da się jej tu wybrać'}
            >{canQuality ? qualityLabel(quality) : 'Auto'}</button>
            {qualityOpen && canQuality && (
              <div className="dock-quality-menu" onMouseLeave={() => setQualityOpen(false)}>
                {QUALITIES.map(q => (
                  <button
                    key={q.key}
                    className={`dock-quality-opt ${quality === q.key ? 'on' : ''}`}
                    onClick={() => { onAction('setQuality', dockIndex, q.key); setQualityOpen(false) }}
                  >
                    <span>{q.label}</span>{q.hint && <span className="dock-quality-hint">{q.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Record this stream */}
          <button
            className={`dock-btn rec-btn ${rec ? 'on' : ''}`}
            onClick={toggleRecording}
            title={rec ? 'Zatrzymaj nagrywanie' : 'Nagrywaj ten stream (zapis do folderu Wideo\\KWS MultiStream)'}
          >
            <span className="rec-icon" />
          </button>

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
