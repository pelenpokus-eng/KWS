import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import logoUrl from '../assets/logo.png'
import FavoritesMenu from './FavoritesMenu'

// Line icons (16px, currentColor) — one consistent set instead of emoji
const I = {
  single: <svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>,
  quad: <svg viewBox="0 0 24 24"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>,
  // Solo: one sound wave · Multi: full volume waves
  speaker: <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>,
  speakers: <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>,
  mute: <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>,
  chat1: <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  chat2: <svg viewBox="0 0 24 24"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" /></svg>,
  pin: <svg viewBox="0 0 24 24"><path d="M12 17v5" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" /></svg>,
  expand: <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>,
  collapse: <svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>,
  // cog wheel with teeth
  gear: <svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>,
  tube: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="4.5" rx="5.5" ry="2" /><path d="M6.5 4.5v15c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-15" /><path d="M10 9.5v6" /></svg>,
  broadcast: <svg viewBox="0 0 24 24"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" /></svg>,
  minimize: <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>,
  maximize: <svg viewBox="0 0 24 24"><rect width="16" height="16" x="4" y="4" rx="2" /></svg>,
  restore: <svg viewBox="0 0 24 24"><rect width="12" height="12" x="4" y="8" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>,
}

function Seg({ active, onClick, title, icon, children }) {
  return (
    <button className={`tb-seg ${active ? 'active' : ''}`} onClick={onClick} title={title}>
      <span className="tb-ico">{icon}</span>
      {children != null && <span>{children}</span>}
    </button>
  )
}

