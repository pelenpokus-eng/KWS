import { useEffect, useRef, useState } from 'react'
import StreamDock from './StreamDock'
import Tube from './Tube'

const MIN = 0.15
const MAX = 0.85
const clamp = (v) => Math.max(MIN, Math.min(MAX, v))

// Flexible 2×2 grid: split = { x, y } — where the vertical and horizontal
// lines sit (0..1). The handle where they cross moves both, each line alone
// moves one; right-click (or double-click) goes back to 50/50. The handle is
// hidden until the pointer is over the crossing point.
export default function DockGrid({ docks, layout, activeAudioDock, multiAudio, enabledDocks, muteAll, nativeMuted, streamHistory, favorites, onDockAction, split = { x: 0.5, y: 0.5 }, onSplitChange, tube, onTubeChange, onOpenTubeSettings, tubeFraming, onTubeFramingDone }) {
  const gridRef = useRef(null)
  const [dragging, setDragging] = useState(null) // 'both' | 'x' | 'y'

  // Tube fade in / out: stays mounted while fading out, gets "shown" just
  // after mounting so the opacity transition runs both ways. A timer, not
  // requestAnimationFrame — rAF stops while the window is covered (e.g. by
  // OBS), and the tube would never appear.
  const tubeOn = !!tube?.enabled
  const [tubeMounted, setTubeMounted] = useState(tubeOn)
  const [tubeShown, setTubeShown] = useState(tubeOn)
  useEffect(() => {
    if (tubeOn) {
      setTubeMounted(true)
      const t = setTimeout(() => setTubeShown(true), 30)
      return () => clearTimeout(t)
    }
    setTubeShown(false)
    const t = setTimeout(() => setTubeMounted(false), 450)
    return () => clearTimeout(t)
  }, [tubeOn])

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
        <StreamDock {...dockProps(docks[idx], idx)} single />
      </div>
    )
  }

  const startDrag = (axis) => (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = gridRef.current.getBoundingClientRect()
    // keep the grab offset: grabbing the tube by its edge must not jump the grid
    const offX = e.clientX - (rect.left + rect.width * clamp(split.x))
    const offY = e.clientY - (rect.top + rect.height * clamp(split.y))
    setDragging(axis)
    let frame = 0
    let last = split
    const move = (ev) => {
      const next = {
        x: axis === 'y' ? split.x : clamp((ev.clientX - offX - rect.left) / rect.width),
        y: axis === 'x' ? split.y : clamp((ev.clientY - offY - rect.top) / rect.height),
      }
      last = next
      // one layout update per frame — every move resizes four players
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; onSplitChange?.(last) })
    }
    const up = () => {
      cancelAnimationFrame(frame)
      onSplitChange?.(last)
      setDragging(null)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const reset = (e) => { e.preventDefault(); onSplitChange?.({ x: 0.5, y: 0.5 }) }

  const x = clamp(split.x), y = clamp(split.y)
  // positions match the grid tracks (2px gap between them)
  const left = `calc((100% - 2px) * ${x} + 1px)`
  const top = `calc((100% - 2px) * ${y} + 1px)`

  return (
    <div
      ref={gridRef}
      className="dock-grid quad"
      style={{ gridTemplateColumns: `${x}fr ${1 - x}fr`, gridTemplateRows: `${y}fr ${1 - y}fr` }}
    >
      {docks.map((dock, i) => (
        <StreamDock key={i} {...dockProps(dock, i)} />
      ))}

      <div className={`grid-line grid-line-v ${dragging === 'x' ? 'active' : ''}`} style={{ left }} onMouseDown={startDrag('x')} onContextMenu={reset} title="Przeciągnij, aby zmienić szerokość kolumn · prawy przycisk = równo" />
      <div className={`grid-line grid-line-h ${dragging === 'y' ? 'active' : ''}`} style={{ top }} onMouseDown={startDrag('y')} onContextMenu={reset} title="Przeciągnij, aby zmienić wysokość wierszy · prawy przycisk = równo" />
      {/* 5th stream: the tube sits on the crossing point and is the handle */}
      {tubeMounted && (
        <Tube
          visible={tubeShown}
          tube={tube}
          left={left}
          top={top}
          dragging={dragging === 'both'}
          onMouseDown={startDrag('both')}
          onReset={reset}
          onToggleAudio={() => onTubeChange?.({ audio: !tube.audio })}
          onOpenSettings={onOpenTubeSettings}
          onFrameChange={(frame) => onTubeChange?.({ frame })}
          framing={tubeFraming}
          onFramingDone={onTubeFramingDone}
        />
      )}

      {/* the handle shows only while the pointer is over the crossing point */}
      {!tubeMounted && <div
        className={`grid-handle-zone ${dragging === 'both' ? 'active' : ''}`}
        style={{ left, top }}
        onMouseDown={startDrag('both')}
        onDoubleClick={reset}
        onContextMenu={reset}
        title="Przeciągnij, aby zmienić rozmiary docków · prawy przycisk = równo"
      >
        <div className="grid-handle" />
      </div>}

      {/* players swallow mouse moves — cover them while dragging */}
      {dragging && (
        <div className="grid-drag-shield" style={{ cursor: dragging === 'x' ? 'col-resize' : dragging === 'y' ? 'row-resize' : 'move' }} />
      )}
    </div>
  )
}
