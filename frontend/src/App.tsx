import { useEffect, useRef, useState } from 'react'
import { fetchState, fetchFills, fetchKlines } from './api'
import type { State, Fill, Klines } from './types'
import Kpi from './components/Kpi'
import EquityChart from './components/EquityChart'
import PriceChart from './components/PriceChart'
import TradeTable from './components/TradeTable'

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [klines, setKlines] = useState<Klines | null>(null)
  const [online, setOnline] = useState(true)
  const [err, setErr] = useState('')
  const priceRef = useRef<HTMLSpanElement>(null)
  const prevPrice = useRef<number>(0)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, f, k] = await Promise.all([fetchState(), fetchFills(), fetchKlines()])
        if (!alive) return
        if (priceRef.current && prevPrice.current) {
          const up = s.price > prevPrice.current
          priceRef.current.className = 'px ' + (up ? 'up' : 'down')
        }
        prevPrice.current = s.price
        setState(s)
        setFills(f)
        setKlines(k)
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

          {/* CURRENT POSITION */}
          {state.position ? (
            <div className="panel rise d4">
              <div className="head">
                <h2>Current Position</h2>
                <span className={`badge ${state.position.unrealized_pnl >= 0 ? 'buy' : 'sell'}`}>
                  {state.position.side} · {state.position.unrealized_pnl >= 0 ? '+' : ''}{state.position.unrealized_pnl.toFixed(2)} ({state.position.unrealized_pct.toFixed(2)}%)
                </span>
              </div>
              <div className="pos-grid">
                <div className="pos-cell"><span className="pos-k">Entry</span><span className="pos-v">${state.position.entry.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Qty (BTC)</span><span className="pos-v">{state.position.qty}</span></div>
                <div className="pos-cell"><span className="pos-k">Mark</span><span className="pos-v">${state.position.mark_price.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Unrealized P&L</span><span className={`pos-v ${state.position.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>{state.position.unrealized_pnl >= 0 ? '+' : ''}{state.position.unrealized_pnl.toFixed(2)}</span></div>
                <div className="pos-cell"><span className="pos-k">Stop Loss</span><span className="pos-v neg">${state.position.stop_loss.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Take Profit</span><span className="pos-v pos">${state.position.take_profit.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Risk / Reward</span><span className="pos-v">{state.position.rr.toFixed(2)} : 1</span></div>
                <div className="pos-cell"><span className="pos-k">Opened</span><span className="pos-v">{state.position.opened_at ? new Date(state.position.opened_at).toLocaleString() : '—'}</span></div>
              </div>
            </div>
          ) : (
            <div className="panel rise d4">
              <div className="head"><h2>Current Position</h2><span className="hint">flat · no open trade</span></div>
              <div className="empty">Bot is flat — watching for an entry signal.</div>
            </div>
          )}

          {/* PRICE CHART — the coin you're trading */}
          <div className="panel rise d45">
            <div className="head">
              <h2>{state.symbol} · Price ({klines?.interval ?? '15m'})</h2>
              <span className="hint">
                <span className="lg-buy">▲ buy</span> <span className="lg-sell">▼ sell</span> · <span style={{color:'var(--accent)'}}>— entry</span> <span style={{color:'var(--neg)'}}>— SL</span> <span style={{color:'var(--pos)'}}>— TP</span> · hover for OHLC · {klines ? klines.candles.length : 0} candles
              </span>
            </div>
            {klines ? (
              <PriceChart klines={klines.candles} fills={fills} position={state.position} livePrice={state.price} />
            ) : (
              <div className="empty">loading price chart…</div>
            )}
          </div>

          {state.tune && (
            <div className="panel rise d55">
              <div className="head">
                <div>
                  <h2>Strategy Self-Review</h2>
                  <span className="hint">walk-forward 70/30 OOS · active: <b>{state.strategy}</b> {JSON.stringify(state.strategy_params)} · bot picks best per regime</span>
                </div>
                <span className={`badge ${state.tune.applied ? 'sell' : 'buy'}`}>{state.tune.applied ? 'switched' : 'stable'}</span>
              </div>
              <div className="tune-grid">
                {state.tune.candidates.map((c, i) => (
                  <div key={i} className={`tune-card ${(c.strategy===state.tune!.best.strategy && JSON.stringify(c.params)===JSON.stringify(state.tune!.best.params)) ? 'best' : ''}`}>
                    <div className="tune-set">{c.strategy}</div>
                    <div className={`tune-ret ${(c.test_ret??0) >= 0 ? 'pos' : 'neg'}`}>{(c.test_ret??0) >= 0 ? '+' : ''}{(c.test_ret??0).toFixed(2)}%</div>
                    <div className="tune-wr">OOS · {c.trades} trades · {c.win_rate}% wr</div>
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
