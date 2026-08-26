import { useEffect, useRef, useState } from 'react'
import useCountUp from './useCountUp'

interface Props {
  label: string
  value: number
  fmt: (n: number) => string
  tone?: 'auto' | 'pos' | 'neg' | 'plain'
  spark?: number[]
  sub?: string
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="kpi-spark" />
  const w = 120, h = 24, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = data[data.length - 1] >= data[0]
  const color = up ? '#10b981' : '#ef4444'
  const gradId = `spark-grad-${up ? 'up' : 'down'}`

  const firstX = pad
  const lastX = w - pad
  const areaPath = `M ${firstX},${h} L ${pts.split(' ').join(' L ')} L ${lastX},${h} Z`

  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Kpi({ label, value, fmt, tone = 'auto', spark, sub }: Props) {
  const display = useCountUp(value)
  const prev = useRef(value)
  const [flash, setFlash] = useState('')
  const cls = tone === 'auto' ? (value >= 0 ? 'pos' : 'neg') : tone

  useEffect(() => {
    if (Math.abs(value - prev.current) > 1e-9) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down')
      const t = setTimeout(() => setFlash(''), 700)
      prev.current = value
      return () => clearTimeout(t)
    }
  }, [value])

  return (
    <div className="card-bezel rise d2">
      <div className="card-inner kpi-card">
        <div>
          <div className="kpi-label">{label}</div>
          <div className={`kpi-value ${cls} ${flash}`}>{fmt(display)}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>{sub}</div>}
        </div>
        <Sparkline data={spark ?? []} />
      </div>
    </div>
  )
}
