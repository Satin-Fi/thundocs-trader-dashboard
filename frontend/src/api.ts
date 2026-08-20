import type { State, Fill, Klines } from './types'

// Shape returned by /api/indicators (kept permissive; the chart guards on nulls).
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
export interface Settings { max_capital: number; size_min: number; max_notional: number }
export const fetchSettings = () => get<Settings>('/api/settings')
export const setSettings = (maxCapital: number) =>
  get<{ ok: boolean; max_capital: number }>('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_capital: maxCapital }),
  })
export const fetchPrice = () => get<{ price: number }>('/api/price')
export interface Analytics {
  round_trips: number; wins: number; losses: number; win_rate: number
  profit_factor: number; avg_win: number; avg_loss: number; avg_hold_min: number
  max_drawdown: number; expectancy: number; largest_win: number; largest_loss: number
  per_strategy: Record<string, number>
}
export const fetchAnalytics = () => get<Analytics>('/api/analytics')
export interface BacktestRow { strategy: string; params: Record<string, number>; ret: number; win_rate: number; trades: number; wins: number; losses: number; max_dd: number }
export interface Backtest { days: number; interval: string; symbol: string; results: BacktestRow[] }
export const fetchBacktest = (days = 30) => get<Backtest>(`/api/backtest?days=${days}`)
