import { useEffect, useRef, useState } from 'react'
import { fetchState, fetchFills } from './api'
import type { State, Fill } from './types'
import Kpi from './components/Kpi'
import EquityChart from './components/EquityChart'
import TradeTable from './components/TradeTable'

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [online, setOnline] = useState(true)
  const [err, setErr] = useState('')
  const priceRef = useRef<HTMLSpanElement>(null)
  const prevPrice = useRef<number>(0)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, f] = await Promise.all([fetchState(), fetchFills()])
        if (!alive) return
        // flash price direction
        if (priceRef.current && prevPrice.current) {
          const up = s.price > prevPrice.current
          priceRef.current.className = 'px ' + (up ? 'up' : 'down')
        }
        prevPrice.current = s.price
        setState(s)
        setFills(f)
        setOnline(true)
        setErr('')
      } catch (e) {
        if (!alive) return
        setOnline(false)
        setErr(e instanceof Error ? e.message : 'offline')
      }
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const eq = state?.equity_curve ?? []
  const usd = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pnl = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <div className="mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 7-8" /><path d="M21 7v5h-5" />
            </svg>
          </div>
          <div>
            <h1>Paper Trader</h1>
            <div className="sub">BINANCE DEMO · paper engine · RSI(14) 15m mean-reversion</div>
          </div>
        </div>
        <div className="ticker">
          <span className="sym">{state?.symbol ?? 'BTCUSDT'}</span>
          <span className="px" ref={priceRef}>{state ? usd(state.price) : '—'}</span>
        </div>
        <div className="status">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          {online
            ? <>live · {state ? new Date(state.updated).toLocaleTimeString() : ''}</>
            : <span style={{ color: 'var(--negative)' }}>reconnecting…</span>}
        </div>
      </div>

      {state ? (
        <>
          <div className="kpis">
            <Kpi label="Net P&L · bot" value={state.net_pnl} fmt={pnl} tone="auto" spark={eq.map(p => p.equity)} />
            <Kpi label="Realized" value={state.realized} fmt={pnl} tone="auto" />
            <Kpi label="Open Position" value={state.btc_open} fmt={v => v > 1e-6 ? `${v.toFixed(5)} BTC` : 'flat'} tone="plain" />
            <Kpi label="USDT Cash" value={state.usdt} fmt={usd} tone="plain" />
          </div>

          <div className="panel rise d5">
            <div className="head">
              <h2>Equity Curve — bot trading P&L (USDT)</h2>
              <span className="hint">{state.round_trips} round-trips · {state.fills} fills</span>
            </div>
            <EquityChart data={eq} />
          </div>

          <div className="panel rise d6">
            <div className="head">
              <h2>Trade History</h2>
              <span className="hint">updates every 15s</span>
            </div>
            <TradeTable fills={fills} />
          </div>
        </>
      ) : (
        <div className="panel"><div className={err ? 'err' : 'empty'}>{err || 'connecting to trading engine…'}</div></div>
      )}
    </div>
  )
}
