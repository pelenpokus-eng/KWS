import { useState, useRef, useEffect } from 'react'
import { parseStreamUrl, getPlatformMeta } from '../utils/streamParser'

export default function AddStreamModal({ dockIndex, streamHistory = [], onAdd, onClose }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleUrlChange(e) {
    const val = e.target.value
    setUrl(val)
    setError('')
    if (val.trim()) {
      const parsed = parseStreamUrl(val.trim())
      if (parsed) {
        setPreview(parsed)
        if (!label) setLabel(parsed.label)
      } else {
        setPreview(null)
      }
    } else {
      setPreview(null)
    }
  }

  function handleAdd() {
    const parsed = parseStreamUrl(url.trim())
    if (!parsed) {
      setError('Nieobsługiwany URL. Wspierane: Twitch, YouTube, Kick lub dowolny URL.')
      return
    }
    onAdd({ ...parsed, label: label.trim() || parsed.label })
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') onClose()
  }

  function handleHistoryPick(item) {
    // Re-parse to get latest embed URL format
    if (item.originalUrl) {
      const fresh = parseStreamUrl(item.originalUrl)
      if (fresh) { onAdd({ ...fresh, label: item.label }); return }
    }
    onAdd(item)
  }

  const meta = preview ? getPlatformMeta(preview.platform) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Dock #{dockIndex + 1} — Wybierz stream</h2>

        {/* Stream history quick-pick */}
        {streamHistory.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div className="modal-label">Ostatnie streamy</div>
            <div className="history-list">
              {streamHistory.map((item, i) => {
                const m = getPlatformMeta(item.platform)
                return (
                  <button
                    key={i}
                    className="history-item"
                    onClick={() => handleHistoryPick(item)}
                    title={item.originalUrl}
                  >
                    <span className="history-dot" style={{ color: m.color }}>■</span>
                    <span className="history-platform" style={{ color: m.color }}>{m.name}</span>
                    <span className="history-label">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="modal-label">Lub wklej nowy URL</div>
        <input
          ref={inputRef}
          className="modal-input"
          type="text"
          placeholder="https://twitch.tv/kanal lub kick.com/kanal ..."
          value={url}
          onChange={handleUrlChange}
          onKeyDown={handleKey}
        />

        {preview && (
          <div className="modal-preview">
            <span style={{ color: meta?.color, fontSize: 10 }}>■</span>
            <strong style={{ color: meta?.color }}>{meta?.name}</strong>
            <span style={{ color: 'var(--text-2)' }}>{preview.id}</span>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-label">Etykieta (opcjonalnie)</div>
        <input
          className="modal-input"
          type="text"
          placeholder="np. Raszei – Kick"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={handleKey}
        />

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Anuluj</button>
          <button className="btn active" onClick={handleAdd} disabled={!url.trim()}>
            Dodaj stream
          </button>
        </div>
      </div>
    </div>
  )
}
