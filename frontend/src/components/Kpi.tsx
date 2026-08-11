import { useEffect, useRef, useState } from 'react'
import useCountUp from './useCountUp'

interface Props {
  label: string
  value: number
  fmt: (n: number) => string
  tone?: 'auto' | 'pos' | 'neg' | 'plain'
  spark?: number[]
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="spark" />
  const w = 120, h = 26, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = data[data.length - 1] >= data[0]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? 'var(--accent)' : 'var(--negative)'} strokeWidth="1.5" opacity="0.8" />
    </svg>
  )
}

export default function Kpi({ label, value, fmt, tone = 'auto', spark }: Props) {
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
    <div className="kpi rise d3">
      <div className="label">{label}</div>
      <div className={`value ${cls} ${flash}`}>{fmt(display)}</div>
      <Sparkline data={spark ?? []} />
    </div>
  )
}
