import { useEffect, useState } from 'react'

const fmtSize = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + ' MB'
const fmtDate = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Toolbar "Nagrane": the files in Videos\KWS MultiStream — play, show, delete.
// A red dot pulses on the button while any dock is recording.
export default function RecordingsMenu() {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [active, setActive] = useState(0)

  const refresh = () => window.electronAPI?.recList?.().then(l => setFiles(Array.isArray(l) ? l : [])).catch(() => {})
  useEffect(() => { refresh() }, [])
  useEffect(() => { if (open) refresh() }, [open])
  // a recording started / finished somewhere: update the dot and the list
  useEffect(() => window.electronAPI?.onRecActive?.((n) => { setActive(n); refresh() }), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const remove = async (f) => {
    await window.electronAPI?.recDelete(f.path)
    refresh()
  }

  return (
    <div className="fav-menu-wrap">
      <button
        className={`tb-fav tb-rec ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={active ? `Trwa nagrywanie (${active}) — lista nagrań` : 'Nagrane streamy'}
      >
        <span className={`tb-rec-dot ${active ? 'live' : ''}`} />
        <span>Nagrane</span>
        {files.length > 0 && <span className="tb-badge">{files.length}</span>}
        <svg className="tb-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <>
          <div className="fav-menu-shield" onMouseDown={() => setOpen(false)} />
          <div className="fav-menu rec-menu">
            {files.length === 0 && (
              <div className="fav-empty">Brak nagrań. Nagrywanie włączasz przyciskiem ⏺ na pasku docka (po najechaniu na stream).</div>
            )}
            {files.map(f => (
              <div key={f.path} className="fav-row rec-row" data-copy-name={f.name}>
                <span className="fav-name" title={f.path}>
                  <span className="fav-label">{f.name.replace(/\.webm$/i, '')}</span>
                </span>
                <span className="rec-meta">{fmtDate(f.mtime)} · {fmtSize(f.size)}</span>
                <button className="history-action" title="Odtwórz (domyślny odtwarzacz)" onClick={() => window.electronAPI?.recOpen(f.path)}>▶</button>
                <button className="history-action" title="Pokaż w folderze" onClick={() => window.electronAPI?.showInFolder(f.path)}>📁</button>
                <button className="history-action del" title="Usuń (do Kosza)" onClick={() => remove(f)}>✕</button>
              </div>
            ))}
            <div className="rec-foot">
              <button className="btn" onClick={() => window.electronAPI?.recOpenFolder()}>Otwórz folder nagrań</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
