import { useState, useEffect } from 'react'
import { FavoritesFile } from './FavoritesMenu'

const FONT_STEPS = [100, 125, 150, 175, 200]
// which groups of the dialog are open — kept while the app runs
let settingsOpenGroups = ['chat']

function FontPicker({ value, onChange }) {
  return (
    <div className="set-fonts">
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

export default function SettingsModal({ chatConfig, autoHideToolbar = false, extProfile = 'main', favorites = [], onDockAction, onSave, onClose }) {
  const [room, setRoom] = useState(chatConfig.room || 'chatraszei')
  const [customUrl, setCustomUrl] = useState(chatConfig.customUrl || '')
  const [type, setType] = useState(['chatango', 'custom'].includes(chatConfig.type) ? chatConfig.type : (chatConfig.baseType || 'chatango'))
  const [showupMsg, setShowupMsg] = useState('')
  const [fontPct, setFontPct] = useState(chatConfig.fontPct || 100)
  const [kickFontPct, setKickFontPct] = useState(chatConfig.kickFontPct || 100)
  const [twitchFontPct, setTwitchFontPct] = useState(chatConfig.twitchFontPct || 100)
  const [hideBar, setHideBar] = useState(!!autoHideToolbar)
  const [extProf, setExtProf] = useState(extProfile)
  // "clear app data": first click arms the button, second does it
  const [clearAsk, setClearAsk] = useState(null) // 'web' | 'all'
  const [clearing, setClearing] = useState(false)
  // YouTube account in KWS (18+ videos in docks)
  const [ytSt, setYtSt] = useState(null)
  const [ytBusy, setYtBusy] = useState(false)
  const [ytMsg, setYtMsg] = useState('')
  useEffect(() => {
    window.electronAPI?.ytLoginStatus?.().then(setYtSt).catch(() => {})
    const off1 = window.electronAPI?.onYtLoginChanged?.(setYtSt)
    const off2 = window.electronAPI?.onYtLoginResult?.((r) => {
      setYtBusy(false)
      setYtMsg(r?.ok ? 'Zalogowano — filmy 18+ zagrają w dockach.' : (r?.error || 'Logowanie nie powiodło się'))
    })
    return () => { off1?.(); off2?.() }
  }, [])

  function handleSave() {
    onSave({ type, room: room.trim(), customUrl: customUrl.trim(), fontPct, kickFontPct, twitchFontPct, autoHideToolbar: hideBar, extProfile: extProf })
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  const chatangoUrl = room ? `https://${room.trim()}.chatango.com/` : ''

  // groups of the dialog: open ones remembered for the session
  const [openGroups, setOpenGroups] = useState(() => new Set(settingsOpenGroups))
  const toggleGroup = (id) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    settingsOpenGroups = [...next]
    return next
  })
  const G = (id, icon, title, summary, body) => (
    <Group id={id} icon={icon} title={title} summary={summary} open={openGroups.has(id)} onToggle={toggleGroup}>{body}</Group>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <h2>Ustawienia</h2>

        {G('look', '🖥', 'Wygląd', hideBar ? 'pasek ukrywany automatycznie' : 'pasek zawsze widoczny', <>
          <div className="modal-label">Górny pasek</div>
          <div className="set-row">
            <button className={`btn ${!hideBar ? 'active' : ''}`} onClick={() => setHideBar(false)}>Zawsze widoczny</button>
            <button className={`btn ${hideBar ? 'active' : ''}`} onClick={() => setHideBar(true)}>Ukrywaj automatycznie</button>
          </div>
          <div className="set-hint">Ukryty pasek daje cały ekran na streamy — wysuwa się, gdy najedziesz kursorem na samą górę okna.</div>
        </>)}

        {G('chat', '💬', 'Czat', type === 'chatango' ? `Chatango · ${room.trim() || '—'}` : 'własny URL', <>
          <div className="modal-label">Typ chatu</div>
          <div className="set-row">
            {[{ val: 'chatango', label: 'Chatango' }, { val: 'custom', label: 'Własny URL' }].map(opt => (
              <button key={opt.val} className={`btn ${type === opt.val ? 'active' : ''}`} onClick={() => setType(opt.val)}>{opt.label}</button>
            ))}
          </div>

          {type === 'chatango' && (
            <>
              <div className="modal-label">Nazwa pokoju Chatango</div>
              <input className="modal-input" type="text" placeholder="np. raszei" value={room}
                onChange={e => setRoom(e.target.value)} onKeyDown={handleKey} />
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
              <input className="modal-input" type="text" placeholder="https://..." value={customUrl}
                onChange={e => setCustomUrl(e.target.value)} onKeyDown={handleKey} />
            </>
          )}

          <div className="set-sub">Wielkość czcionki</div>
          {type === 'chatango' && (
            <div className="set-font-row"><span className="set-font-name">Chatango</span><FontPicker value={fontPct} onChange={setFontPct} /></div>
          )}
          <div className="set-font-row"><span className="set-font-name">Kick</span><FontPicker value={kickFontPct} onChange={setKickFontPct} /></div>
          <div className="set-font-row"><span className="set-font-name">Twitch</span><FontPicker value={twitchFontPct} onChange={setTwitchFontPct} /></div>
        </>)}

        {G('accounts', '👤', 'Konta', `YouTube: ${ytSt == null ? '…' : ytSt.loggedIn ? 'zalogowano' : 'nie zalogowano'}`, <>
          <div className="set-sub" style={{ marginTop: 0 }}>YouTube (filmy 18+ w dockach)</div>
          <div className="set-row">
            <span style={{ fontSize: 12, color: ytSt?.loggedIn ? '#86efac' : 'var(--text-3)' }}>
              {ytSt == null ? '…' : ytSt.loggedIn ? '● Zalogowano' : '○ Nie zalogowano'}
            </span>
            <button className="btn" disabled={ytBusy} onClick={async () => {
              setYtMsg('')
              const r = await window.electronAPI?.ytLogin()
              if (r?.ok) { setYtBusy(true); setYtMsg('Zaloguj się w oknie Chrome i je zamknij — KWS przejmie logowanie.') }
              else setYtMsg(r?.error || 'Nie udało się otworzyć logowania')
            }}>{ytBusy ? 'Czekam na zamknięcie okna…' : ytSt?.loggedIn ? 'Zaloguj ponownie' : 'Zaloguj do YouTube'}</button>
            {ytSt?.loggedIn && (
              <button className="btn" onClick={async () => { setYtMsg('Wylogowuję…'); const r = await window.electronAPI?.ytLogout(); setYtMsg(r?.warning || 'Wylogowano — z KWS i z profilu Chrome KWS. Następne logowanie zacznie się od zera.') }}>Wyloguj</button>
            )}
          </div>
          <div className="set-hint">
            {ytMsg || 'Logowanie odbywa się w oknie Chrome (profil KWS) — Google nie pozwala logować się w samym KWS. Po zamknięciu okna KWS przejmuje logowanie, a filmy z ograniczeniem wiekowym grają w dockach.'}
          </div>

          <div className="set-sub">ShowUp</div>
          <div className="set-row">
            <button className="btn" onClick={() => { setShowupMsg(''); window.electronAPI?.showupLogin() }}>Zaloguj do ShowUp</button>
            <button className="btn" onClick={async () => {
              const n = await window.electronAPI?.showupLogout()
              setShowupMsg(n ? 'Wylogowano.' : 'Nie byłeś zalogowany.')
            }}>Wyloguj</button>
          </div>
          <div className="set-hint">{showupMsg || 'Otworzy się okno — zaloguj się i je zamknij. Docki ShowUp przeładują się same.'}</div>
        </>)}

        {G('chrome', '⧉', 'Chrome w docku', `strumyk.cv · ${extProf === 'kws' ? 'profil KWS' : 'Twój Chrome'}`, <>
          <div className="set-hint" style={{ marginTop: 0 }}>Okno Chrome przyklejone do docka — dla stron, które nie działają w KWS (strumyk.cv).</div>
          <div className="set-row">
            <button className={`btn ${extProf === 'main' ? 'active' : ''}`} onClick={() => setExtProf('main')}>Twój Chrome (zalogowany)</button>
            <button className={`btn ${extProf === 'kws' ? 'active' : ''}`} onClick={() => setExtProf('kws')}>Profil KWS (dźwięk z KWS)</button>
          </div>
          <div className="set-hint">
            {extProf === 'main'
              ? 'Twój zwykły Chrome z Twoim kontem — działa od razu. Głośność ustawiasz w samym playerze (Chrome nie pozwala nim sterować z zewnątrz).'
              : 'Osobny profil Chrome tylko dla KWS — suwak, mute, Solo/Multi i „Wycisz wszystko” sterują jego dźwiękiem, obraz wypełnia dock. Wymaga jednorazowego logowania:'}
          </div>
          {extProf === 'kws' && (
            <div className="set-row">
              <button className="btn" onClick={async () => { const r = await window.electronAPI?.extLogin(); setShowupMsg(r?.ok ? '' : (r?.error || '')) }}>
                Zaloguj do YouTube w profilu KWS
              </button>
            </div>
          )}
        </>)}

        {G('favs', '★', 'Ulubione', `${favorites.length} na liście · eksport / import`, <>
          <FavoritesFile favorites={favorites} onDockAction={onDockAction} />
        </>)}

        {G('data', '🗑', 'Dane aplikacji', 'czyszczenie i reset', <>
          <div className="set-row">
            {[
              { mode: 'web', label: 'Wyczyść dane przeglądania', confirm: 'Na pewno? Wyczyść i uruchom ponownie' },
              { mode: 'all', label: 'Reset całej aplikacji', confirm: 'Na pewno? Usuń wszystko i uruchom ponownie' },
            ].map(b => (
              <button
                key={b.mode}
                className={`btn ${clearAsk === b.mode ? 'danger' : ''}`}
                disabled={clearing}
                onClick={async () => {
                  if (clearAsk !== b.mode) { setClearAsk(b.mode); return }
                  setClearing(true)
                  await window.electronAPI?.clearAppData(b.mode)
                }}
              >{clearing && clearAsk === b.mode ? 'Czyszczę…' : clearAsk === b.mode ? b.confirm : b.label}</button>
            ))}
            {clearAsk && !clearing && <button className="btn" onClick={() => setClearAsk(null)}>Anuluj</button>}
          </div>
          <div className="set-hint">
            {clearAsk === 'all'
              ? 'Usunie docki, ulubione, historię i ustawienia oraz wszystkie logowania — jak świeża instalacja. Najpierw wyeksportuj ulubione do pliku! Nagrania zostają.'
              : clearAsk === 'web'
                ? 'Wyloguje z YouTube, ShowUp i Chatango, usunie ciasteczka, pamięć podręczną stron i profil Chrome KWS. Docki, ulubione i ustawienia zostają. Nagrania zostają.'
                : 'Dane przeglądania: logowania, ciasteczka, pamięć podręczna stron, profil Chrome KWS. Reset: wszystko, łącznie z dockami i ulubionymi. KWS uruchomi się ponownie.'}
          </div>
        </>)}

        <div className="modal-actions settings-actions">
          <button className="btn" onClick={onClose}>Anuluj</button>
          <button className="btn active" onClick={handleSave}>Zapisz</button>
        </div>
      </div>
    </div>
  )
}

// One collapsible group of the Settings dialog
function Group({ id, icon, title, summary, open, onToggle, children }) {
  return (
    <section className={`set-group${open ? ' open' : ''}`}>
      <button className="set-group-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <span className="set-group-icon">{icon}</span>
        <span className="set-group-title">{title}</span>
        {!open && summary && <span className="set-group-summary">{summary}</span>}
        <span className="set-group-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="set-group-body">{children}</div>}
    </section>
  )
}
