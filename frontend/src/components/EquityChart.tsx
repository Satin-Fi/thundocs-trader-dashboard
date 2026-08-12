interface Point { t: string; equity: number }
interface Marker { t: string; side: 'BUY' | 'SELL'; price: number }
interface Props { data: Point[]; markers?: Marker[] }

export default function EquityChart({ data, markers = [] }: Props) {
  if (!data || data.length < 2) {
    return <div className="chart-wrap" style={{ display: 'grid', placeItems: 'center' }}>
      <span className="hint">waiting for trades to draw the equity curve…</span>
    </div>
  }
  const w = 1000, h = 300, padL = 8, padR = 8, padT = 16, padB = 26
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
            ? <path d={`M${cx},${cy - 11} l5,9 l-10,0 z`} fill="var(--accent-mint)" />
            : <path d={`M${cx},${cy + 11} l5,-9 l-10,0 z`} fill="var(--negative)" />}
          <circle cx={cx} cy={cy} r="3" fill={isBuy ? 'var(--accent-mint)' : 'var(--negative)'} />
        </g>
      )
    })

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Equity curve with trade markers">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'rgba(0,217,146,0.18)' : 'rgba(251,86,91,0.14)'} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const gy = padT + (i / ticks) * (h - padT - padB)
          const gv = max - (i / ticks) * span
          return (
            <g key={i}>
              <line className="eq-grid" x1={padL} y1={gy} x2={w - padR} y2={gy} />
              <text className="eq-axis" x={padL + 2} y={gy - 3}>{gv.toFixed(1)}</text>
            </g>
          )
        })}
        <polygon className="eq-area" points={areaPts} />
        <polyline className="eq-line" style={{ stroke }} points={linePts} />
        {markerEls}
        <circle cx={x(n - 1)} cy={y(last.equity)} r="3.5" fill={stroke} style={{ filter: 'drop-shadow(0 0 6px currentColor)' }} />
      </svg>
      {markers.length > 0 && (
        <div className="chart-legend">
          <span className="lg buy">▲ buy</span>
          <span className="lg sell">▼ sell</span>
        </div>
      )}
    </div>
  )
}
