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
export const apiBase = API_URL
