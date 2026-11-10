import { useState, useRef, useEffect } from 'react'
import { parseStreamUrl, getPlatformMeta, streamKey } from '../utils/streamParser'

// Anything with a dot, slash or colon is treated as a URL; plain words are a nickname search.
function looksLikeUrl(val) {
  return /[./:]/.test(val)
}

const CHANNEL_HOST = { twitch: 'twitch.tv', kick: 'kick.com', showup: 'showup.tv' }

function formatViewers(n) {
  if (n == null) return ''
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

export default function AddStreamModal({ dockIndex, streamHistory = [], favorites = [], onAction, onAdd, onClose }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedFor, setSearchedFor] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const searchSeq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const query = url.trim()
  const isSearch = query.length > 0 && !looksLikeUrl(query)

  // Debounced nickname search across Twitch + Kick
  useEffect(() => {
    if (!isSearch || query.length < 2) {
      searchSeq.current++
      setResults([])
      setSearching(false)
      setSearchedFor('')
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      let res = { twitch: [], kick: [] }
      try { res = await window.electronAPI.searchChannels(query) } catch {}
      if (seq !== searchSeq.current) return // stale response
      // Live channels first, then by viewers; keep platform interleaving stable
      const merged = [...(res?.twitch || []), ...(res?.kick || [])]
        .map((c, i) => ({ ...c, _i: i }))
        .sort((a, b) =>
          (b.live - a.live) ||
          ((b.viewers ?? -1) - (a.viewers ?? -1)) ||
          (a._i - b._i))
      setResults(merged)
      setActiveIdx(0)
      setSearching(false)
      setSearchedFor(query)
    }, 300)
    return () => clearTimeout(t)
  }, [query, isSearch])

  function handleUrlChange(e) {
    const val = e.target.value
    setUrl(val)
    setError('')
    const v = val.trim()
    if (v && looksLikeUrl(v)) {
      const parsed = parseStreamUrl(v)
      setPreview(parsed || null)
      if (parsed && !label) setLabel(parsed.label)
    } else {
      setPreview(null)
    }
  }

  function addChannel(platform, login, displayName) {
    const parsed = parseStreamUrl(`https://${CHANNEL_HOST[platform]}/${login}`)
    if (!parsed) return
    const defaultLabel = `${getPlatformMeta(platform).name}: ${displayName || login}`
    onAdd({ ...parsed, label: label.trim() || defaultLabel })
  }

  // Fallback picks when search finds nothing (or the network is down)
  const nickSlug = query.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const directPicks = isSearch && nickSlug
    ? [
        { platform: 'twitch', login: nickSlug.replace(/-/g, '_'), displayName: query, direct: true },
        { platform: 'kick', login: nickSlug, displayName: query, direct: true },
      ]
    : []
  // ShowUp has no public search — always offer the exact nick as a direct pick
  const showupPick = isSearch && nickSlug
    ? { platform: 'showup', login: nickSlug, displayName: query, direct: true }
    : null
  const shownResults = results.length
    ? [...results, ...(showupPick ? [showupPick] : [])]
    : (searching ? [] : [...directPicks, ...(showupPick ? [showupPick] : [])])

  function handleAdd() {
    if (isSearch) {
      const pick = shownResults[activeIdx]
      if (pick) addChannel(pick.platform, pick.login, pick.displayName)
      return
    }
    const parsed = parseStreamUrl(query)
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

  function handleSearchKey(e) {
    if (isSearch && shownResults.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => (i + 1) % shownResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => (i - 1 + shownResults.length) % shownResults.length)
        return
      }
    }
    handleKey(e)
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

  const favKeys = new Set(favorites.map(streamKey))
  const historyShown = streamHistory.filter(h => !favKeys.has(streamKey(h)))

  function renderQuickPick(item, isFav) {
    const m = getPlatformMeta(item.platform)
    return (
      <div key={streamKey(item)} className="history-row">
        <button
          className="history-item"
          onClick={() => handleHistoryPick(item)}
          title={item.originalUrl}
        >
          <span className="history-dot" style={{ color: m.color }}>■</span>
          <span className="history-platform" style={{ color: m.color }}>{m.name}</span>
          <span className="history-label">{item.label}</span>
        </button>
        {isFav ? (
          <button
            className="history-action fav"
            onClick={() => onAction?.('toggleFavorite', dockIndex, item)}
            title="Usuń z ulubionych"
          >★</button>
        ) : (
          <>
            <button
              className="history-action star"
              onClick={() => onAction?.('toggleFavorite', dockIndex, item)}
              title="Dodaj do ulubionych"
            >☆</button>
            <button
              className="history-action del"
              onClick={() => onAction?.('removeHistory', dockIndex, item)}
              title="Usuń z historii"
            >✕</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Dock #{dockIndex + 1} — Wybierz stream</h2>

        {/* Favorites + stream history quick-pick */}
        {!isSearch && favorites.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="modal-label">★ Ulubione</div>
            <div className="history-list">
              {favorites.map(item => renderQuickPick(item, true))}
            </div>
          </div>
        )}

        {!isSearch && historyShown.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div className="modal-label">Ostatnie streamy</div>
            <div className="history-list">
              {historyShown.map(item => renderQuickPick(item, false))}
            </div>
          </div>
        )}

        <div className="modal-label">Wpisz nick twórcy lub wklej URL</div>
        <input
          ref={inputRef}
          className="modal-input"
          type="text"
          placeholder="np. raszei  —  lub https://twitch.tv/kanal, kick.com/kanal, showup.tv/kanal ..."
          value={url}
          onChange={handleUrlChange}
          onKeyDown={handleSearchKey}
        />

        {isSearch && (
          <div className="search-results">
            {query.length < 2 && <div className="search-status">Wpisz co najmniej 2 znaki…</div>}
            {searching && <div className="search-status">Szukam na Twitchu i Kicku…</div>}
            {!searching && query.length >= 2 && !results.length && searchedFor === query && (
              <div className="search-status">Nic nie znaleziono na Twitchu/Kicku — możesz dodać kanał bezpośrednio:</div>
            )}
            {shownResults.map((c, i) => {
              const m = getPlatformMeta(c.platform)
              return (
                <button
                  key={`${c.platform}:${c.login}:${c.direct ? 'd' : 'r'}`}
                  className={`search-item ${i === activeIdx ? 'active' : ''}`}
                  onClick={() => addChannel(c.platform, c.login, c.displayName)}
                  onMouseEnter={() => setActiveIdx(i)}
                  title={`${m.name}: ${c.login}`}
                >
                  {c.avatar
                    ? <img className="search-avatar" src={c.avatar} alt="" />
                    : <span className="search-avatar search-avatar-ph" style={{ color: m.color }}>■</span>}
                  <span className="search-main">
                    <span className="search-name">{c.displayName}</span>
                    <span className="search-sub">
                      {c.direct ? `${CHANNEL_HOST[c.platform]}/${c.login}` : (c.category || c.login)}
                    </span>
                  </span>
                  {c.live && (
                    <span className="search-live">
                      ● LIVE{c.viewers != null ? ` · ${formatViewers(c.viewers)}` : ''}
                    </span>
                  )}
                  <span className="search-platform" style={{ color: m.color, borderColor: m.color }}>{m.name}</span>
                </button>
              )
            })}
          </div>
        )}

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
          <button
            className="btn active"
            onClick={handleAdd}
            disabled={!query || (isSearch && !shownResults[activeIdx])}
          >
            Dodaj stream
          </button>
        </div>
      </div>
    </div>
  )
}
