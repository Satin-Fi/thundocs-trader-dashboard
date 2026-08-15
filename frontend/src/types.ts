export interface State {
  symbol: string
  price: number
  usdt: number
  btc_open: number
  open_value: number
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
  rsi: { low: number; high: number }
  tune: {
    ts: string
    current: { low: number; high: number; ret: number }
    best: { low: number; high: number; metrics: { ret: number; win_rate: number; trades: number } }
    applied: boolean
    candidates: { low: number; high: number; metrics: { ret: number; win_rate: number; trades: number } }[]
  } | null
  updated: string
}

export interface Fill {
  t: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  order: number | string
}
