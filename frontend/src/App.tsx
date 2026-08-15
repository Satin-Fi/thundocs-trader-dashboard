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
  const pf = state?.portfolio

  // gain/loss tile render
  const GlTile = ({ title, gain, loss, net }: { title: string; gain: number; loss: number; net: number }) => (
    <div className="gl-tile">
      <div className="gl-title">{title}</div>
      <div className="gl-row">
        <span className="gl-k">gain</span>
        <span className="gl-v pos">{usd(gain)}</span>
      </div>
      <div className="gl-row">
        <span className="gl-k">loss</span>
        <span className="gl-v neg">{usd(loss)}</span>
      </div>
      <div className="gl-row total">
        <span className="gl-k">net</span>
        <span className={`gl-v ${net >= 0 ? 'pos' : 'neg'}`}>{pnl(net)}</span>
      </div>
    </div>
  )

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
            <Kpi label="Total Funds" value={state.total_funds} fmt={usd} tone="plain" spark={eq.map(p => p.equity)} />
            <Kpi label="Net P&L · bot" value={state.net_pnl} fmt={pnl} tone="auto" />
            <Kpi label="Realized" value={state.realized} fmt={pnl} tone="auto" />
            <Kpi label="USDT Cash" value={state.usdt} fmt={usd} tone="plain" />
          </div>

          {pf && (
            <div className="panel rise d5">
              <div className="head">
                <h2>Portfolio — gain / loss ledger</h2>
                <span className="hint">
                  {!state.creds_loaded && <span className="warn">⚠ demo creds not loaded on backend</span>}
                  {state.creds_loaded && 'demo account · fake money'}
                </span>
              </div>
              <div className="gl-grid">
                <GlTile title="Today" gain={pf.today_gain} loss={pf.today_loss} net={pf.today_net} />
                <GlTile title="Yesterday" gain={pf.yesterday_gain} loss={pf.yesterday_loss} net={pf.yesterday_net} />
                <GlTile title="This Week" gain={pf.week_gain} loss={pf.week_loss} net={pf.week_net} />
              </div>
            </div>
          )}

          {state.tune && (
            <div className="panel rise d55">
              <div className="head">
                <div>
                  <h2>Strategy Self-Review</h2>
                  <span className="hint">walk-forward 70/30 · bot retunes every ~2h · {state.rsi.low}/{state.rsi.high} active · out-of-sample = honest score</span>
                </div>
                <span className={`badge ${state.tune.applied ? 'sell' : 'buy'}`}>{state.tune.applied ? 'tuned' : 'stable'}</span>
              </div>
              <div className="tune-grid">
                {state.tune.candidates.map((c, i) => (
                  <div key={i} className={`tune-card ${(c.low===state.tune!.best.low && c.high===state.tune!.best.high) ? 'best' : ''}`}>
                    <div className="tune-set">RSI {c.low}/{c.high}</div>
                    <div className={`tune-ret ${(c.test_ret??0) >= 0 ? 'pos' : 'neg'}`}>{(c.test_ret??0) >= 0 ? '+' : ''}{(c.test_ret??0).toFixed(2)}%</div>
                    <div className="tune-wr">out-of-sample · train {(c.train_ret??0).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel rise d6">
            <div className="head">
              <h2>Equity Curve — bot trading P&L (USDT)</h2>
              <span className="hint">{state.round_trips} round-trips · {state.fills} fills</span>
            </div>
            <EquityChart data={eq} markers={fills.map(f => ({ t: f.t, side: f.side, price: f.price }))} />
          </div>

          <div className="panel rise d7">
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
