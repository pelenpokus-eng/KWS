import { useEffect } from 'react'
import { parseStreamUrl } from '../utils/streamParser'

// What a link clicked in the Chatango chat is:
//   stream   - YouTube / Streamable: preview + "to dock N" + browser
//   image    - picture (Chatango uploads ust.chatango.com/.../l_123.jpg too)
//   video    - direct video file
//   external - anything else: straight to the default browser
export function classifyChatUrl(url) {
  let u
  try { u = new URL(url) } catch { return { kind: 'external' } }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'external' }
  const p = parseStreamUrl(url)
  if (p && (p.platform === 'youtube' || p.platform === 'streamable')) return { kind: 'stream', stream: p }
  const path = u.pathname.toLowerCase()
  if (/\.(jpe?g|png|gif|webp|bmp|avif)$/.test(path)) return { kind: 'image' }
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return { kind: 'video' }
  return { kind: 'external' }
}

export default function MediaViewer({ url, docks = [], onOpenInDock, onClose }) {
  const info = classifyChatUrl(url)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openBrowser = () => { window.electronAPI?.openExternal(url); onClose() }
  let host = url
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch {}

  return (
    <div className="media-viewer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="media-viewer">
        <div className="media-viewer-bar">
          <span className="media-viewer-title" title={url}>
            {info.kind === 'stream' ? info.stream.label : host}
          </span>
          {info.kind === 'stream' && (
            <span className="media-viewer-docks">
              <span className="media-viewer-label">Do docka:</span>
              {[0, 1, 2, 3].map(i => (
                <button
                  key={i}
                  className={`btn media-dock-btn ${docks[i]?.embedUrl ? 'taken' : ''}`}
                  title={docks[i]?.embedUrl ? `Dock ${i + 1} — zastąpi: ${docks[i].label}` : `Dock ${i + 1} (pusty)`}
                  onClick={() => { onOpenInDock(i, info.stream); onClose() }}
                >
                  {i + 1}
                </button>
              ))}
            </span>
          )}
          <button className="btn" onClick={openBrowser} title="Otwórz w domyślnej przeglądarce">↗ Przeglądarka</button>
          <button className="btn" onClick={onClose} title="Zamknij (Esc)">✕</button>
        </div>

        <div className="media-viewer-body">
          {info.kind === 'stream' && (
            <iframe
              src={info.stream.embedUrl}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              className="media-viewer-frame"
            />
          )}
          {info.kind === 'image' && <img src={url} alt="" className="media-viewer-img" />}
          {info.kind === 'video' && <video src={url} controls autoPlay className="media-viewer-img" />}
        </div>
      </div>
    </div>
  )
}
