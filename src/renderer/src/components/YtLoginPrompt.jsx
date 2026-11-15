import { useState, useEffect } from 'react'

// "Sign in to YouTube?" popup. A dock asks for it (window event
// 'kws-yt-ask-login') when it hits an age-restricted video and KWS isn't
// signed in. Yes → Chrome sign-in window (KWS profile); once the user closes
// it, main copies the login and the docks start the video by themselves.
export default function YtLoginPrompt() {
  const [ask, setAsk] = useState(null)      // { label } while shown
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onAsk = (e) => {
      const d = e.detail || {}
      setError('')
      setAsk(a => {
        if (a) return a
        // show the video's real title, not the link-made dock name
        if (d.id) {
          window.electronAPI?.streamTitle?.({ platform: d.platform || 'youtube', id: d.id })
            .catch(() => '')
            .then(t => setAsk(cur => (cur && cur.id === d.id
              ? { ...cur, title: t || String(cur.label || cur.id).replace(/^YouTube:\s*/, '') }
              : cur)))
        }
        return { label: d.label || '', id: d.id || '', title: '' }
      })
    }
    window.addEventListener('kws-yt-ask-login', onAsk)
    const off = window.electronAPI?.onYtLoginResult?.((r) => {
      setWaiting(false)
      if (r?.ok) setAsk(null)
      else setError(r?.error || 'Logowanie nie powiodło się')
    })
    return () => { window.removeEventListener('kws-yt-ask-login', onAsk); off?.() }
  }, [])

  if (!ask) return null

  const yes = async () => {
    setError('')
    const r = await window.electronAPI?.ytLogin()
    if (r?.ok) setWaiting(true)
    else setError(r?.error || 'Nie udało się otworzyć logowania')
  }

  return (
    <div className="modal-overlay" onClick={() => !waiting && setAsk(null)}>
      <div className="modal yt-login-prompt" onClick={e => e.stopPropagation()}>
        <h2>🔞 Film z ograniczeniem wiekowym</h2>
        <div className="yt-login-text">
          {(ask.title || ask.label) && (
            <div className="yt-login-video" title={ask.title || ask.label}>
              {ask.title ? `YouTube: ${ask.title}` : (ask.id ? 'YouTube: pobieram tytuł…' : ask.label)}
            </div>
          )}
          {waiting
            ? 'Zaloguj się w oknie Chrome, które się otworzyło, a potem je zamknij — film ruszy sam w docku.'
            : 'YouTube odtworzy ten film tylko po zalogowaniu na konto z potwierdzonym wiekiem. Czy chcesz zalogować się na swoje konto YouTube?'}
        </div>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          {waiting
            ? <button className="btn" onClick={() => { setWaiting(false); setAsk(null) }}>Zamknij</button>
            : <>
                <button className="btn" onClick={() => setAsk(null)}>Nie</button>
                <button className="btn active" onClick={yes}>Tak, zaloguj</button>
              </>}
        </div>
      </div>
    </div>
  )
}
