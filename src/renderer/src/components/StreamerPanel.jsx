import { useEffect, useState } from 'react'
import { parseStreamUrl, getPlatformMeta } from '../utils/streamParser'
import { TUBE_SIZES, DEFAULT_FRAME, DEFAULT_MASK } from './Tube'

const SIZE_LABEL = { small: 'Mała', medium: 'Średnia', large: 'Duża' }

// "Ustawienia streamerskie": everything about the tube (5th stream) in a
// panel under the toolbar that does not cover the tube, so every change —
// framing above all — is visible on the tube right away.
export default function StreamerPanel({ tube, onChange, onStartFraming, onClose }) {
  const [link, setLink] = useState(tube.stream?.originalUrl || tube.stream?.embedUrl || '')
  const [cameras, setCameras] = useState([])
  const [camError, setCamError] = useState('')
  const parsed = link.trim() ? parseStreamUrl(link) : null
  const frame = tube.frame || DEFAULT_FRAME
  const setFrame = (patch) => onChange({ frame: { ...frame, ...patch } })
  const mask = { ...DEFAULT_MASK, ...(tube.mask || {}) }
  const setMask = (patch) => onChange({ mask: { ...mask, ...patch } })

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // camera names are visible only after access was granted once
  useEffect(() => {
    if (tube.mode !== 'camera') return
    let cancelled = false
    const list = () => navigator.mediaDevices.enumerateDevices()
      .then(ds => { if (!cancelled) setCameras(ds.filter(d => d.kind === 'videoinput')) })
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then(s => { s.getTracks().forEach(t => t.stop()); if (!cancelled) setCamError('') })
      .catch(() => { if (!cancelled) setCamError('Brak dostępu do kamerki albo żadna nie jest podłączona.') })
      .finally(list)
    return () => { cancelled = true }
  }, [tube.mode])

  const applyLink = () => {
    if (!parsed) return
    onChange({ stream: { platform: parsed.platform, id: parsed.id, label: parsed.label, originalUrl: parsed.originalUrl, embedUrl: parsed.embedUrl } })
  }
  const linkApplied = parsed && tube.stream?.embedUrl === parsed.embedUrl

  return (
    <>
      <div className="sp-shield" onMouseDown={onClose} />
      <div className="sp-panel">
        <div className="sp-head">
          <span>Ustawienia streamerskie</span>
          <button className="sp-x" onClick={onClose} title="Zamknij (Esc)">✕</button>
        </div>

        <div className="sp-section">Tuba — 5. stream</div>
        <div className="sp-row">
          <button className={`btn ${tube.enabled ? 'active' : ''}`} onClick={() => onChange({ enabled: !tube.enabled })}>
            {tube.enabled ? 'Włączona' : 'Wyłączona'}
          </button>
          <span className="sp-note">na środku siatki (widok 4 docków)</span>
        </div>

        <div className="sp-label">Źródło obrazu</div>
        <div className="sp-row">
          <button className={`btn ${tube.mode !== 'camera' ? 'active' : ''}`} onClick={() => onChange({ mode: 'link' })}>Link do streamu</button>
          <button className={`btn ${tube.mode === 'camera' ? 'active' : ''}`} onClick={() => onChange({ mode: 'camera' })}>Kamerka z komputera</button>
        </div>
        {tube.mode !== 'camera' ? (
          <>
            <div className="sp-row">
              <input
                className="modal-input"
                style={{ marginBottom: 0 }}
                value={link}
                onChange={e => setLink(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyLink() }}
                placeholder="kick.com/nick, twitch.tv/nick, youtube.com/watch?v=…"
              />
              <button className="btn active" onClick={applyLink} disabled={!parsed || linkApplied}>{linkApplied ? 'Ustawiony' : 'Ustaw'}</button>
            </div>
            {parsed && <div className="sp-note" style={{ color: getPlatformMeta(parsed.platform).color }}>■ {getPlatformMeta(parsed.platform).name} — {parsed.label}</div>}
            {link.trim() && !parsed && <div className="modal-error">Nie rozpoznaję tego linku</div>}
          </>
        ) : camError ? (
          <div className="modal-error">{camError}</div>
        ) : (
          <select className="modal-input" value={tube.cameraId || ''} onChange={e => onChange({ cameraId: e.target.value })}>
            <option value="">Domyślna kamerka</option>
            {cameras.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `Kamerka ${i + 1}`}</option>)}
          </select>
        )}

        <div className="sp-label">Rozmiar tuby</div>
        <div className="sp-row">
          {Object.keys(TUBE_SIZES).map(k => (
            <button key={k} className={`btn ${tube.size === k ? 'active' : ''}`} onClick={() => onChange({ size: k })}>{SIZE_LABEL[k]}</button>
          ))}
        </div>

        <div className="sp-label">Wygląd tuby</div>
        <div className="sp-row">
          <button className={`btn ${tube.skin !== 'frame' ? 'active' : ''}`} onClick={() => onChange({ skin: 'image' })}>Grafika tuby</button>
          <button className={`btn ${tube.skin === 'frame' ? 'active' : ''}`} onClick={() => onChange({ skin: 'frame' })}>Ramka 4:3</button>
        </div>

        <div className="sp-section">Kadrowanie — dopasuj głowę do tuby</div>
        <Slider label="Przybliżenie" min={50} max={400} value={Math.round(frame.zoom * 100)} unit="%" onChange={v => setFrame({ zoom: v / 100 })} />
        <Slider label="Poziomo" min={-100} max={100} value={Math.round(frame.x * 100)} onChange={v => setFrame({ x: v / 100 })} />
        <Slider label="Pionowo" min={-100} max={100} value={Math.round(frame.y * 100)} onChange={v => setFrame({ y: v / 100 })} />
        <div className="sp-row">
          <button className="btn" onClick={() => onChange({ frame: DEFAULT_FRAME })}>Reset kadru</button>
          <button className="btn" onClick={onStartFraming} disabled={!tube.enabled} title="Przeciągasz obraz w tubie myszą, kółko = zoom">Kadruj myszą na tubie</button>
        </div>

        {/* the 4:3 frame always shows the clean picture — the mask is for the tube graphic */}
        {tube.skin !== 'frame' && <>
        <div className="sp-section">Maska głowy — otoczenie znika</div>
        <div className="sp-row">
          <button className={`btn ${mask.on ? 'active' : ''}`} onClick={() => setMask({ on: !mask.on })}>{mask.on ? 'Włączona' : 'Wyłączona'}</button>
          <button className="btn" onClick={() => onChange({ mask: DEFAULT_MASK })}>Domyślna</button>
        </div>
        {mask.on && (
          <>
            <Slider label="Szerokość" min={15} max={80} value={mask.w} unit="%" onChange={v => setMask({ w: v })} />
            <Slider label="Wysokość" min={10} max={70} value={mask.h} unit="%" onChange={v => setMask({ h: v })} />
            <Slider label="Położenie" min={15} max={85} value={mask.y} unit="%" onChange={v => setMask({ y: v })} />
            <Slider label="Miękkość" min={5} max={90} value={mask.soft} unit="%" onChange={v => setMask({ soft: v })} />
          </>
        )}
        <div className="sp-note">Elipsa z miękkim brzegiem wokół głowy — tło stanowiska poza nią zanika. Głowę w elipsę wstawiasz kadrowaniem.</div>
        </>}

        <div className="sp-section">Dźwięk tuby</div>
        <div className="sp-row">
          <button className={`btn ${tube.audio ? 'active' : ''}`} onClick={() => onChange({ audio: !tube.audio })}>{tube.audio ? 'Włączony' : 'Wyłączony'}</button>
          <input type="range" min={0} max={100} value={tube.volume ?? 100} disabled={!tube.audio} onChange={e => onChange({ volume: Number(e.target.value) })} style={{ flex: 1 }} />
          <span className="sp-val">{tube.volume ?? 100}%</span>
        </div>
        <div className="sp-note">
          Niezależny od Solo/Multi i „Wycisz wszystko”.
          {tube.mode === 'camera' && ' Przy kamerce to mikrofon — przy głośnikach może dawać echo, lepiej słuchawki.'}
        </div>
      </div>
    </>
  )
}

function Slider({ label, min, max, value, unit = '', onChange }) {
  return (
    <div className="sp-slider">
      <span className="sp-slider-label">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} />
      <span className="sp-val">{value}{unit}</span>
    </div>
  )
}
