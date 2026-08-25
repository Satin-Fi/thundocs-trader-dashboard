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
