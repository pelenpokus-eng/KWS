import StreamDock from './StreamDock'

export default function DockGrid({ docks, layout, activeAudioDock, multiAudio, enabledDocks, muteAll, nativeMuted, streamHistory, favorites, onDockAction }) {
  const dockProps = (dock, i) => ({
    dock,
    dockIndex: i,
    hasAudio: multiAudio ? (enabledDocks?.has(i) ?? false) : activeAudioDock === i,
    multiAudio,
    muteAll,
    nativeMuted: nativeMuted?.[i] ?? false,
    streamHistory,
    favorites,
    onAction: onDockAction,
  })

  if (layout === 'single') {
    const idx = activeAudioDock
    return (
      <div className="dock-grid single">
        <StreamDock {...dockProps(docks[idx], idx)} />
      </div>
    )
  }

  return (
    <div className="dock-grid quad">
      {docks.map((dock, i) => (
        <StreamDock key={i} {...dockProps(dock, i)} />
      ))}
    </div>
  )
}
