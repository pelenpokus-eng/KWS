import { useEffect, useRef, useState } from 'react'
import skinUrl from '../assets/tube-skin.png'

// 5th stream: a tube at the crossing point of the 2×2 grid. It shows a
// streamer's camera — from a stream link or a local camera — and doubles as
// the grid handle (drag = resize docks, right-click = 50/50). Its sound has
// its own switch, independent of Solo/Multi and "mute all".
//
// Two looks: 'image' — the user's tube graphic (assets/tube-skin.png, glass
// made see-through) with the picture behind the glass; 'frame' — a 4:3
// picture whose border carries a flowing colour gradient.

// tube-skin.png is 725×1877; the glass window inside it (fractions)
const SKIN_RATIO = 725 / 1877
const SKIN_GLASS = { left: 100 / 725, right: 630 / 725, top: 178 / 1877, bottom: 1250 / 1877 }

// ih: height of the tube graphic · fw: width of the 4:3 frame
export const TUBE_SIZES = {
  small: { ih: 260, fw: 200 },
  medium: { ih: 340, fw: 260 },
  large: { ih: 450, fw: 340 },
}
// frame: how the picture sits in the tube — zoom + offset as a fraction of
// the screen size (so it survives a tube size change)
export const DEFAULT_FRAME = { zoom: 1, x: 0, y: 0 }
// mask: soft ellipse around the head — everything outside it (the room
// behind the streamer) fades away. Radii / centre in % of the screen.
export const DEFAULT_MASK = { on: true, w: 46, h: 30, y: 36, soft: 40 }
export const DEFAULT_TUBE = {
  enabled: false, mode: 'link', stream: null, cameraId: '', audio: false, volume: 100,
  size: 'medium', skin: 'frame', // default look: the 4:3 frame frame: DEFAULT_FRAME, mask: DEFAULT_MASK,
}
const ZOOM_MIN = 0.5, ZOOM_MAX = 4

const BORDER = 4 // frame look: thickness of the gradient border

const isImageSkin = (tube) => tube.skin !== 'frame'

export function maskStyle(mask) {
  const m = { ...DEFAULT_MASK, ...(mask || {}) }
  if (!m.on) return {}
  const solid = Math.max(0, Math.min(99, 100 - m.soft))
  const g = `radial-gradient(ellipse ${m.w}% ${m.h}% at 50% ${m.y}%, #000 ${solid}%, transparent 100%)`
  return { WebkitMaskImage: g, maskImage: g }
}

// YouTube must start muted: main's audio controller unmutes it when wanted
function ytMutedSrc(src) {
  try { const u = new URL(src); u.searchParams.set('mute', '1'); return u.toString() } catch { return src }
}

// A stream link in the tube. The player is wider than the tube, so it is
// rendered at 16:9 the tube's height and centred — "cover", like a face cam.
function TubeLink({ stream, audio, volume, w, h }) {
  const isYouTube = stream.platform === 'youtube'
  const ref = useRef(null)
  const [wcId, setWcId] = useState(null)
  const cw = Math.max(w, Math.round(h * 16 / 9))
  const box = { position: 'absolute', top: 0, left: Math.round((w - cw) / 2), width: cw, height: h, border: 'none', pointerEvents: 'none' }

  useEffect(() => {
    if (isYouTube) window.electronAPI?.setYouTubeAudio(stream.id, !audio, audio ? volume / 100 : 0)
  }, [isYouTube, stream.id, audio, volume])

  useEffect(() => {
    const wv = ref.current
    setWcId(null)
    if (!wv || isYouTube) return
    const ready = () => {
      try {
        const id = wv.getWebContentsId()
        setWcId(id)
        window.electronAPI?.setWebviewSize(id, cw, h)
        if (stream.platform === 'showup' || stream.platform === 'strumyk') window.electronAPI?.focusVideoPlayer(id)
      } catch {}
    }
    wv.addEventListener('dom-ready', ready)
    return () => wv.removeEventListener('dom-ready', ready)
  }, [stream.embedUrl, isYouTube, cw, h])

  useEffect(() => {
    if (!wcId) return
    window.electronAPI?.setWebContentsMuted(wcId, !audio || volume === 0)
    window.electronAPI?.setWebContentsVolume(wcId, volume / 100)
  }, [wcId, audio, volume])

  return isYouTube
    ? <iframe key={stream.embedUrl} src={ytMutedSrc(stream.embedUrl)} allow="autoplay; encrypted-media" style={box} />
    : <webview key={stream.embedUrl} ref={ref} src={stream.embedUrl} style={box} />
}

// Local camera (getUserMedia). With sound on, its microphone is played back
// too — that's what a co-watch stream capturing this window needs.
function TubeCamera({ deviceId, audio, volume }) {
  const ref = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let media = null
    let cancelled = false
    setError('')
    navigator.mediaDevices?.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: !!audio,
    }).then(s => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
      media = s
      if (ref.current) ref.current.srcObject = s
    }).catch(e => { if (!cancelled) setError(e?.name === 'NotFoundError' ? 'Nie znaleziono kamerki' : 'Brak dostępu do kamerki') })
    return () => { cancelled = true; media?.getTracks().forEach(t => t.stop()) }
  }, [deviceId, audio])

  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume / 100)) }, [volume])

  if (error) return <div className="tube-empty">{error}</div>
  return <video ref={ref} className="tube-cam" autoPlay playsInline muted={!audio} />
}

const SpeakerOn = <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
const SpeakerOff = <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>
const Gear = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>

