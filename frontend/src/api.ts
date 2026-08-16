import type { State, Fill, Klines, Indicators } from './types'

// API base is set at runtime by /config.js (window.__API_URL__), which Vercel
// serves verbatim. An EMPTY string there means "talk to my own origin" — Vercel
// proxies /api/* to the backend tunnel (see vercel.json). No build-time env,
// no hardcoded URL, so a stale tunnel can never be baked into the bundle.
declare global {
  interface Window { __API_URL__?: string }
}
const API_URL: string = (typeof window !== 'undefined' && window.__API_URL__) || ''
// alias used by useBinancePrice for the SSE stream URL
export const apiBase = API_URL

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, opts)
  } catch (e) {
    // network-level failure (tunnel down / DNS blip) — surface as offline
    throw new Error('offline')
  }
  // Cloudflare quick-tunnels return their own HTML error page (often as HTTP
  // 200 text/html) when the connector is momentarily down. Don't try to JSON-
  // parse that — treat any non-JSON body as unreachable so the UI shows the
  // reconnect banner instead of a raw "HTTP 404".
  const ct = res.headers.get('content-type') || ''
  if (!res.ok || !ct.includes('application/json')) {
    throw new Error(res.ok ? 'tunnel unreachable' : `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export const fetchState = () => get<State>('/api/state')
export const fetchFills = () => get<Fill[]>('/api/fills')
export const fetchKlines = (iv = '15m') => get<Klines>(`/api/klines?interval=${iv}`)
export const fetchIndicators = (iv = '15m') => get<Indicators>(`/api/indicators?interval=${iv}`)
export const fetchStrategies = () => get<{ current: string; strategies: Record<string, { name: string; desc: string; params: Record<string, number> }> }>('/api/strategies')
export const setStrategy = (s: string) =>
  get<{ ok: boolean; strategy: string }>('/api/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: s }),
  })
export const fetchPrice = () => get<{ price: number }>('/api/price')
