import { useRef, useState, useLayoutEffect, useCallback, useEffect } from 'react'
import { useCaptionLog, clearCaptionLog, useCapPrefs, CAP_LANGS } from '../utils/captionLog'

// "Tłumaczenie" panel (left of the chats): the live captions as a stack,
// read from the bottom — 1) the sentence being spoken now (words appear as
// they're said), 2) above it the previous sentence in its full, final
// translation, 3) higher up the earlier ones (scroll up to read back).

const hhmmss = (t) => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function TranslationPanel({ width, onWidthChange }) {
  const { entries, partials } = useCaptionLog()
  const [prefs, setPrefs] = useCapPrefs()
  const listRef = useRef(null)
  const stickRef = useRef(true) // follow the newest line unless the user scrolled up
  const [following, setFollowing] = useState(true)

  // several docks with CC → say which one each line comes from
  const manyDocks = new Set([...entries.slice(-50).map(e => e.key), ...partials.map(p => p.key)]).size > 1

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stickRef.current = atBottom
    setFollowing(atBottom)
  }
  const toBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setFollowing(true)
  }
  useLayoutEffect(() => {
    if (stickRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  })

  // resizing by the left edge (like the chat panel)
  const [resizing, setResizing] = useState(false)
  const startX = useRef(0), startW = useRef(width)
  const onMove = useCallback((e) => onWidthChange(Math.max(220, Math.min(700, startW.current - (e.clientX - startX.current)))), [onWidthChange])
  useEffect(() => {
    if (!resizing) return
    const up = () => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up) }
  }, [resizing, onMove])

  const lastUid = entries.length ? entries[entries.length - 1].uid : null
  // Polish only — the original would just make the stack taller
  const shownText = (e) => e.pl || e.draft || null

  return (
    <div className="trans-panel" style={{ width }}>
      <div
        className={`chat-resize-handle ${resizing ? 'dragging' : ''}`}
        onMouseDown={e => { startX.current = e.clientX; startW.current = width; setResizing(true); e.preventDefault() }}
      />
      <div className="trans-head">
        <span className="trans-title">Tłumaczenie</span>
        <div className="trans-opts">
          {CAP_LANGS.map(([k, label]) => (
            <button key={k} className={prefs.lang === k ? 'on' : ''} onClick={() => setPrefs({ lang: k })}
              title={k === 'auto' ? 'Język mowy wykrywany sam (też surżyk)' : `Mowa zawsze jako ${k === 'ru' ? 'rosyjski' : 'ukraiński'}`}>{label}</button>
          ))}
          <button className="trans-clear" onClick={clearCaptionLog} title="Wyczyść historię tłumaczenia" disabled={!entries.length}>🗑</button>
        </div>
      </div>

      <div className="trans-list" ref={listRef} onScroll={onScroll}>
        {!entries.length && !partials.length && (
          <div className="trans-empty">Włącz <b>CC</b> w docku — przetłumaczone zdania będą się tu układać od dołu: na samym dole zdanie, które właśnie pada, wyżej poprzednie.</div>
        )}
        {entries.map(e => {
          const text = shownText(e)
          if (!text) return null
          return (
            <div key={e.uid} className={`trans-row ${e.uid === lastUid ? 'last' : ''}`}>
              <div className="trans-meta">
                <span>{hhmmss(e.t)}</span>
                {manyDocks && e.label && <span className="trans-dock">{e.label}</span>}
              </div>
              <div className={`trans-pl ${e.pl ? '' : 'pending'}`}>{text}</div>
            </div>
          )
        })}
        {partials.filter(p => p.pl).map(p => (
          <div key={'live-' + p.key} className="trans-row live">
            <div className="trans-meta">
              <span className="trans-live-dot" />teraz
              {manyDocks && p.label && <span className="trans-dock">{p.label}</span>}
            </div>
            <div className="trans-pl pending">{p.pl}</div>
          </div>
        ))}
      </div>

      {!following && (
        <button className="trans-follow" onClick={toBottom}>↓ Najnowsze</button>
      )}
      {resizing && <div className="chat-drag-shield" style={{ cursor: 'col-resize' }} />}
    </div>
  )
}
