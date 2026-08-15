import { useMemo, useState } from 'react'
import type { Kline, Fill } from '../types'

interface Props {
  klines: Kline[]
  fills: Fill[]
  position: {
    entry: number
    stop_loss: number
    take_profit: number
    mark_price: number
  } | null
  livePrice: number
}

const AXIS_W = 64      // left price-axis width
const TIME_H = 22      // bottom time-axis height
const PAD_T = 10
const PAD_R = 8

// TradingView-style candlestick chart (pure SVG, no deps):
// - left price axis + bottom time axis with grid
// - volume bars in the lower band
// - open-trade markers (▲ buy / ▼ sell)
// - dashed ENTRY, STOP-LOSS (red), TAKE-PROFIT (green) lines on the price scale
// - live price line + tag
export default function PriceChart({ klines, fills, position, livePrice }: Props) {
  const [hover, setHover] = useState<{ i: number } | null>(null)
  const W = 1000, H = 420
  const plotW = W - AXIS_W - PAD_R
  const plotH = H - PAD_T - TIME_H
  const volH = plotH * 0.22           // bottom 22% reserved for volume
  const priceH = plotH - volH

  const { candles, lo, hi, maxVol, yPrice, xAt, priceFmt, timeFmt } = useMemo(() => {
    const cs = klines.slice(-90)
    let l = Math.min(...cs.map(c => c.l), livePrice, position?.stop_loss ?? livePrice)
    let h = Math.max(...cs.map(c => c.h), livePrice, position?.take_profit ?? livePrice)
    const pad = (h - l) * 0.06 || 1
    l -= pad; h += pad
    const maxV = Math.max(...cs.map(c => c.v), 1)
    const yPrice = (p: number) => PAD_T + priceH - ((p - l) / (h - l)) * priceH
    const xAt = (i: number) => AXIS_W + (cs.length <= 1 ? 0 : (i / (cs.length - 1)) * plotW)
    const fmtP = (p: number) => '$' + p.toLocaleString(undefined, { maximumFractionDigits: 0 })
    const fmtT = (t: number) => {
      const d = new Date(t)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return { candles: cs, lo: l, hi: h, maxVol: maxV, yPrice, xAt, priceFmt: fmtP, timeFmt: fmtT }
  }, [klines, livePrice, position])

  if (candles.length === 0) return <div className="empty">loading price chart…</div>

  const cw = plotW / candles.length
  const bodyW = Math.max(1.5, cw * 0.62)
  const yVol = (v: number) => PAD_T + priceH + volH - (v / maxVol) * (volH - 4)

  // past trade markers
  const marks = fills
    .filter(f => f.side === 'BUY' || f.side === 'SELL')
    .map(f => {
      const idx = candles.findIndex(c => c.t >= Date.parse(f.t))
      const i = idx >= 0 ? idx : candles.length - 1
      return { i, side: f.side, price: f.price }
    })

  const gridN = 5
  const grid = Array.from({ length: gridN + 1 }, (_, i) => lo + (hi - lo) * (i / gridN))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((x - AXIS_W) / plotW) * (candles.length - 1))
    if (i >= 0 && i < candles.length) setHover({ i })
  }

  const hov = hover ? candles[hover.i] : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="price-chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {/* horizontal grid + price axis */}
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={AXIS_W} y1={yPrice(g)} x2={W - PAD_R} y2={yPrice(g)} stroke="rgba(255,255,255,0.05)" />
          <text x={W - PAD_R - 2} y={yPrice(g) + 4} textAnchor="end" fontSize="11" fill="rgba(226,232,240,0.55)">{priceFmt(g)}</text>
        </g>
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const x = xAt(i)
        const up = c.c >= c.o
        const col = up ? 'var(--pos)' : 'var(--neg)'
        const yo = yPrice(c.o), yc = yPrice(c.c), yh = yPrice(c.h), yl = yPrice(c.l)
        const top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo))
        return (
          <g key={i}>
            <line x1={x} y1={yh} x2={x} y2={yl} stroke={col} strokeWidth={1} opacity={0.65} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={hgt} fill={col} opacity={0.9} />
            {/* volume */}
            <rect x={x - bodyW / 2} y={yVol(c.v)} width={bodyW} height={PAD_T + priceH + volH - yVol(c.v)}
                  fill={col} opacity={0.22} />
          </g>
        )
      })}

      {/* past trade markers */}
      {marks.map((m, i) => {
        const x = xAt(m.i), y = yPrice(m.price)
        return m.side === 'BUY'
          ? <path key={i} d={`M${x} ${y - 10} l5.5 9 l-11 0 z`} fill="var(--pos)" />
          : <path key={i} d={`M${x} ${y + 10} l5.5 -9 l-11 0 z`} fill="var(--neg)" />
      })}

      {/* position lines */}
      {position && (
        <>
          <Line y={yPrice(position.take_profit)} x0={AXIS_W} x1={W - PAD_R} color="var(--pos)" label={`TP ${priceFmt(position.take_profit)}`} dash />
          <Line y={yPrice(position.stop_loss)} x0={AXIS_W} x1={W - PAD_R} color="var(--neg)" label={`SL ${priceFmt(position.stop_loss)}`} dash />
          <Line y={yPrice(position.entry)} x0={AXIS_W} x1={W - PAD_R} color="var(--accent)" label={`ENTRY ${priceFmt(position.entry)}`} />
        </>
      )}

      {/* live price */}
      <g>
        <line x1={AXIS_W} y1={yPrice(livePrice)} x2={W - PAD_R} y2={yPrice(livePrice)} stroke="rgba(226,232,240,0.45)" strokeWidth={1} strokeDasharray="2 3" />
        <circle cx={W - PAD_R} cy={yPrice(livePrice)} r={4} fill="#fff" stroke="var(--accent)" strokeWidth={2} />
        <text x={W - PAD_R - 2} y={yPrice(livePrice) - 6} textAnchor="end" fontSize="11" fontWeight={700} fill="#fff">{priceFmt(livePrice)}</text>
      </g>

      {/* time axis */}
      {candles.map((c, i) => (i % Math.ceil(candles.length / 6) === 0)
        ? <text key={i} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="rgba(226,232,240,0.45)">{timeFmt(c.t)}</text>
        : null)}

      {/* crosshair + hover OHLC */}
      {hov && hover && (
        <g pointerEvents="none">
          <line x1={xAt(hover.i)} y1={PAD_T} x2={xAt(hover.i)} y2={PAD_T + plotH} stroke="rgba(226,232,240,0.25)" />
          <line x1={AXIS_W} y1={yPrice(hov.c)} x2={W - PAD_R} y2={yPrice(hov.c)} stroke="rgba(226,232,240,0.25)" />
          <text x={AXIS_W + 4} y={PAD_T + 12} fontSize="11" fill="rgba(226,232,240,0.8)">
            O {priceFmt(hov.o)}  H {priceFmt(hov.h)}  L {priceFmt(hov.l)}  C {priceFmt(hov.c)}
          </text>
        </g>
      )}
    </svg>
  )
}

function Line({ y, x0, x1, color, label, dash }: { y: number; x0: number; x1: number; color: string; label: string; dash?: boolean }) {
  return (
    <g>
      <line x1={x0} y1={y} x2={x1} y2={y} stroke={color} strokeWidth={1.3} strokeDasharray={dash ? '7 4' : undefined} opacity={0.95} />
      <text x={x0 + 4} y={y - 4} fontSize="10.5" fontWeight={700} fill={color}>{label}</text>
    </g>
  )
}
