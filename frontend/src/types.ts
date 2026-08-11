export interface State {
  symbol: string
  price: number
  usdt: number
  btc_open: number
  open_value: number
  realized: number
  net_pnl: number
  fills: number
  round_trips: number
  equity_curve: { t: string; equity: number }[]
  updated: string
}

export interface Fill {
  t: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  order: number | string
}
