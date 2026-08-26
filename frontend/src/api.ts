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

declare global {
  interface Window { __API_URL__?: string }
}

export function getApiUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    const local = localStorage.getItem('THUNDOC_API_URL')
    if (local && local.trim()) return local.trim().replace(/\/+$/, '')
  } catch {}
  if (window.__API_URL__ && window.__API_URL__.trim()) {
    return window.__API_URL__.trim().replace(/\/+$/, '')
  }
  return ''
}

export function setCustomApiUrl(url: string) {
  if (typeof window === 'undefined') return
  try {
    if (!url || !url.trim()) {
      localStorage.removeItem('THUNDOC_API_URL')
    } else {
      localStorage.setItem('THUNDOC_API_URL', url.trim().replace(/\/+$/, ''))
    }
  } catch {}
}

export const apiBase = getApiUrl()

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  const base = getApiUrl()
  let res: Response
  try {
    res = await fetch(`${base}${path}`, opts)
  } catch (e) {
    throw new Error('offline')
  }
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
export async function setSettings(max_capital: number): Promise<{ ok: boolean, max_capital: number }> {
  const url = getApiUrl() + '/api/settings'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_capital })
  })
  return res.json()
}

export async function setSymbol(symbol: string): Promise<{ ok: boolean }> {
  const url = getApiUrl() + '/api/symbol'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  })
  return res.json()
}

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

// ---- New: manual trading, signal, risk, strategy explainer ----
export interface AiVerdict {
  verdict: 'CONFIRM' | 'REJECT' | 'PENDING'
  reason: string
  provider: string
  model: string
  ts: string
  signal: string
}
export interface Signal {
  signal: 'BUY' | 'SELL' | 'HOLD'
  reason: string
  rsi: number | null
  regime: string | null
  regime_score: number
  strategy: string
  strategy_name: string
  price: number
  position: string
  ai?: AiVerdict | null
}
export const fetchSignal = () => get<Signal>('/api/signal')

export interface Risk {
  trading_blocked: boolean
  block_reasons: string[]
  signal: string
  regime: string
  regime_score: number
  rsi: number
  atr: number | null
  entry_risk: { sl_price: number; tp_price: number; risk_pct: number; reward_pct: number; rr: number }
  available_usdt: number
  flat: boolean
}
export const fetchRisk = () => get<Risk>('/api/risk')

export interface StrategyDetail {
  key: string
  name: string
  description: string
  how_it_works: string
  params: Record<string, number>
  current_rsi: number | null
  regime: string
  regime_score: number
  tuned: { ts: string; applied: boolean; best?: { strategy: string; test_ret?: number } } | null
  all_strategies: Record<string, { name: string; desc: string; params: Record<string, number> }>
}
export const fetchStrategyDetail = () => get<StrategyDetail>('/api/strategy-detail')

export interface ManualOrderResult { ok: boolean; order: string; side: string; qty: number; price: number; actor: string }
export const postManualOrder = (side: 'BUY' | 'SELL', notional?: number, auto_manage?: boolean, sl?: number, tp?: number, symbol?: string) =>
  get<ManualOrderResult>('/api/manual-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side, notional, auto_manage, sl, tp, symbol }),
  })

export const postManualUpdate = (symbol: string, auto_manage: boolean, sl?: number, tp?: number) =>
  get<{ ok: boolean }>('/api/manual-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, auto_manage, sl, tp }),
  })

export const postExitPosition = (symbol?: string) =>
  get<{ ok: boolean; order: string; qty: number; price: number }>('/api/exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })

export interface ScannerResult { symbol: string; rsi: number; priceChange: number; state: string; price: number }
export const fetchScanner = () => get<{ results: ScannerResult[] }>('/api/scanner')

export interface AgentInfo {
  id: string
  name: string
  tag: string
  role: string
  icon: string
  status?: string
  summary?: string
  indicators?: string[]
  stance?: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  thesis?: string
  action?: string
  size_fraction?: number
  strategy?: string
  decision?: string
  confidence_pct?: number
  rating?: number
  rationale?: string
}

export interface TAVerdict {
  signal: 'BUY' | 'SELL' | 'HOLD'
  rating: number
  confidence: number
  reasoning: string
  agents?: Record<string, AgentInfo>
  analyst_summaries?: Record<string, string>
  bull_case?: string
  bear_case?: string
  entry_reference_price?: number | null
  target_price?: number | null
  stop_loss?: number | null
  ticker: string
  analysis_date?: string
  ts: string | null
  elapsed_s?: number
  provider?: string
  deep_model?: string
  fast_model?: string
  router_url?: string
  interval_hours?: number
  enabled?: boolean
  is_analyzing?: boolean
  recent_steps?: Array<{ time: string; agent: string; text: string }>
  error?: string
}

export const fetchTAVerdict = () => get<TAVerdict>('/api/ta-verdict')

export const postTriggerTARun = () =>
  get<{ ok: boolean; started: boolean; message: string }>('/api/ta-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

export const fetchMultiAgents = () => get<import('./types').MultiAgentData>('/api/multi-agents')

export const fetchQuantHarnessBacktest = () => get<import('./types').QuantHarnessBacktest>('/api/quantharness/backtest')

