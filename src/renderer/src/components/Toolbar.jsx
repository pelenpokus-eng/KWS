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
  dualChat,
  onDualChatChange,
}) {
  return (
    <div className="toolbar">
      <span className="toolbar-logo">⚡ KWS</span>
      <span className="toolbar-sep" />

      <div className="toolbar-group" title="Układ docków ze streamami">
        <span className="toolbar-group-label">Docki</span>
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
      </div>

      <div className="toolbar-group" title="Sterowanie dźwiękiem streamów">
        <span className="toolbar-group-label">Dźwięk</span>
        <div className="layout-toggle">
          <button
            className={`btn ${!multiAudio ? 'active' : ''}`}
            onClick={() => multiAudio && onToggleMultiAudio()}
            title="Solo — dźwięk tylko z aktywnego streama"
          >
            Solo
          </button>
          <button
            className={`btn ${multiAudio ? 'active' : ''}`}
            onClick={() => !multiAudio && onToggleMultiAudio()}
            title="Multi — dźwięk ze wszystkich streamów"
          >
            Multi
          </button>
        </div>

        <button
          className={`btn ${muteAll ? 'active' : ''}`}
          onClick={onToggleMuteAll}
          title={muteAll ? 'Przywróć dźwięk' : 'Wycisz wszystkie streamy'}
        >
          🔇 Wycisz wszystko
        </button>
      </div>

      <div className="toolbar-group" title="Panel czatu: jeden czat albo dwa obok siebie">
        <span className="toolbar-group-label">Czat</span>
        <div className="layout-toggle">
          <button
            className={`btn ${!dualChat ? 'active' : ''}`}
            onClick={() => dualChat && onDualChatChange(false)}
            title="Jeden czat"
          >
            ▭ 1 czat
          </button>
          <button
            className={`btn ${dualChat ? 'active' : ''}`}
            onClick={() => !dualChat && onDualChatChange(true)}
            title="Dwa czaty — w każdym wybierasz źródło osobno"
          >
            ⊟ 2 czaty
          </button>
        </div>
      </div>

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
