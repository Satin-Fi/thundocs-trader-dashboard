import { useEffect, useRef, useState } from 'react'
import { apiBase as API_BASE } from './api'

/**
 * Real-time BTC price.
 *
 * PRIMARY: Server-Sent Events from our own backend (/api/stream) reached
 * THROUGH THE SAME TUNNEL the dashboard already uses. This is guaranteed to
 * work in the browser even if Binance's own WebSocket is blocked there,
 * because the browser only talks to your desktop backend.
 *
 * FALLBACK: if SSE is unavailable, a direct Binance WebSocket (wss://stream.binance.com)
 * for sub-second ticks. If that also fails, the App's REST poll covers it.
 *
 * Returns { price, mode } where mode is 'sse' | 'ws' | 'rest' | 'connecting'.
 */
export function useLivePrice(symbol = 'btcusdt') {
  const [price, setPrice] = useState<number | null>(null)
  const [mode, setMode] = useState<'connecting' | 'sse' | 'ws' | 'rest'>('connecting')
  const priceRef = useRef<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    const stream = `${symbol.toLowerCase()}@trade`
    const wsUrl = `wss://stream.binance.com:9443/ws/${stream}`
    const sseUrl = `${API_BASE}/api/stream`

    const startRest = () => {
      if (pollRef.current || !alive) return
      setMode('rest')
      import('./api').then(({ fetchPrice }) => {
        pollRef.current = setInterval(async () => {
          try {
            const p = await fetchPrice()
            if (alive && (priceRef.current === null || p.price !== priceRef.current)) {
              priceRef.current = p.price; setPrice(p.price)
            }
          } catch {}
        }, 2000)
      })
    }
    const stopRest = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

    // --- try SSE first (goes through the tunnel, always reachable) ---
    const trySSE = () => {
      if (!alive) return
      try {
        const es = new EventSource(sseUrl)
        esRef.current = es
        es.onopen = () => { if (alive) { setMode('sse'); stopRest() } }
        es.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data)
            const p = parseFloat(d.price)
            if (!isNaN(p) && p > 0) { priceRef.current = p; setPrice(p); setMode('sse') }
          } catch {}
        }
        es.onerror = () => {
          // SSE failed → fall back to Binance WS, then REST
          try { es.close() } catch {}
          esRef.current = null
          if (alive) tryWS()
        }
      } catch { if (alive) tryWS() }
    }

    // --- Binance WS fallback ---
    const tryWS = () => {
      if (!alive) return
      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        const giveUp = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) { try { ws.close() } catch {} startRest() } }, 4000)
        ws.onopen = () => { clearTimeout(giveUp); setMode('ws'); stopRest() }
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data)
            const p = parseFloat(d.p ?? d.c ?? d.P)
            if (!isNaN(p) && p > 0) { priceRef.current = p; setPrice(p); setMode('ws') }
          } catch {}
        }
        ws.onclose = () => { try { ws.close() } catch {}; wsRef.current = null; if (alive) startRest() }
        ws.onerror = () => { try { ws.close() } catch {}; wsRef.current = null }
      } catch { startRest() }
    }

    trySSE()

    return () => {
      alive = false
      stopRest()
      if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
      if (esRef.current) { try { esRef.current.close() } catch {} esRef.current = null }
    }
  }, [symbol])

  return { price, mode }
}
