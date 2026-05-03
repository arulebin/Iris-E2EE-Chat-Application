import { useEffect, useRef, useState } from 'react'

function App() {
  const [messages, setMessages] = useState<string[]>([])
  const [input, setInput] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
        console.warn('No token in localStorage — log in first')
        return
    }
    const ws = new WebSocket(`ws://localhost:8080/ws/chat?token=${token}`)

    wsRef.current = ws

    ws.onopen    = () => console.log('connected')
    ws.onclose   = () => console.log('closed')
    ws.onerror   = (e) => console.error('error', e)
    ws.onmessage = (e) => {
      setMessages(prev => [...prev, e.data])
    }

    return () => ws.close()
  }, [])

  function send() {
    if(wsRef.current?.readyState === WebSocket.OPEN){
      wsRef.current.send(input);
      setInput("");
    }
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '2rem auto', padding: '1rem' }}>
      <h1>Iris</h1>

      <ul style={{ minHeight: 200, border: '1px solid #ccc', padding: '0.5rem', listStyle: 'none' }}>
        {messages.map((message,i) => <li key={i}>{message}</li>)}
      </ul>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder="Type and press Enter"
        style={{ width: '70%', padding: '0.5rem' }}
      />
      <button onClick={send} style={{ padding: '0.5rem 1rem', marginLeft: '0.5rem' }}>
        Send
      </button>
    </div>
  )
}

export default App
