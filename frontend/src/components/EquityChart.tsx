interface Point { t: string; equity: number }
interface Marker { t: string; side: 'BUY' | 'SELL'; price: number }
interface Props { data: Point[]; markers?: Marker[] }

export default function EquityChart({ data, markers = [] }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="state-empty">
        <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Insufficient execution data</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Equity curve will plot automatically as closed positions are logged</div>
      </div>
    )
  }
  const w = 1000, h = 280, padL = 12, padR = 12, padT = 18, padB = 28
  const vals = data.map(d => d.equity)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = (max - min) || 1
  const n = data.length
  const x = (i: number) => padL + (i / (n - 1)) * (w - padL - padR)
  const y = (v: number) => padT + (1 - (v - min) / span) * (h - padT - padB)
  const linePts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.equity).toFixed(1)}`).join(' ')
  const areaPts = `${padL},${h - padB} ${linePts} ${w - padR},${h - padB}`
  const up = vals[n - 1] >= vals[0]
  const stroke = up ? 'var(--accent)' : 'var(--negative)'
  const last = data[n - 1]
  const ticks = 4

  // map a fill timestamp to an x position by index proximity
  const timeToIdx = (t: string) => {
    let best = 0, bestDiff = Infinity
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(Date.parse(data[i].t) - Date.parse(t))
      if (diff < bestDiff) { bestDiff = diff; best = i }
    }
    return best
  }
  const markerEls = markers
    .filter(m => !isNaN(Date.parse(m.t)))
    .map((m, i) => {
      const idx = timeToIdx(m.t)
      const cx = x(idx)
      const cy = y(data[idx].equity)
      const isBuy = m.side === 'BUY'
      return (
        <g key={i} className="eq-marker">
          {isBuy
            ? <path d={`M${cx},${cy - 10} l4,7 l-8,0 z`} fill="var(--accent)" />
            : <path d={`M${cx},${cy + 10} l4,-7 l-8,0 z`} fill="var(--negative)" />}
          <circle cx={cx} cy={cy} r="3" fill={isBuy ? 'var(--accent)' : 'var(--negative)'} />
        </g>
      )
    })

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} role="img" aria-label="Equity curve">
        <defs>
          <linearGradient id="eqGradLive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'rgba(14, 203, 129, 0.15)' : 'rgba(246, 70, 93, 0.15)'} />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const gy = padT + (i / ticks) * (h - padT - padB)
          const gv = max - (i / ticks) * span
          return (
            <g key={i}>
              <line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="var(--border)" strokeWidth="1" />
              <text x={padL + 2} y={gy - 4} fill="var(--muted)" fontSize="10" fontFamily="var(--mono)">${gv.toFixed(2)}</text>
            </g>
          )
        })}
        <polygon fill="url(#eqGradLive)" points={areaPts} />
        <polyline fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={linePts} />
        {markerEls}
        <circle cx={x(n - 1)} cy={y(last.equity)} r="3.5" fill={stroke} />
      </svg>
      {markers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end', marginTop: 10, fontSize: 11, fontFamily: 'var(--mono)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>▲ BUY Fill</span>
          <span style={{ color: 'var(--negative)', fontWeight: 700 }}>▼ SELL Fill</span>
        </div>
      )}
    </div>
  )
}
