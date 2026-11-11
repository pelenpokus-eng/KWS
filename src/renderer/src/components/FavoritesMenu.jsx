import { useEffect, useRef, useState } from 'react'
import { parseStreamUrl, getPlatformMeta, streamKey } from '../utils/streamParser'

// Link the user edits: the original URL, or one rebuilt from platform + id
function linkOf(f) {
  if (f.originalUrl) return f.originalUrl
  if (f.platform === 'twitch') return `https://twitch.tv/${f.id}`
  if (f.platform === 'kick') return `https://kick.com/${f.id}`
  if (f.platform === 'youtube') return `https://youtu.be/${f.id}`
  return f.embedUrl || ''
}

// "kick.com/x", "https://...", or a bare nick (taken as the same platform as before)
function parseEdited(raw, prev) {
  const v = raw.trim()
  if (!v) return null
  if (!/[./:]/.test(v)) {
    const nick = v.replace(/^@/, '')
    if (prev.platform === 'twitch') return parseStreamUrl(`https://twitch.tv/${nick}`)
    if (prev.platform === 'kick') return parseStreamUrl(`https://kick.com/${nick}`)
    if (prev.platform === 'showup') return parseStreamUrl(`https://showup.tv/${nick}`)
    return null
  }
  return parseStreamUrl(v)
}

function FavoriteEditor({ fav, onSave, onCancel }) {
  const [label, setLabel] = useState(fav.label || '')
  const [link, setLink] = useState(linkOf(fav))
  const [error, setError] = useState('')
  const labelRef = useRef(null)
  useEffect(() => { labelRef.current?.focus(); labelRef.current?.select() }, [])

  const save = () => {
    const linkChanged = link.trim() !== linkOf(fav)
    let next = fav
    if (linkChanged) {
      const parsed = parseEdited(link, fav)
      if (!parsed || parsed.platform === 'custom' && !/^https?:\/\//.test(link.trim())) {
        setError('Nie rozpoznaję tego linku — wklej pełny adres streamu albo nick')
        return
      }
      next = { embedUrl: parsed.embedUrl, platform: parsed.platform, id: parsed.id, originalUrl: parsed.originalUrl, label: parsed.label }
    }
    onSave({ ...next, label: label.trim() || next.label })
  }

  const onKey = (e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
  }

  return (
    <div className="fav-editor" onKeyDown={onKey}>
      <label className="fav-editor-label">Nazwa</label>
      <input ref={labelRef} className="modal-input" value={label} onChange={e => setLabel(e.target.value)} />
      <label className="fav-editor-label">Link albo nick</label>
      <input
        className="modal-input"
        value={link}
        onChange={e => { setLink(e.target.value); setError('') }}
        placeholder="np. kick.com/nick, twitch.tv/nick, youtube.com/watch?v=…"
      />
      {error && <div className="modal-error">{error}</div>}
      <div className="fav-editor-actions">
        <button className="btn" onClick={onCancel}>Anuluj</button>
        <button className="btn active" onClick={save}>Zapisz</button>
      </div>
    </div>
  )
}

// Toolbar dropdown: pick a favourite and send it to a dock; edit / remove it
export default function FavoritesMenu({ favorites = [], docks = [], onDockAction }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null) // streamKey being edited

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => { if (!open) setEditing(null) }, [open])

  const dockKeys = docks.map(d => (d?.embedUrl ? streamKey(d) : null))

  return (
    <div className="fav-menu-wrap">
      <button
        className={`btn ${open ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Ulubione streamy — wybierz i wyślij do docka"
      >
        ★ Ulubione{favorites.length ? ` (${favorites.length})` : ''}
      </button>

      {open && (
        <>
          {/* catches clicks outside — webviews would swallow them otherwise */}
          <div className="fav-menu-shield" onMouseDown={() => setOpen(false)} />
          <div className="fav-menu">
            {favorites.length === 0 && (
              <div className="fav-empty">
                Brak ulubionych. Dodaj stream gwiazdką ☆ w docku albo w oknie wyboru streamu.
              </div>
            )}
            {favorites.map(f => {
              const key = streamKey(f)
              const m = getPlatformMeta(f.platform)
              if (editing === key) {
                return (
                  <div key={key} className="fav-row editing">
                    <FavoriteEditor
                      fav={f}
                      onCancel={() => setEditing(null)}
                      onSave={next => { onDockAction('updateFavorite', null, { oldKey: key, fav: next }); setEditing(null) }}
                    />
                  </div>
                )
              }
              return (
                <div key={key} className="fav-row">
                  <span className="fav-name" title={linkOf(f)}>
                    <span className="history-dot" style={{ color: m.color }}>■</span>
                    <span className="fav-platform" style={{ color: m.color }}>{m.name}</span>
                    <span className="fav-label">{f.label}</span>
                  </span>
                  <span className="fav-docks">
                    {[0, 1, 2, 3].map(i => {
                      const here = dockKeys[i] === key
                      return (
                        <button
                          key={i}
                          className={`btn fav-dock-btn ${here ? 'here' : ''}`}
                          title={here ? `Już gra w docku ${i + 1}` : docks[i]?.embedUrl ? `Do docka ${i + 1} (zastąpi: ${docks[i].label})` : `Do docka ${i + 1} (pusty)`}
                          onClick={() => { onDockAction('openFavorite', i, f); setOpen(false) }}
                        >
                          {i + 1}
                        </button>
                      )
                    })}
                  </span>
                  <button className="history-action" title="Edytuj" onClick={() => setEditing(key)}>✎</button>
                  <button className="history-action del" title="Usuń z ulubionych" onClick={() => onDockAction('toggleFavorite', null, f)}>✕</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
