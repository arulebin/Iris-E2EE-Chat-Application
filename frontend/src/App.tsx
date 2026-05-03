import { useEffect, useRef, useState } from 'react'

function App() {
  const [token, setToken]       = useState<string | null>(() => localStorage.getItem('token'))
  const [mode, setMode]         = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)

  const [messages, setMessages] = useState<string[]>([])
  const [input, setInput]       = useState('')
  const wsRef                   = useRef<WebSocket | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch(`http://localhost:8080/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) throw new Error((await res.text()) || `${mode} failed`)

      let token: string
      if (mode === 'signup') {
        const loginRes = await fetch('http://localhost:8080/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (!loginRes.ok) throw new Error('Auto-login after signup failed')
        token = (await loginRes.json()).token
      } else {
        token = (await res.json()).token
      }
      localStorage.setItem('token', token)
      setToken(token)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    setToken(null)
    setMessages([])
    wsRef.current?.close()
  }

  useEffect(() => {
    if (!token) return
    const ws = new WebSocket(`ws://localhost:8080/ws/chat?token=${token}`)
    wsRef.current = ws
    ws.onopen    = () => console.log('connected')
    ws.onclose   = () => console.log('closed')
    ws.onerror   = (e) => console.error('error', e)
    ws.onmessage = (e) => setMessages(prev => [...prev, e.data])
    return () => ws.close()
  }, [token])

  function send() {
    if (input.trim() === '') return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(input)
      setInput('')
    }
  }

  // ── LOGIN / SIGNUP ──────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
          <h1 className="text-3xl font-bold text-slate-900">Iris</h1>
          <p className="text-slate-500 mb-6 text-sm">Private chat for you and your circle.</p>

          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            {mode === 'login' ? 'Log in' : 'Create account'}
          </h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoFocus
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg transition"
            >
              {mode === 'login' ? 'Log in' : 'Sign up'}
            </button>
          </form>

          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

          <p className="text-sm text-slate-500 mt-6 text-center">
            {mode === 'login' ? "No account? " : 'Already have one? '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null) }}
              className="text-indigo-600 hover:underline"
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    )
  }

  // ── CHAT ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-xl font-bold text-slate-900">Iris</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Log out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-4">
        <ul className="max-w-2xl mx-auto flex flex-col gap-2">
          {messages.map((m, i) => (
            <li
              key={i}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 shadow-sm"
            >
              {m}
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Type and press Enter"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={send}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg transition"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
