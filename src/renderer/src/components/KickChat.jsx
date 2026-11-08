import { useEffect, useRef, useState } from 'react'

const PUSHER_KEY = '32cbd69e4b950bf97679'
const PUSHER_WS = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`

export default function KickChat({ channel }) {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('Łączenie...')
  const wsRef = useRef(null)
  const listRef = useRef(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    cancelledRef.current = false
    setMessages([])
    setStatus('Pobieranie danych kanału...')

    let ws = null

    async function init() {
      let chatroomId
      try {
        chatroomId = await window.electronAPI?.getKickChatroomId(channel)
        if (!chatroomId) throw new Error('nie znaleziono kanału')
      } catch (e) {
        if (!cancelledRef.current) setStatus(`Błąd: ${e.message}`)
        return
      }
      if (cancelledRef.current) return

      setStatus('Łączenie z chatem...')
      ws = new WebSocket(PUSHER_WS)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

          if (msg.event === 'pusher:connection_established') {
            ws.send(JSON.stringify({
              event: 'pusher:subscribe',
              data: { auth: '', channel: `chatroom.${chatroomId}.v2` }
            }))
          }

          if (msg.event === 'pusher_internal:subscription_succeeded') {
            if (!cancelledRef.current) setStatus('')
          }

          if (msg.event === 'App\\Events\\ChatMessageEvent') {
            const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
            const sender = data.sender
            const color = sender?.identity?.color || '#aaaaaa'
            const username = sender?.username || '?'
            const content = data.content || ''
            if (!cancelledRef.current) {
              setMessages(prev => [...prev.slice(-300), { id: data.id || Date.now(), username, color, content }])
            }
          }
        } catch {}
      }

      ws.onerror = () => {
        if (!cancelledRef.current) setStatus('Błąd połączenia WebSocket')
      }

      ws.onclose = () => {
        if (!cancelledRef.current) setStatus('Rozłączono')
      }
    }

    init()

    return () => {
      cancelledRef.current = true
      if (ws) ws.close()
      wsRef.current = null
    }
  }, [channel])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0f0f0f', color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13
    }}>
      {status ? (
        <div style={{
          padding: '8px 12px', fontSize: 12, color: '#888',
          borderBottom: '1px solid #222', flexShrink: 0
        }}>
          {status}
        </div>
      ) : (
        <div style={{
          padding: '4px 12px', fontSize: 11, color: '#53fc18',
          borderBottom: '1px solid #1a1a1a', flexShrink: 0
        }}>
          ● Kick live chat
        </div>
      )}
      <div
        ref={listRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 10px',
          display: 'flex', flexDirection: 'column', gap: 3
        }}
      >
        {messages.length === 0 && !status && (
          <div style={{ color: '#555', fontSize: 12, padding: '8px 0' }}>
            Czekam na wiadomości...
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>
            <span style={{ color: m.color, fontWeight: 600 }}>{m.username}</span>
            <span style={{ color: '#ccc' }}>: {m.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
