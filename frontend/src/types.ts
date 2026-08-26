export interface State {
  symbol: string
  price: number
  usdt: number
  realized: number
  net_pnl: number
  total_funds: number
  fills: number
  round_trips: number
  equity_curve: { t: string; equity: number }[]
  creds_loaded: boolean
  portfolio: {
    realized_total: number
    today_gain: number
    today_loss: number
    today_net: number
    yesterday_gain: number
    yesterday_loss: number
    yesterday_net: number
    week_gain: number
    week_loss: number
    week_net: number
  }
  strategy: string
  strategy_params: Record<string, number>
  last_exit: { reason: string; price: number; t: string } | null
  positions: { symbol: string; side: string; entry: number; qty: number; mark_price: number; unrealized_pnl: number; unrealized_pct: number; stop_loss?: number; take_profit?: number; risk?: number; reward?: number; rr?: number }[]
  tune: {
    ts: string
    method: string
    current: { strategy: string; params: Record<string, number>; test_ret: number }
    best: { strategy: string; params: Record<string, number>; train_ret: number; test_ret: number; trades: number; win_rate: number }
    applied: boolean
    candidates: { strategy: string; params: Record<string, number>; train_ret: number; test_ret: number; trades: number; win_rate: number }[]
  } | null
  max_capital: number
  regime: string
  regime_score: number
  atr: number
  trailing_stop: number | null
  manual_state?: { auto_manage?: boolean; sl?: number | string; tp?: number | string }
  updated: string
  pnl_by_actor?: any
}

export interface Kline {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface Klines {
  symbol: string
  interval: string
  price: number
  candles: Kline[]
}

export interface Fill {
  t: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number | string
  price: number | string
  order: number | string
  actor?: string
}

export interface Indicators {
  interval: string
  times: number[]
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

export interface Analytics {
  round_trips: number
  wins: number
  losses: number
  win_rate: number
  profit_factor: number
  avg_win: number
  avg_loss: number
  avg_hold_min: number
  max_drawdown: number
  expectancy: number
  largest_win: number
  largest_loss: number
  per_strategy: Record<string, number>
}

export interface BacktestRow {
  strategy: string
  params: Record<string, number>
  ret: number
  win_rate: number
  trades: number
  wins: number
  losses: number
  max_dd: number
}

export interface Backtest {
  days: number
  interval: string
  symbol: string
  results: BacktestRow[]
}

export interface ScannerResult {
  symbol: string
  rsi: number
  priceChange: number
  state: string
  price: number
}

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

export interface AgentStat {
  id: string
  name: string
  tag: string
  icon: string
  role: string
  status: 'HUNTING' | 'IN_TRADE' | 'COOLDOWN'
  win_rate: number
  total_trades: number
  pnl: number
  active_pairs: string[]
  max_concurrent: number
}

export interface AgentPosition {
  symbol: string
  agent_id: string
  agent_name: string
  icon: string
  entry_price: number
  qty: number
  stop_loss: number
  take_profit: number
  atr: number
  thesis: string
  entry_time: string
}

export interface AgentActivity {
  id: string
  time: string
  agent_id: string
  agent_name: string
  icon: string
  symbol: string
  action: 'ENTER_LONG' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_ALERT'
  price: number
  details: string
}

export interface MultiAgentData {
  agents: AgentStat[]
  active_positions: AgentPosition[]
  activity_feed: AgentActivity[]
  summary: {
    total_agents: number
    active_hunting: number
    open_positions_count: number
    combined_pnl: number
    average_win_rate: number
    total_trades_24h: number
  }
}

export interface QuantHarnessBacktest {
  initial_capital: number
  final_equity: number
  total_return_pct: number
  benchmark_bnh_pct: number
  alpha_pct: number
  win_rate: number
  total_trades: number
  profit_factor: number
  max_drawdown_pct: number
  sharpe_ratio: number
  equity_curve: { t: string | number; equity: number }[]
  trades: Array<{
    entry_time: string | number
    exit_time: string | number
    side: string
    entry_price: number
    exit_price: number
    qty: number
    pnl: number
    pnl_pct: number
    reason: string
  }>
  agents_participating: Array<{
    name: string
    weight: string
    role: string
  }>
}

