import { useEffect, useRef, useState } from 'react'
import { fetchState, fetchFills, fetchKlines, fetchIndicators, fetchStrategies, setStrategy, fetchSettings, setSettings, Settings, fetchAnalytics, Analytics, fetchBacktest, Backtest } from './api'
import { useLivePrice } from './useBinancePrice'
import type { State, Fill, Klines } from './types'
import type { Indicators } from './api'
import type { IndicatorOpts } from './components/PriceChart'
import Kpi from './components/Kpi'
import EquityChart from './components/EquityChart'
import PriceChart from './components/PriceChart'
import TradeTable from './components/TradeTable'

export default function App() {
  const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w']
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [klines, setKlines] = useState<Klines | null>(null)
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [strategies, setStrategies] = useState<{ current: string; list: Record<string, { name: string; desc: string; params: Record<string, number> }> }>({ current: 'reversion', list: {} })
  const [switching, setSwitching] = useState(false)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [capInput, setCapInput] = useState('')
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState('')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [backtest, setBacktest] = useState<Backtest | null>(null)
  const [btDays, setBtDays] = useState(30)
  const [btLoading, setBtLoading] = useState(false)
  const [opts, setOpts] = useState<IndicatorOpts>({ ema20: true, ema50: true, breakout: false, rsi: true, macd: true, sr: true })
  const [tfState, setTf] = useState('15m')
  const [online, setOnline] = useState(true)
  const [connErr, setConnErr] = useState('')
  const priceRef = useRef<HTMLSpanElement>(null)
  const prevPrice = useRef<number>(0)
  const tfRef = useRef(tfState)
  tfRef.current = tfState
  const cacheRef = useRef<Record<string, Klines>>({})
  // REAL-TIME price: SSE through the tunnel (primary) → Binance WS → REST poll.
  const { price: wsPrice, mode: priceMode } = useLivePrice('btcusdt')

  // prefetch every timeframe once in the background so switching is instant
  useEffect(() => {
    let alive = true
    TIMEFRAMES.forEach(iv => {
      fetchKlines(iv)
        .then(k => { if (alive) { cacheRef.current[iv] = k; if (tfRef.current === iv) setKlines(k) } })
        .catch(() => {})
    })
    return () => { alive = false }
  }, [])

  // LIVE price sync — driven by the WebSocket (sub-second). We just reflect
  // wsPrice into the ticker + state.price here; the WS hook handles its own
  // REST fallback if the socket drops. No 2s polling loop needed.
  useEffect(() => {
    if (wsPrice == null) return
    if (priceRef.current && prevPrice.current) {
      const up = wsPrice > prevPrice.current
      priceRef.current.className = 'px ' + (up ? 'up' : 'down')
    }
    prevPrice.current = wsPrice
    setState(s => (s ? { ...s, price: wsPrice } : s))
    setOnline(true)
  }, [wsPrice])

  // MEDIUM poll (15s): full state (position, portfolio, funds) + fills. Heavier
  // (signed /account call) so we don't run it every 2s. On failure, show a
  // "reconnecting" banner and retry faster so a tunnel blip self-heals.
  useEffect(() => {
    let alive = true
    let retryId: ReturnType<typeof setInterval> | undefined
    const poll = async () => {
      try {
        const [s, f] = await Promise.all([fetchState(), fetchFills()])
        if (!alive) return
        setState(s)
        setFills(f)
        setConnErr('')
        if (retryId) { clearInterval(retryId); retryId = undefined }
      } catch (e) {
        if (!alive) return
        setConnErr(e instanceof Error ? e.message : 'offline')
        // retry every 4s while down (instead of waiting 15s)
        if (!retryId) retryId = setInterval(poll, 4000)
      }
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => { alive = false; clearInterval(id); if (retryId) clearInterval(retryId) }
  }, [])

  // SLOW poll (20s): refresh the active interval's candles. Candle bodies only
  // change per candle anyway, so 20s is plenty.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const k = await fetchKlines(tfRef.current)
        if (!alive) return
        cacheRef.current[tfRef.current] = k
        setKlines(k)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 20000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // instant switch: show cached data immediately, then refresh in background
  useEffect(() => {
    let alive = true
    const cached = cacheRef.current[tfState]
    if (cached) setKlines(cached)
    fetchKlines(tfState)
      .then(k => { if (alive) { cacheRef.current[tfState] = k; if (tfRef.current === tfState) setKlines(k) } })
      .catch(() => { if (alive) setConnErr('chart data unreachable') })
    return () => { alive = false }
  }, [tfState])

  // strategies list + current selection
  // Retries like the indicators/state polls: a single failed fetch (tunnel
  // blip) must not permanently leave the strategy dropdown empty.
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setInterval> | undefined
    const load = () => {
      fetchStrategies()
        .then(d => { if (alive) { setStrategies({ current: d.current, list: d.strategies }); if (retry) { clearInterval(retry); retry = undefined } } })
        .catch(() => { if (alive && !retry) retry = setInterval(load, 4000) })
    }
    load()
    return () => { alive = false; if (retry) clearInterval(retry) }
  }, [])

  // capital-limit setting (how much USDT the bot may deploy per trade)
  useEffect(() => {
    let alive = true
    const load = () => fetchSettings().then(d => { if (alive) { setSettingsState(d); setCapInput(String(d.max_capital)) } }).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // performance analytics (win rate, profit factor, drawdown, expectancy)
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setInterval> | undefined
    const load = () => {
      fetchAnalytics()
        .then(d => { if (alive) { setAnalytics(d); if (retry) { clearInterval(retry); retry = undefined } } })
        .catch(() => { if (alive && !retry) retry = setInterval(load, 5000) })
    }
    load()
    const id = setInterval(load, 20000)
    return () => { alive = false; clearInterval(id); if (retry) clearInterval(retry) }
  }, [])

  const runBacktest = async () => {
    setBtLoading(true)
    try {
      const b = await fetchBacktest(btDays)
      if (b) setBacktest(b)
    } catch { /* ignore */ }
    finally { setBtLoading(false) }
  }

  const saveCapital = async () => {
    const v = parseFloat(capInput)
    if (!(v > 0)) return
    const floor = settings?.size_min ?? 10
    if (v < floor) {
      setCapError(`Minimum order on Binance is $${floor.toFixed(0)} — set a limit at or above that to trade.`)
      return
    }
    setCapError('')
    setCapSaving(true)
    try {
      const r = await setSettings(v)
      if (r.ok) { setSettingsState(s => s ? { ...s, max_capital: r.max_capital } : s); setCapInput(String(r.max_capital)) }
    } catch { /* ignore */ }
    finally { setCapSaving(false) }
  }

  // indicators for the active interval (RSI/EMA/MACD/breakout + live signal)
  // Retries like the state poll, because a single failed fetch (tunnel blip)
  // must not permanently leave indicators null (which blanks the sub-charts).
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setInterval> | undefined
    const load = () => {
      fetchIndicators(tfState)
        .then(d => { if (alive) { setIndicators(d); if (retry) { clearInterval(retry); retry = undefined } } })
        .catch(() => { if (alive && !retry) retry = setInterval(load, 4000) })
    }
    load()
    return () => { alive = false; if (retry) clearInterval(retry) }
  }, [tfState])

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
      <div className="irid" />
      <div className="grain" />
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
          <span className={`pmode pmode-${priceMode}`} title="price feed">
            {priceMode === 'sse' ? 'SSE' : priceMode === 'ws' ? 'WS' : priceMode === 'rest' ? 'poll' : '…'}
          </span>
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
          {state.position ? (() => {
            const pos = state.position!
            const mark = wsPrice ?? pos.mark_price
            const upnl = (mark - pos.entry) * pos.qty
            const upct = (mark / pos.entry - 1) * 100
            const green = upnl >= 0
            return (
            <div className="panel rise d4">
              <div className="head">
                <h2>Current Position</h2>
                <span className={`badge ${green ? 'buy' : 'sell'}`}>
                  {pos.side} · {green ? '+' : ''}{upnl.toFixed(2)} ({upct.toFixed(2)}%)
                </span>
              </div>
              <div className="pos-grid">
                <div className="pos-cell"><span className="pos-k">Entry</span><span className="pos-v">${pos.entry.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Qty (BTC)</span><span className="pos-v">{pos.qty}</span></div>
                <div className="pos-cell"><span className="pos-k">Mark</span><span className={`pos-v ${green ? 'pos' : 'neg'}`}>${mark.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span></div>
                <div className="pos-cell"><span className="pos-k">Unrealized P&L</span><span className={`pos-v ${green ? 'pos' : 'neg'}`}>{green ? '+' : ''}{upnl.toFixed(2)}</span></div>
                <div className="pos-cell"><span className="pos-k">Stop Loss</span><span className="pos-v neg">${pos.stop_loss.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Take Profit</span><span className="pos-v pos">${pos.take_profit.toLocaleString()}</span></div>
                <div className="pos-cell"><span className="pos-k">Risk / Reward</span><span className="pos-v">{pos.rr.toFixed(2)} : 1</span></div>
                <div className="pos-cell"><span className="pos-k">Opened</span><span className="pos-v">{pos.opened_at ? new Date(pos.opened_at).toLocaleString() : '—'}</span></div>
              </div>
            </div>
            )
          })() : (
            <div className="panel rise d4">
              <div className="head"><h2>Current Position</h2><span className="hint">flat · no open trade</span></div>
              <div className="empty">Bot is flat — watching for an entry signal.</div>
            </div>
          )}

          {/* CONNECTION banner — shows when the bot/tunnel is unreachable and
              auto-retries, so a transient blip never looks like a dead app. */}
          {connErr && (
            <div className="conn-banner">
              <span className="dot" /> Reconnecting to bot… <span className="muted">({connErr.slice(0, 60)})</span> — retrying automatically
            </div>
          )}

          {/* PRICE CHART — the coin you're trading (TradingView engine) */}
          <div className="panel rise d45">
            <div className="head">
              <h2>{state.symbol} · Price</h2>
              <div className="chart-tools">
                <div className="tf-switch">
                  {TIMEFRAMES.map(tf => (
                    <button key={tf} className={tfState === tf ? 'active' : ''} onClick={() => setTf(tf)}>{tf}</button>
                  ))}
                </div>
                <div className="ind-menu">
                  {([
                    ['ema20', 'EMA 20'], ['ema50', 'EMA 50'], ['breakout', 'Breakout'],
                    ['rsi', 'RSI'], ['macd', 'MACD'], ['sr', 'S/R'],
                  ] as [keyof IndicatorOpts, string][]).map(([key, label]) => (
                    <button key={key} className={opts[key] ? 'on' : ''} onClick={() => setOpts(o => ({ ...o, [key]: !o[key] }))}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  <span className="lg-buy">▲ buy</span> <span className="lg-sell">▼ sell</span> · <span style={{color:'#22d3ee'}}>entry</span> <span style={{color:'#f43f5e'}}>SL</span> <span style={{color:'#facc15'}}>TP</span> · <span style={{color:'#00d992'}}>S</span>/<span style={{color:'#fb565b'}}>R</span> zones · {klines ? klines.candles.length : 0} candles
                </span>
              </div>
            </div>
            {klines ? (
              <PriceChart klines={klines.candles} fills={fills} position={state.position} livePrice={wsPrice ?? state?.price ?? 0} interval={tfState} indicators={indicators} opts={opts} />
            ) : (
              <div className="empty">loading price chart…</div>
            )}
          </div>

          {/* STRATEGY + LIVE SIGNAL — what the bot is using and why it's holding/buying */}
          <div className="panel rise d5b">
            <div className="head">
              <h2>Strategy &amp; Live Signal</h2>
              <span className={`badge ${indicators?.signal === 'BUY' ? 'buy' : indicators?.signal === 'SELL' ? 'sell' : 'hold'}`}>
                {indicators?.signal ?? '…'}
              </span>
            </div>
            <div className="strat-row">
              <div className="strat-cell">
                <span className="k">Current signal</span>
                <span className="v">{indicators?.signal_reason ?? 'loading…'}</span>
              </div>
              <div className="strat-cell">
                <span className="k">Params ({strategies.current})</span>
                <span className="v">{Object.entries(state.strategy_params).map(([k,v]) => `${k}=${v}`).join('  ')}</span>
              </div>
              <div className="strat-cell">
                <span className="k">Last exit</span>
                <span className={`v ${state.last_exit ? (state.last_exit.reason.startsWith('TP') ? 'pos' : state.last_exit.reason.startsWith('STOP') || state.last_exit.reason.startsWith('SL') ? 'neg' : '') : ''}`}>
                  {state.last_exit ? `${state.last_exit.reason} @ ${state.last_exit.price.toLocaleString()}` : '—'}
                </span>
              </div>
            </div>
            <div className="strat-switch">
              <span className="k">Strategy:</span>
              <select
                className="strat-select"
                value={strategies.current}
                disabled={switching}
                onChange={async (e) => {
                  const key = e.target.value
                  setSwitching(true)
                  try {
                    await setStrategy(key)
                    setStrategies(s => ({ ...s, current: key }))
                  } catch { /* ignore */ }
                  finally { setSwitching(false) }
                }}
              >
                {Object.entries(strategies.list).map(([key, s]) => (
                  <option key={key} value={key}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="strat-desc">
              {strategies.list[strategies.current]?.desc}
            </div>
          </div>

          {/* CAPITAL LIMIT — how much USDT the bot may deploy per trade */}
          <div className="panel rise d5b">
            <div className="head">
              <h2>Trading Capital</h2>
              <span className="hint">max USDT the bot may use per trade</span>
            </div>
            <div className="cap-row">
              <span className="k">Capital limit (USDT)</span>
              <input
                className="cap-input"
                type="number"
                min={settings?.size_min ?? 10}
                step="1"
                value={capInput}
                onChange={(e) => { setCapInput(e.target.value); if (capError) setCapError('') }}
                disabled={capSaving}
              />
              <button className="cap-btn" onClick={saveCapital} disabled={capSaving || !capInput}>
                {capSaving ? 'saving…' : 'Set'}
              </button>
            </div>
            {capError ? (
              <div className="cap-note" style={{ color: 'var(--neg)', marginTop: 8 }}>{capError}</div>
            ) : (
            <div className="cap-note">
              Current limit: <b>${settings ? settings.max_capital.toFixed(2) : '—'}</b>
              {state ? ` · available USDT: $${state.usdt.toFixed(2)}` : ''}
              {settings && settings.max_capital < (settings.size_min ?? 10) ? ` · ⚠ below Binance min $${(settings.size_min ?? 10).toFixed(0)} — bot will hold` : ''}
            </div>
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

          {/* RISK — open exposure & per-trade risk */}
          {state && (() => {
            const pos = state.position
            const cap = settings?.max_capital ?? 25
            const riskUsd = pos ? (pos.entry - pos.stop_loss) * pos.qty : 0
            const rMult = pos && pos.entry > 0 ? (pos.mark_price / pos.entry - 1) / ((pos.entry - pos.stop_loss) / pos.entry) : 0
            return (
            <div className="panel rise d7b">
              <div className="head"><h2>Risk · Exposure</h2><span className="hint">per-trade risk vs your capital limit</span></div>
              <div className="risk-grid">
                <div className="risk-cell"><span className="rk">Capital limit</span><span className="rv">${cap.toFixed(0)}</span></div>
                <div className="risk-cell"><span className="rk">Open risk (SL)</span><span className={`rv ${riskUsd > 0 ? 'neg' : ''}`}>${riskUsd.toFixed(2)}</span></div>
                <div className="risk-cell"><span className="rk">Exposure</span><span className="rv">{pos ? '$' + (pos.qty * pos.mark_price).toFixed(2) : '$0'}</span></div>
                <div className="risk-cell"><span className="rk">R-multiple</span><span className="rv">{pos ? rMult.toFixed(2) + 'R' : '—'}</span></div>
                <div className="risk-cell"><span className="rk">Max loss if SL</span><span className="rv neg">{pos ? '-$' + ((pos.entry - pos.stop_loss) * pos.qty).toFixed(2) : '—'}</span></div>
                <div className="risk-cell"><span className="rk">Unrealized</span><span className={`rv ${pos && pos.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>{pos ? (pos.unrealized_pnl >= 0 ? '+' : '') + pos.unrealized_pnl.toFixed(2) : '—'}</span></div>
              </div>
            </div>
            )
          })()}

          {/* PERFORMANCE — win rate, profit factor, drawdown, expectancy */}
          {analytics && (
            <div className="panel rise d7c">
              <div className="head"><h2>Performance · Bot Stats</h2><span className="hint">{analytics.round_trips} round-trips</span></div>
              <div className="perf-grid">
                <div className="perf-card"><div className="pc-k">Win Rate</div><div className={`pc-v ${analytics.win_rate >= 50 ? 'pos' : 'neg'}`}>{analytics.win_rate}%</div><div className="pc-sub">{analytics.wins}W / {analytics.losses}L</div></div>
                <div className="perf-card"><div className="pc-k">Profit Factor</div><div className={`pc-v ${analytics.profit_factor >= 1 ? 'pos' : 'neg'}`}>{analytics.profit_factor}</div><div className="pc-sub">gross win / loss</div></div>
                <div className="perf-card"><div className="pc-k">Max Drawdown</div><div className="pc-v neg">-${analytics.max_drawdown}</div><div className="pc-sub">peak-to-trough</div></div>
                <div className="perf-card"><div className="pc-k">Expectancy</div><div className={`pc-v ${analytics.expectancy >= 0 ? 'pos' : 'neg'}`}>{analytics.expectancy >= 0 ? '+' : ''}{analytics.expectancy}</div><div className="pc-sub">avg per trade</div></div>
                <div className="perf-card"><div className="pc-k">Avg Win</div><div className="pc-v pos">${analytics.avg_win}</div><div className="pc-sub">avg hold {analytics.avg_hold_min}m</div></div>
                <div className="perf-card"><div className="pc-k">Avg Loss</div><div className="pc-v neg">-${analytics.avg_loss}</div><div className="pc-sub">largest -${analytics.largest_loss}</div></div>
              </div>
            </div>
          )}

          {/* BACKTEST — run strategy over history */}
          <div className="panel rise d7d">
            <div className="head"><h2>Backtest · Strategy vs History</h2><span className="hint">run on Binance DEMO klines</span></div>
            <div className="bt-row">
              <span className="k" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Window</span>
              <select className="bt-select" value={btDays} onChange={(e) => setBtDays(parseInt(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <button className="bt-btn" onClick={runBacktest} disabled={btLoading}>{btLoading ? 'running…' : 'Run backtest'}</button>
            </div>
            {backtest ? (
              <div>
                <div className="hint" style={{ marginBottom: 8 }}>{backtest.symbol} · {backtest.interval} · {backtest.days}d · best first</div>
                {backtest.results.map((r) => (
                  <div className="bar-row" key={r.strategy}>
                    <span className="bar-label">{r.strategy}</span>
                    <span className="bar-track"><span className={`bar-fill ${r.ret < 0 ? 'neg' : ''}`} style={{ width: `${Math.max(4, Math.min(100, (r.ret + 20) * 2))}%` }} /></span>
                    <span className={`bar-val ${r.ret < 0 ? 'neg' : 'pos'}`}>{r.ret >= 0 ? '+' : ''}{r.ret}% · {r.win_rate}%wr</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Press “Run backtest” to score each strategy over recent history.</div>
            )}
          </div>
        </>
      ) : (
        <div className="panel"><div className={connErr ? 'err' : 'empty'}>{connErr || 'connecting to trading engine…'}</div></div>
      )}
    </div>
  )
}