// Segmented switch with a sliding pill: the accent fill moves under the
// chosen option (measured from the buttons, animated with CSS transitions).
function Switch({ options, value, onChange }) {
  const wrapRef = useRef(null)
  const [pill, setPill] = useState(null)

  useLayoutEffect(() => {
    const place = () => {
      const btn = wrapRef.current?.querySelector(`[data-key="${value}"]`)
      if (btn) setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    place()
    // fonts / window size can change button widths
    const ro = new ResizeObserver(place)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [value])

  return (
    <div ref={wrapRef} className="tb-switch">
      {pill && <span className="tb-switch-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
      {options.map(o => (
        <button
          key={o.key}
          data-key={o.key}
          className={`tb-switch-opt ${o.key === value ? 'on' : ''}`}
          onClick={() => o.key !== value && onChange(o.key)}
          title={o.title}
        >
          <span className="tb-ico">{o.icon}</span>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function Toolbar({
  layout,
  multiAudio,
  muteAll,
  alwaysOnTop,
  onLayoutChange,
  onToggleMultiAudio,
  onToggleMuteAll,
  onToggleAlwaysOnTop,
  fullScreen,
  onToggleFullScreen,
  onOpenSettings,
  dualChat,
  onDualChatChange,
  favorites,
  docks,
  onDockAction,
  tubeOn,
  onToggleTube,
  onOpenStreamer,
  streamerOpen,
}) {
  // window maximised? (the maximise button shows "restore" then)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    window.electronAPI?.isWindowMaximized?.().then(m => setMaximized(!!m)).catch(() => {})
    return window.electronAPI?.onMaximizedChanged?.(setMaximized)
  }, [])

  return (
    <div className="toolbar">
      <span className="tb-logo">
        <img src={logoUrl} alt="" className="tb-logo-img" draggable={false} />
        <span className="tb-logo-name">KWS</span>
        <span className="tb-logo-sub">Multistream</span>
      </span>

      {/* Layout: 1 vs 4 docks */}
      <div className="tb-pill" title="Układ docków">
        <span className="tb-pill-label">Docki</span>
        <Switch
          value={layout === 'quad' ? 'quad' : 'single'}
          onChange={onLayoutChange}
          options={[
            { key: 'single', label: '1', icon: I.single, title: 'Jeden stream' },
            { key: 'quad', label: '4', icon: I.quad, title: 'Cztery streamy (2×2)' },
          ]}
        />
      </div>

      {/* Streamer dock (5th stream) + its settings, side by side in one capsule */}
      <div className="tb-pill" title="Dock streamerski — 5. stream z kamerką na środku siatki">
        <button
          className={`tb-seg tb-tube ${tubeOn ? 'active' : ''}`}
          onClick={onToggleTube}
          title={tubeOn ? 'Dock streamerski (5. stream) włączony — kliknij, aby schować' : 'Dock streamerski — pokaż 5. stream z kamerką na środku siatki'}
        >
          <span className="tb-ico">{I.tube}</span>
          <span>Dock streamerski</span>
        </button>
        <span className="tb-divider" />
        <button
          className={`tb-seg tb-streamer ${streamerOpen ? 'active' : ''}`}
          onClick={onOpenStreamer}
          title="Ustawienia streamerskie — źródło, kadrowanie, wygląd, dźwięk"
        >
          <span className="tb-ico">{I.broadcast}</span>
          <span>Ustawienia</span>
        </button>
      </div>

      {/* Audio: Solo / Multi + mute all */}
      <div className="tb-pill" title="Dźwięk streamów">
        <span className="tb-pill-label">Dźwięk</span>
        <Switch
          value={multiAudio ? 'multi' : 'solo'}
          onChange={() => onToggleMultiAudio()}
          options={[
            { key: 'solo', label: 'Solo', icon: I.speaker, title: 'Solo — dźwięk tylko z aktywnego streama' },
            { key: 'multi', label: 'Multi', icon: I.speakers, title: 'Multi — dźwięk z wybranych streamów' },
          ]}
        />
        <span className="tb-divider" />
        <button
          className={`tb-seg tb-mute ${muteAll ? 'active' : ''}`}
          onClick={onToggleMuteAll}
          title={muteAll ? 'Przywróć dźwięk' : 'Wycisz wszystkie streamy'}
        >
          <span className="tb-ico">{I.mute}</span>
          {/* fixed label — the red state shows it's on, nothing shifts */}
          <span>Wycisz wszystko</span>
        </button>
      </div>

      {/* Chat panel: one or two chats */}
      <div className="tb-pill" title="Panel czatu">
        <span className="tb-pill-label">Czat</span>
        <Switch
          value={dualChat ? 'two' : 'one'}
          onChange={k => onDualChatChange(k === 'two')}
          options={[
            { key: 'one', label: '1 czat', icon: I.chat1, title: 'Jeden czat' },
            { key: 'two', label: '2 czaty', icon: I.chat2, title: 'Dwa czaty obok siebie — w każdym wybierasz źródło osobno' },
          ]}
        />
      </div>

      <FavoritesMenu favorites={favorites} docks={docks} onDockAction={onDockAction} />

      <span className="toolbar-spacer" />

      {/* Settings: its own round button, before the window group */}
      <button className="tb-round" onClick={onOpenSettings} title="Ustawienia: czat, czcionki, logowanie do ShowUp">
        <span className="tb-ico">{I.gear}</span>
      </button>

      {/* Window tools */}
      <div className="tb-pill">
        <span className="tb-pill-label">Okno</span>
        <Seg
          active={alwaysOnTop}
          onClick={onToggleAlwaysOnTop}
          title={alwaysOnTop ? 'Przypięte na wierzchu — kliknij, aby odpiąć' : 'Przypnij okno na wierzchu'}
          icon={I.pin}
        />
        <span className="tb-divider" />
        <Seg onClick={() => window.electronAPI?.minimizeWindow()} title="Minimalizuj" icon={I.minimize} />
        <Seg
          onClick={() => window.electronAPI?.toggleMaximizeWindow()}
          title={maximized ? 'Przywróć rozmiar okna' : 'Maksymalizuj'}
          icon={maximized ? I.restore : I.maximize}
        />
        <Seg
          active={fullScreen}
          onClick={onToggleFullScreen}
          title={fullScreen ? 'Wyjdź z pełnego ekranu (F11)' : 'Pełny ekran (F11)'}
          icon={fullScreen ? I.collapse : I.expand}
        />
        <button className="tb-seg tb-close" onClick={() => window.electronAPI?.quitApp()} title="Zamknij aplikację">
          <span className="tb-ico">{I.close}</span>
        </button>
      </div>
    </div>
  )
}
