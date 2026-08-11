import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { State } from '../types'

export default function EquityChart({ s }: { s: State }) {
  const data = s.equity_curve.map((p) => ({ t: new Date(p.t).toLocaleTimeString(), equity: p.equity }))
  if (data.length < 2) {
    return <div className="pill">waiting for trades…</div>
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#222b3a" vertical={false} />
        <XAxis dataKey="t" stroke="#8b97a7" fontSize={11} minTickGap={40} />
        <YAxis stroke="#8b97a7" fontSize={11} width={48} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#141925', border: '1px solid #222b3a', borderRadius: 8, color: '#e6edf3' }}
          formatter={(v: number) => [`$${v.toFixed(2)}`, 'Equity']}
        />
        <Line type="monotone" dataKey="equity" stroke="#58a6ff" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
