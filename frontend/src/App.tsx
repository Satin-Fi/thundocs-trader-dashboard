import { useEffect, useState } from 'react'
import { fetchState, fetchFills } from './api'
import type { State, Fill } from './types'
import Kpis from './components/Kpis'
import EquityChart from './components/EquityChart'
import TradeTable from './components/TradeTable'

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [online, setOnline] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, f] = await Promise.all([fetchState(), fetchFills()])
        if (!alive) return
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

  return (
    <>
      <header>
        <div>
          <h1>Thundocs Trader <span className="pill">— Binance DEMO (fake money)</span></h1>
          <div className="sub">
            <span id="status" style={{ background: online ? 'var(--green)' : 'var(--red)' }} />
            {state ? `updated ${new Date(state.updated).toLocaleTimeString()} · RSI(14) 15m mean-reversion` : (err || 'connecting…')}
          </div>
        </div>
      </header>

      {state ? (
        <>
          <Kpis s={state} />
          <div className="panel">
            <h2>Equity Curve (bot trading P&L, USDT)</h2>
            <EquityChart s={state} />
          </div>
          <div className="panel">
            <h2>Trade History</h2>
            <TradeTable fills={fills} />
          </div>
        </>
      ) : (
        <div className="panel"><div className="err">{err || 'loading…'}</div></div>
      )}
    </>
  )
}
