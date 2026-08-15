import type { State, Fill, Klines } from './types'

// API base is set at runtime via /config.js (window.__API_URL__), which Vercel
// serves verbatim — no build-time env needed. Falls back to VITE_API_URL if set.
declare global {
  interface Window { __API_URL__?: string }
}
const API_URL: string = (
  (typeof window !== 'undefined' && window.__API_URL__) ||
  (import.meta.env.VITE_API_URL as string) ||
  ''
).replace(/\/$/, '')

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const fetchState = () => get<State>('/api/state')
export const fetchFills = () => get<Fill[]>('/api/fills')
export const fetchPrice = () => get<{ price: number; updated: string }>('/api/price')
export const fetchKlines = (interval = '15m') => get<Klines>(`/api/klines?interval=${interval}`)
export const fetchIndicators = (interval = '15m') => get<Indicators>(`/api/indicators?interval=${interval}`)
export const fetchStrategies = () => get<{ current: string; strategies: Record<string, { name: string; desc: string; params: Record<string, number> }> }>('/api/strategies')
export const setStrategy = async (key: string) => {
  const res = await fetch(`${API_URL}/api/strategy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: key }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as { ok: boolean; strategy?: string; error?: string }
}
export const apiBase = API_URL

export interface Indicators {
  interval: string
  times: number[]          // unix seconds, aligned with klines
  rsi: (number | null)[]
  ema20: number[]
  ema50: number[]
  macd_line: number[]
  macd_signal: number[]
  macd_hist: number[]
  breakout_upper: (number | null)[]
  breakout_lower: (number | null)[]
  sr_zones: { level: number; type: 'S' | 'R'; strength: number; touches: number }[]
  signal: 'BUY' | 'SELL' | 'HOLD'
  signal_reason: string
  strategy: string
  strategy_params: Record<string, number>
}
