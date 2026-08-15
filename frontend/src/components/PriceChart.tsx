import { useMemo } from 'react'
import type { Kline, Fill } from '../types'

interface Props {
  klines: Kline[]
  fills: Fill[]
  currentEntry: number | null
  livePrice: number
}

// Lightweight candlestick chart (pure SVG, no deps). Renders the coin price with
// old buy/sell trade markers, the current open-position entry line, and a live
// price marker. Auto-scales to the visible price range.
export default function PriceChart({ klines, fills, currentEntry, livePrice }: Props) {
  const W = 960, H = 360, PAD_L = 8, PAD_R = 60, PAD_T = 12, PAD_B = 22
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const { candles, range, yToPx, xToPx, priceFmt } = useMemo(() => {
    const cs = klines.slice(-90) // last 90 candles for readability
    const highs = cs.map(c => c.h)
    const lows = cs.map(c => c.l)
    let lo = Math.min(...lows, livePrice, currentEntry ?? livePrice)
    let hi = Math.max(...highs, livePrice, currentEntry ?? livePrice)
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad; hi += pad
    const yToPx = (p: number) => PAD_T + plotH - ((p - lo) / (hi - lo)) * plotH
    const xToPx = (i: number) => PAD_L + (cs.length <= 1 ? 0 : (i / (cs.length - 1)) * plotW)
    return {
      candles: cs,
      range: { lo, hi },
      yToPx,
      xToPx,
      priceFmt: (p: number) => '$' + p.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    }
  }, [klines, livePrice, currentEntry])

  if (candles.length === 0) return <div className="empty">loading price chart…</div>

  const cw = plotW / candles.length
  const bodyW = Math.max(1.5, cw * 0.62)

  // map each trade fill to the nearest candle index by timestamp
  const fillMarks = fills
    .filter(f => f.side === 'BUY' || f.side === 'SELL')
    .map(f => {
      const idx = candles.findIndex(c => c.t >= Date.parse(f.t))
      const i = idx >= 0 ? idx : candles.length - 1
      return { i, side: f.side, price: f.price, t: f.t }
    })

  const gridLines = 4
  const grid = Array.from({ length: gridLines + 1 }, (_, i) => range.lo + (range.hi - range.lo) * (i / gridLines))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="price-chart" preserveAspectRatio="none" style={{ width: '100%', height: 'auto' }}>
      {/* grid + price axis */}
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={yToPx(g)} x2={PAD_L + plotW} y2={yToPx(g)} stroke="rgba(255,255,255,0.06)" />
          <text x={W - PAD_R + 6} y={yToPx(g) + 4} fill="rgba(226,232,240,0.55)" fontSize="11">{priceFmt(g)}</text>
        </g>
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const x = xToPx(i)
        const up = c.c >= c.o
        const color = up ? 'var(--positive)' : 'var(--negative)'
        const yO = yToPx(c.o), yC = yToPx(c.c), yH = yToPx(c.h), yL = yToPx(c.l)
        const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO))
        return (
          <g key={i}>
            <line x1={x} y1={yH} x2={x} y2={yL} stroke={color} strokeWidth={1} opacity={0.7} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={hgt} fill={color} opacity={0.85} />
          </g>
        )
      })}

      {/* old trade markers */}
      {fillMarks.map((m, i) => {
        const x = xToPx(m.i)
        const y = yToPx(m.price)
        const buy = m.side === 'BUY'
        return (
          <g key={i}>
            {buy
              ? <path d={`M${x} ${y - 9} l5 8 l-10 0 z`} fill="var(--positive)" />
              : <path d={`M${x} ${y + 9} l5 -8 l-10 0 z`} fill="var(--negative)" />}
          </g>
        )
      })}

      {/* current position entry line */}
      {currentEntry != null && (
        <g>
          <line x1={PAD_L} y1={yToPx(currentEntry)} x2={PAD_L + plotW} y2={yToPx(currentEntry)}
                stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="6 4" opacity={0.9} />
          <text x={PAD_L + 4} y={yToPx(currentEntry) - 4} fill="var(--accent)" fontSize="11" fontWeight={600}>
            entry {priceFmt(currentEntry)}
          </text>
        </g>
      )}

      {/* live price marker */}
      <g>
        <line x1={PAD_L} y1={yToPx(livePrice)} x2={PAD_L + plotW} y2={yToPx(livePrice)}
              stroke="rgba(226,232,240,0.5)" strokeWidth={1} strokeDasharray="2 3" />
        {(() => {
          const y = yToPx(livePrice)
          return <circle cx={PAD_L + plotW} cy={y} r={4} fill="#fff" stroke="var(--accent)" strokeWidth={2} />
        })()}
        <text x={W - PAD_R + 6} y={yToPx(livePrice) + 4} fill="#fff" fontSize="11" fontWeight={700}>
          {priceFmt(livePrice)}
        </text>
      </g>
    </svg>
  )
}
