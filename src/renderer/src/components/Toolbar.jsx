export default function Toolbar({
  layout,
  multiAudio,
  muteAll,
  alwaysOnTop,
  onLayoutChange,
  onToggleMultiAudio,
  onToggleMuteAll,
  onToggleAlwaysOnTop,
  onOpenSettings,
}) {
  return (
    <div className="toolbar">
      <span className="toolbar-logo">⚡ KWS</span>
      <span className="toolbar-sep" />

      <div className="layout-toggle">
        <button
          className={`btn ${layout === 'single' ? 'active' : ''}`}
          onClick={() => onLayoutChange('single')}
          title="Jeden stream"
        >
          ▣ Jeden
        </button>
        <button
          className={`btn ${layout === 'quad' ? 'active' : ''}`}
          onClick={() => onLayoutChange('quad')}
          title="Cztery streamy (2×2)"
        >
          ⊞ Cztery
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="layout-toggle">
        <button
          className={`btn ${!multiAudio ? 'active' : ''}`}
          onClick={() => multiAudio && onToggleMultiAudio()}
          title="Solo — dźwięk tylko z aktywnego streama"
        >
          🔊 Solo
        </button>
        <button
          className={`btn ${multiAudio ? 'active' : ''}`}
          onClick={() => !multiAudio && onToggleMultiAudio()}
          title="Multi — dźwięk ze wszystkich streamów"
        >
          🔊 Multi
        </button>
      </div>

      <button
        className={`btn ${muteAll ? 'active' : ''}`}
        onClick={onToggleMuteAll}
        title={muteAll ? 'Przywróć dźwięk' : 'Wycisz wszystkie streamy'}
      >
        🔇 Mute
      </button>

      <span className="toolbar-spacer" />

      <button
        className={`btn ${alwaysOnTop ? 'active' : ''}`}
        onClick={onToggleAlwaysOnTop}
        title={alwaysOnTop ? 'Wyłącz przypięcie okna' : 'Przypnij okno na wierzchu'}
      >
        📌 {alwaysOnTop ? 'Przypięte' : 'Przypnij'}
      </button>

      <button
        className="btn"
        onClick={onOpenSettings}
        title="Ustawienia: chat, logowanie do ShowUp"
      >
        ⚙ Ustawienia
      </button>
    </div>
  )
}
