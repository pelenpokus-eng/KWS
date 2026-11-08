import { useState } from 'react'

export default function SettingsModal({ chatConfig, onSave, onClose }) {
  const [room, setRoom] = useState(chatConfig.room || 'raszei')
  const [customUrl, setCustomUrl] = useState(chatConfig.customUrl || '')
  const [type, setType] = useState(chatConfig.type || 'chatango')

  function handleSave() {
    onSave({ type, room: room.trim(), customUrl: customUrl.trim() })
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  const chatangoUrl = room ? `https://${room.trim()}.chatango.com/` : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Ustawienia chatu</h2>

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
          </>
        )}

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

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Anuluj</button>
          <button className="btn active" onClick={handleSave}>Zapisz</button>
        </div>
      </div>
    </div>
  )
}
