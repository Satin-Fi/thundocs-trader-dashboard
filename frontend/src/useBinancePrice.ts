import { useEffect, useRef, useState } from 'react'
import { fetchPrice } from './api'

/**
 * Real-time BTC price via Binance public WebSocket (wss://stream.binance.com).
 * Updates on every trade tick (sub-second) — no polling delay.
 * Falls back to the /api/price REST poll if the socket can't connect/drops.
 *
 * Returns the latest price (number | null until first update).
 */
export function useBinancePrice(symbol = 'btcusdt') {
  const [price, setPrice] = useState<number | null>(null)
  const priceRef = useRef<number | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const openedRef = useRef(false)

  useEffect(() => {
    let alive = true
    const stream = `${symbol.toLowerCase()}@trade`
    const url = `wss://stream.binance.com:9443/ws/${stream}`

    const startFallback = () => {
      if (pollTimer.current || !alive) return
      pollTimer.current = setInterval(async () => {
        try {
          const p = await fetchPrice()
          if (alive && (priceRef.current === null || Math.abs(p.price - (priceRef.current ?? 0)) > 0)) {
            priceRef.current = p.price
            setPrice(p.price)
          }
        } catch {}
      }, 2000)
    }
    const stopFallback = () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    }

    const connect = () => {
      if (!alive) return
      try {
        const ws = new WebSocket(url)
        wsRef.current = ws
        const giveUp = setTimeout(() => {
          if (!openedRef.current) { try { ws.close() } catch {} startFallback() }
        }, 4000)

        ws.onopen = () => { openedRef.current = true; stopFallback(); clearTimeout(giveUp) }
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data)
            const p = parseFloat(d.p ?? d.c ?? d.P)
            if (!isNaN(p) && p > 0) { priceRef.current = p; setPrice(p) }
          } catch {}
        }
        ws.onerror = () => { /* onclose handles reconnect/fallback */ }
        ws.onclose = () => {
          clearTimeout(giveUp)
          wsRef.current = null
          if (!alive) return
          // try to reconnect once after a short delay; if it never opened, fall back to REST
          if (openedRef.current) {
            setTimeout(connect, 1500)
          } else {
            startFallback()
          }
        }
      } catch {
        startFallback()
      }
    }

    connect()

    return () => {
      alive = false
      stopFallback()
      if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    }
  }, [symbol])

  return price
}
