import type { State } from '../types'

function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`val ${cls ?? ''}`}>{value}</div>
    </div>
  )
}

export default function Kpis({ s }: { s: State }) {
  const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)
  const usd = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="grid">
      <Kpi label="Net P&L (bot)" value={`${fmt(s.net_pnl)} USDT`} cls={s.net_pnl >= 0 ? 'pos' : 'neg'} />
      <Kpi label="Realized" value={`${fmt(s.realized)} USDT`} cls={s.realized >= 0 ? 'pos' : 'neg'} />
      <Kpi label="Open Position" value={s.btc_open > 1e-6 ? `${s.btc_open} BTC` : 'flat'} />
      <Kpi label="USDT Cash" value={usd(s.usdt)} />
    </div>
  )
}