export default function Tube({ tube, left, top, dragging, onMouseDown, onReset, onToggleAudio, onOpenSettings, onFrameChange, framing = false, onFramingDone, visible = true }) {
  const size = TUBE_SIZES[tube.size] || TUBE_SIZES.medium
  const isImage = tube.skin !== 'frame' // 'image' (default); old 'neon' maps here too
  // the 4:3 frame always shows the clean picture: no head mask there
  const mask = isImageSkin(tube) ? { ...DEFAULT_MASK, ...(tube.mask || {}) } : { ...DEFAULT_MASK, on: false }
  // outer box + the screen (where the picture goes) inside it
  const w = isImage ? Math.round(size.ih * SKIN_RATIO) : size.fw
  const h = isImage ? size.ih : Math.round(size.fw * 3 / 4)
  const screen = isImage
    ? { left: Math.round(w * SKIN_GLASS.left), top: Math.round(h * SKIN_GLASS.top),
        width: Math.round(w * (SKIN_GLASS.right - SKIN_GLASS.left)), height: Math.round(h * (SKIN_GLASS.bottom - SKIN_GLASS.top)) }
    : { left: BORDER, top: BORDER, width: w - BORDER * 2, height: h - BORDER * 2 }
  const sw = screen.width, sh = screen.height
  const hasSource = tube.mode === 'camera' || !!tube.stream?.embedUrl
  const stop = (e) => e.stopPropagation()

  // Framing mode (started from "Ustawienia streamerskie"): drag pans the
  // picture, wheel zooms — so the streamer can fit their head in the tube.
  // Live while editing, saved on "Gotowe".
  const [frame, setFrame] = useState(tube.frame || DEFAULT_FRAME)
  useEffect(() => { if (!framing) setFrame(tube.frame || DEFAULT_FRAME) }, [tube.frame, framing])
  const finishFraming = () => { onFrameChange?.(frame); onFramingDone?.() }

  const panStart = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, start = frame
    const move = (ev) => setFrame({ ...start, x: start.x + (ev.clientX - sx) / sw, y: start.y + (ev.clientY - sy) / sh })
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const onWheel = (e) => {
    if (!framing) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
    setFrame(f => ({ ...f, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, f.zoom * factor)) }))
  }

  const contentStyle = {
    position: 'absolute',
    inset: 0,
    transform: `translate(${frame.x * sw}px, ${frame.y * sh}px) scale(${frame.zoom})`,
    transformOrigin: 'center center',
  }

  return (
    <div
      className={`tube ${isImage ? 'skin-image' : 'skin-frame'} ${visible ? 'shown' : ''} ${dragging ? 'dragging' : ''} ${framing ? 'framing' : ''}`}
      style={{ left, top, width: w, height: h }}
      onMouseDown={framing ? panStart : onMouseDown}
      onWheel={onWheel}
      onContextMenu={framing ? (e) => e.preventDefault() : onReset}
      title={framing ? 'Przeciągnij obraz · kółko myszy = przybliż / oddal' : 'Przeciągnij, aby zmienić rozmiary docków · prawy przycisk = równo'}
    >
      {/* inside of the tube: what shows around the masked head, instead of the docks behind */}
      <div className={`tube-backdrop ${isImage ? '' : 'frame'}`} style={screen} />
      {!isImage && <div className="tube-frame-glow" />}
      <div className={isImage ? 'tube-video' : 'tube-screen'} style={{ ...screen, ...(framing ? {} : maskStyle(mask)) }}>
        <div style={contentStyle}>
          {!hasSource && <div className="tube-empty">Ustaw źródło ⚙</div>}
          {hasSource && tube.mode === 'camera' && <TubeCamera deviceId={tube.cameraId} audio={tube.audio} volume={tube.volume} />}
          {hasSource && tube.mode !== 'camera' && <TubeLink stream={tube.stream} audio={tube.audio} volume={tube.volume} w={sw} h={sh} />}
        </div>
      </div>
      {/* while framing the mask is off and its ellipse is drawn as the guide */}
      {framing && mask.on && (
        <div className="tube-frame-guide" style={{
          left: screen.left + sw / 2, top: screen.top + sh * (mask.y / 100),
          width: sw * 2 * (mask.w / 100), height: sh * 2 * (mask.h / 100),
        }} />
      )}
      {isImage && <img className="tube-skin" src={skinUrl} alt="" draggable={false} />}

      {framing ? (
        <div className="tube-framebar" onMouseDown={stop} onContextMenu={stop}>
          <div className="tube-framebar-hint">Przeciągnij obraz<br />kółko = zoom {Math.round(frame.zoom * 100)}%</div>
          <div className="tube-framebar-btns">
            <button className="tube-pill" onClick={() => setFrame(DEFAULT_FRAME)} title="Wyśrodkuj i 100%">Reset</button>
            <button className="tube-pill on" onClick={() => finishFraming()}>Gotowe</button>
          </div>
        </div>
      ) : (
        <div className="tube-controls" onMouseDown={stop} onContextMenu={stop}>
          <button
            className={`tube-btn ${tube.audio ? 'on' : ''}`}
            onClick={onToggleAudio}
            title={tube.audio ? 'Dźwięk tuby włączony — kliknij, aby wyciszyć' : 'Dźwięk tuby wyłączony — kliknij, aby włączyć'}
          >{tube.audio ? SpeakerOn : SpeakerOff}</button>
          <button className="tube-btn" onClick={onOpenSettings} title="Ustawienia streamerskie: źródło, kadrowanie, maska, dźwięk">{Gear}</button>
        </div>
      )}
    </div>
  )
}
