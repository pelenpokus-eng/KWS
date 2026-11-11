import { useState } from 'react'

const FONT_STEPS = [100, 125, 150, 175, 200]

function FontPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
      {FONT_STEPS.map(p => (
        <button
          key={p}
          className={`btn ${value === p ? 'active' : ''}`}
          onClick={() => onChange(p)}
          title={p === 100 ? 'Standardowa wielkość' : `${p / 100}× większa`}
        >
          {p === 100 ? 'Normalna' : `${p}%`}
        </button>
      ))}
    </div>
  )
}

export default function SettingsModal({ chatConfig, onSave, onClose }) {
  const [room, setRoom] = useState(chatConfig.room || 'chatraszei')
  const [customUrl, setCustomUrl] = useState(chatConfig.customUrl || '')
  const [type, setType] = useState(['chatango', 'custom'].includes(chatConfig.type) ? chatConfig.type : (chatConfig.baseType || 'chatango'))
  const [showupMsg, setShowupMsg] = useState('')
  const [fontPct, setFontPct] = useState(chatConfig.fontPct || 100)
  const [kickFontPct, setKickFontPct] = useState(chatConfig.kickFontPct || 100)
  const [twitchFontPct, setTwitchFontPct] = useState(chatConfig.twitchFontPct || 100)

  function handleSave() {
    onSave({ type, room: room.trim(), customUrl: customUrl.trim(), fontPct, kickFontPct, twitchFontPct })
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  const chatangoUrl = room ? `https://${room.trim()}.chatango.com/` : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Ustawienia</h2>

        <div className="modal-label">Typ chatu</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { val: 'chatango', label: 'Chatango' },
            { val: 'custom', label: 'Własny URL' },
          ].map(opt => (
            <button
              key={opt.val}
              className={`btn ${type === opt.val ? 'active' : ''}`}
              onClick={() => setType(opt.val)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {type === 'chatango' && (
          <>
            <div className="modal-label">Nazwa pokoju Chatango</div>
            <input
              className="modal-input"
              type="text"
              placeholder="np. raszei"
              value={room}
              onChange={e => setRoom(e.target.value)}
              onKeyDown={handleKey}
            />
            {room.trim() && (
              <div className="modal-preview" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>URL:</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{chatangoUrl}</span>
              </div>
            )}

            <div className="settings-section">Chatango</div>
            <div className="modal-label">Wielkość czcionki wiadomości</div>
            <FontPicker value={fontPct} onChange={setFontPct} />
          </>
        )}

        <div className="settings-section">Czat Kick</div>
        <div className="modal-label">Wielkość czcionki</div>
        <FontPicker value={kickFontPct} onChange={setKickFontPct} />

        <div className="settings-section">Czat Twitch</div>
        <div className="modal-label">Wielkość czcionki</div>
        <FontPicker value={twitchFontPct} onChange={setTwitchFontPct} />

        <div className="settings-section" />

        {type === 'custom' && (
          <>
            <div className="modal-label">Własny URL chatu (iframe)</div>
            <input
              className="modal-input"
              type="text"
              placeholder="https://..."
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              onKeyDown={handleKey}
            />
          </>
        )}

        <div className="modal-label" style={{ marginTop: 6 }}>Konto ShowUp</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setShowupMsg(''); window.electronAPI?.showupLogin() }}>
            Zaloguj do ShowUp
          </button>
          <button
            className="btn"
            onClick={async () => {
              const n = await window.electronAPI?.showupLogout()
              setShowupMsg(n ? 'Wylogowano.' : 'Nie byłeś zalogowany.')
            }}
          >
            Wyloguj
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {showupMsg || 'Otworzy się okno — zaloguj się i je zamknij. Docki ShowUp przeładują się same.'}
          </span>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Anuluj</button>
          <button className="btn active" onClick={handleSave}>Zapisz</button>
        </div>
      </div>
    </div>
  )
}
