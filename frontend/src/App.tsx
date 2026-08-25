import { useEffect, useRef, useState } from 'react'
import {
  fetchState,
  fetchFills,
  fetchKlines,
  fetchIndicators,
  fetchStrategies,
  setStrategy,
  fetchSettings,
  setSettings,
  setSymbol,
  Settings,
  fetchAnalytics,
  Analytics,
  fetchBacktest,
  Backtest,
  getApiUrl,
  setCustomApiUrl,
  postManualUpdate,
  postExitPosition
} from './api'
import { useLivePrice } from './useBinancePrice'
import SymbolSearch from './components/SymbolSearch'
import type { State, Fill, Klines } from './types'
import type { Indicators } from './api'
import type { IndicatorOpts } from './components/PriceChart'
import Kpi from './components/Kpi'
import EquityChart from './components/EquityChart'
import PriceChart from './components/PriceChart'
import TradeTable from './components/TradeTable'
import ManualTrade from './components/ManualTrade'
import SignalRisk from './components/SignalRisk'
import StrategyExplainer from './components/StrategyExplainer'
import Scanner from './components/Scanner'

export default function App() {
  const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w']
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [klines, setKlines] = useState<Klines | null>(null)
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [strategies, setStrategies] = useState<{
    current: string
    list: Record<string, { name: string; desc: string; params: Record<string, number> }>
  }>({ current: 'reversion', list: {} })
  const [switching, setSwitching] = useState(false)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [capInput, setCapInput] = useState('')
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState('')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [backtest, setBacktest] = useState<Backtest | null>(null)
  const [btDays, setBtDays] = useState(30)
  const [btLoading, setBtLoading] = useState(false)
  const [opts, setOpts] = useState<IndicatorOpts>({
    ema20: true,
    ema50: true,
    breakout: false,
    rsi: true,
    macd: true,
    sr: true
  })
  const [tfState, setTf] = useState('15m')
  const [online, setOnline] = useState(true)
  const [connErr, setConnErr] = useState('')
  const [showBridgeModal, setShowBridgeModal] = useState(false)
  const [customUrlInput, setCustomUrlInput] = useState('')

  // Live Position management state
  const [posAutoManage, setPosAutoManage] = useState(true)
  const [posSL, setPosSL] = useState('')
  const [posTP, setPosTP] = useState('')
  const [posBusy, setPosBusy] = useState(false)
  const [posToast, setPosToast] = useState<{ ok: boolean; text: string } | null>(null)

  const [activeTab, setActiveTab] = useState<
    'all' | 'perf' | 'tune' | 'backtest' | 'trades' | 'equity' | 'manual' | 'signal' | 'strategy' | 'scanner'
  >('all')

  const priceRef = useRef<HTMLSpanElement>(null)
  const prevPrice = useRef<number>(0)
  const tfRef = useRef(tfState)
  tfRef.current = tfState
  const cacheRef = useRef<Record<string, Klines>>({})

  // Real-time price stream
  const { price: wsPrice, mode: priceMode } = useLivePrice(state?.symbol || 'btcusdt')

  const activePos = state?.positions?.find(p => p.symbol === state?.symbol)

  // Pre-fetch all timeframes
  useEffect(() => {
    let alive = true
    TIMEFRAMES.forEach(iv => {
      fetchKlines(iv)
        .then(k => {
          if (alive) {
            cacheRef.current[iv] = k
            if (tfRef.current === iv) setKlines(k)
          }
        })
        .catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [])

  // Real-time price reflection
  useEffect(() => {
    if (wsPrice == null) return
    if (priceRef.current && prevPrice.current) {
      const up = wsPrice > prevPrice.current
      priceRef.current.className = 'ticker-price ' + (up ? 'up' : 'down')
    }
    prevPrice.current = wsPrice
    setState(s => (s ? { ...s, price: wsPrice } : s))
    setOnline(true)
  }, [wsPrice])

  // Periodic State & Fills poll
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
        if (retryId) {
          clearInterval(retryId)
          retryId = undefined
        }
      } catch (e) {
        if (!alive) return
        setConnErr(e instanceof Error ? e.message : 'offline')
        if (!retryId) retryId = setInterval(poll, 4000)
      }
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => {
      alive = false
      clearInterval(id)
      if (retryId) clearInterval(retryId)
    }
  }, [])

  // Periodic Candle poll
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
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // Timeframe change
  useEffect(() => {
    let alive = true
    const cached = cacheRef.current[tfState]
    if (cached) setKlines(cached)
    fetchKlines(tfState)
      .then(k => {
        if (alive) {
          cacheRef.current[tfState] = k
          if (tfRef.current === tfState) setKlines(k)
        }
      })
      .catch(() => {
        if (alive) setConnErr('chart data unreachable')
      })
    return () => {
      alive = false
    }
  }, [tfState])

  // Strategies list
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setInterval> | undefined
    const load = () => {
      fetchStrategies()
        .then(d => {
          if (alive) {
            setStrategies({ current: d.current, list: d.strategies })
            if (retry) {
              clearInterval(retry)
              retry = undefined
            }
          }
        })
        .catch(() => {
          if (alive && !retry) retry = setInterval(load, 4000)
        })
    }
    load()
    return () => {
      alive = false
      if (retry) clearInterval(retry)
    }
  }, [])

  // Settings poll
  useEffect(() => {
    let alive = true
    const load = () =>
      fetchSettings()
        .then(d => {
          if (alive) {
            setSettingsState(d)
            setCapInput(String(d.max_capital))
          }
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // Indicators poll
  useEffect(() => {
    let alive = true
    let retry: ReturnType<typeof setInterval> | undefined
    const load = () => {
      fetchIndicators(tfState)
        .then(d => {
          if (alive) {
            setIndicators(d)
            if (retry) {
              clearInterval(retry)
              retry = undefined
            }
          }
        })
        .catch(() => {
          if (alive && !retry) retry = setInterval(load, 4000)
        })
    }
    load()
    return () => {
      alive = false
      if (retry) clearInterval(retry)
    }
  }, [tfState])

  // Analytics poll
  useEffect(() => {
    let alive = true
    const load = () =>
      fetchAnalytics()
        .then(a => alive && setAnalytics(a))
        .catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // Sync inputs with live position or backend manual state
  useEffect(() => {
    if (state?.manual_state) {
      if (state.manual_state.sl != null) setPosSL(String(state.manual_state.sl))
      else if (activePos?.stop_loss) setPosSL(String(activePos.stop_loss))
      else setPosSL('')

      if (state.manual_state.tp != null) setPosTP(String(state.manual_state.tp))
      else if (activePos?.take_profit) setPosTP(String(activePos.take_profit))
      else setPosTP('')

      if (state.manual_state.auto_manage !== undefined) setPosAutoManage(state.manual_state.auto_manage)
    } else if (activePos) {
      if (activePos.stop_loss) setPosSL(String(activePos.stop_loss))
      if (activePos.take_profit) setPosTP(String(activePos.take_profit))
    }
  }, [state?.symbol, state?.manual_state, activePos?.stop_loss, activePos?.take_profit])

  const saveCapital = async () => {
    const v = parseFloat(capInput)
    if (isNaN(v) || v <= 0) {
      setCapError('Enter a positive number')
      return
    }
    const min = settings?.size_min ?? 10
    if (v < min) {
      setCapError(`Binance minimum order is $${min.toFixed(0)} USDT`)
      return
    }
    setCapSaving(true)
    setCapError('')
    try {
      const r = await setSettings(v)
      if (r.ok) {
        setSettingsState(s => (s ? { ...s, max_capital: r.max_capital } : s))
        setCapInput(String(r.max_capital))
      }
    } catch {
      /* ignore */
    } finally {
      setCapSaving(false)
    }
  }

  const runBacktest = async (days = btDays) => {
    setBtLoading(true)
    try {
      const b = await fetchBacktest(days)
      setBacktest(b)
    } catch {
      /* ignore */
    } finally {
      setBtLoading(false)
    }
  }

  const saveLivePosRules = async (overrideAuto?: boolean) => {
    if (!state?.symbol) return
    setPosBusy(true)
    setPosToast(null)
    try {
      const autoVal = overrideAuto !== undefined ? overrideAuto : posAutoManage
      const slVal = posSL ? parseFloat(posSL) : undefined
      const tpVal = posTP ? parseFloat(posTP) : undefined
      const res = await postManualUpdate(state.symbol, autoVal, slVal, tpVal)
      if (res.ok) {
        setPosToast({ ok: true, text: `Protection & Bot rules synced for ${state.symbol}` })
        const s = await fetchState()
        setState(s)
        setTimeout(() => setPosToast(null), 4000)
      } else {
        setPosToast({ ok: false, text: 'Failed to update position rules' })
      }
    } catch (e) {
      setPosToast({ ok: false, text: 'Update error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setPosBusy(false)
    }
  }

  const emergencyExitLive = async () => {
    if (!state?.symbol) return
    setPosBusy(true)
    setPosToast(null)
    try {
      const res = await postExitPosition(state.symbol)
      if (res.ok) {
        setPosToast({ ok: true, text: `Position closed: ${res.qty} ${state.symbol} @ $${res.price.toLocaleString()}` })
        const s = await fetchState()
        setState(s)
        const f = await fetchFills()
        setFills(f)
        setTimeout(() => setPosToast(null), 4000)
      } else {
        setPosToast({ ok: false, text: 'Exit execution failed' })
      }
    } catch (e) {
      setPosToast({ ok: false, text: 'Exit error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setPosBusy(false)
    }
  }

  const eq = state?.equity_curve ?? []
  const usd = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pnl = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)
  const pf = state?.portfolio

  const GlTile = ({ title, gain, loss, net }: { title: string; gain: number; loss: number; net: number }) => (
    <div className="gl-tile">
      <div className="gl-title">{title}</div>
      <div className="gl-row">
        <span className="gl-k">Gross Gain</span>
        <span className="gl-v pos">{usd(gain)}</span>
      </div>
      <div className="gl-row">
        <span className="gl-k">Gross Loss</span>
        <span className="gl-v neg">{usd(loss)}</span>
      </div>
      <div className="gl-row total">
        <span className="gl-k">Net Result</span>
        <span className={`gl-v ${net >= 0 ? 'pos' : 'neg'}`}>{pnl(net)}</span>
      </div>
    </div>
  )

  return (
    <div className="shell">
      {/* TOPBAR / COMMAND HEADER */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div className="brand-title">
              THUNDOC
              <span className="version-badge">DEMO v2.4</span>
            </div>
            <div className="brand-subtitle">ALGORITHMIC QUANT TERMINAL · BINANCE PAPER ENGINE</div>
          </div>
        </div>

        <div className="ticker-card">
          <SymbolSearch
            currentSymbol={state?.symbol ?? 'BTCUSDT'}
            onSymbolChange={async sym => {
              if (sym === state?.symbol) return
              try {
                await setSymbol(sym)
                const [s, k, ind] = await Promise.all([
                  fetchState(),
                  fetchKlines(tfState),
                  fetchIndicators(tfState)
                ])
                setState(s)
                setKlines(k)
                setIndicators(ind)
              } catch (err) {
                console.error('Failed to set symbol', err)
              }
            }}
          />
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <span className="ticker-price" ref={priceRef}>
            {state ? usd(state.price) : '—'}
          </span>
        </div>

        <div className="header-actions">
          <button
            className="btn-icon"
            onClick={() => {
              setCustomUrlInput(getApiUrl())
              setShowBridgeModal(true)
            }}
            title="Configure Backend Connection URL"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>Bridge</span>
          </button>
          <div className="status-badge">
            <span className={`status-dot ${online ? 'on' : 'off'}`} />
            <span>{online ? (state ? new Date(state.updated).toLocaleTimeString() : 'Live') : 'Offline'}</span>
            <span className="feed-chip" title={`Feed Protocol: ${priceMode.toUpperCase()}`}>
              {priceMode}
            </span>
          </div>
        </div>
      </header>

      {/* BRIDGE MODAL */}
      {showBridgeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.85)', display: 'grid', placeItems: 'center', padding: 16, backdropFilter: 'blur(8px)' }}>
          <div className="card-bezel" style={{ maxWidth: 480, width: '100%' }}>
            <div className="card-inner">
              <div className="card-header">
                <div className="card-title">Cloudflare Bridge Tunnel</div>
                <button className="btn-icon" onClick={() => setShowBridgeModal(false)}>✕</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.5 }}>
                Paste the live URL printed by <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>python start.py</code> on your machine to sync real-time state:
              </p>
              <input
                type="text"
                className="terminal-input"
                style={{ width: '100%', marginBottom: 14 }}
                placeholder="https://xxxx.trycloudflare.com"
                value={customUrlInput}
                onChange={e => setCustomUrlInput(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setShowBridgeModal(false)}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setCustomApiUrl(customUrlInput)
                    setShowBridgeModal(false)
                    window.location.reload()
                  }}
                >
                  Save &amp; Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {state ? (
        <>
          {/* MARKET CONTEXT STRIP */}
          <div className="ctx-strip">
            <div className="ctx-item">
              <span className="ctx-k">Market Regime:</span>
              <span
                className={`ctx-pill ${
                  state.regime === 'trending'
                    ? 'reg-trending'
                    : state.regime === 'ranging'
                    ? 'reg-ranging'
                    : 'reg-choppy'
                }`}
              >
                {state.regime ?? 'ANALYZING'}
              </span>
            </div>
            <div className="ctx-item">
              <span className="ctx-k">Regime Score:</span>
              <span className="ctx-v">{state.regime_score?.toFixed(1) ?? '—'}/100</span>
            </div>
            <div className="ctx-item">
              <span className="ctx-k">RSI (14):</span>
              <span className="ctx-v">{indicators?.rsi[indicators.rsi.length - 1]?.toFixed(1) ?? '—'}</span>
            </div>
            <div className="ctx-item">
              <span className="ctx-k">Volatility (ATR):</span>
              <span className="ctx-v">${state.atr?.toFixed(2) ?? '—'}</span>
            </div>
            <div className="ctx-hint">
              Engine active on <b style={{ color: 'var(--text)' }}>{state.symbol}</b>
            </div>
          </div>

          {/* BENTO HERO: CHART + TELEMETRY SPLIT */}
          <div className="bento-hero">
            {/* Left: Main Candlestick Chart */}
            <div className="card-bezel chart-panel">
              <div className="card-inner" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div className="chart-toolbar">
                  <div className="tf-group">
                    {TIMEFRAMES.map(tf => (
                      <button
                        key={tf}
                        className={`tf-btn ${tfState === tf ? 'active' : ''}`}
                        onClick={() => setTf(tf)}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>

                  <div className="ind-group">
                    {(
                      [
                        ['ema20', 'EMA 20'],
                        ['ema50', 'EMA 50'],
                        ['breakout', 'Breakout'],
                        ['rsi', 'RSI'],
                        ['macd', 'MACD'],
                        ['sr', 'S/R']
                      ] as [keyof IndicatorOpts, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={`ind-chip ${opts[key] ? 'on' : ''}`}
                        onClick={() => setOpts(o => ({ ...o, [key]: !o[key] }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {klines ? (
                  <PriceChart
                    klines={klines.candles}
                    fills={fills}
                    position={(state.positions?.find(p => p.symbol === state.symbol) as any) || null}
                    livePrice={wsPrice ?? state?.price ?? 0}
                    interval={tfState}
                    indicators={indicators}
                    opts={opts}
                  />
                ) : (
                  <div className="state-empty">Loading real-time candlesticks…</div>
                )}
              </div>
            </div>

            {/* Right: Live Position & Signal Telemetry */}
            <div className="telemetry-column">
              {/* Position Card */}
              <div className="card-bezel">
                <div className="card-inner pos-hero-card">
                  <div className="card-header">
                    <div className="card-title">
                      <span className="dot-indicator" />
                      Live Position
                    </div>
                    <span className={`pos-badge ${activePos ? 'long' : 'flat'}`}>
                      {activePos ? `${activePos.side} ACTIVE` : 'FLAT / NO POSITION'}
                    </span>
                  </div>

                  {activePos ? (() => {
                    const pos = activePos
                    const mark = wsPrice ?? pos.mark_price
                    const upnl = (mark - pos.entry) * pos.qty
                    const upct = (mark / pos.entry - 1) * 100
                    const isGreen = upnl >= 0
                    return (
                      <>
                        <div className="pos-pnl-headline">
                          <span className="pos-pnl-label">Unrealized P&L</span>
                          <span className={`pos-pnl-amount ${isGreen ? 'pos' : 'neg'}`}>
                            {isGreen ? '+' : ''}${upnl.toFixed(2)} ({isGreen ? '+' : ''}{upct.toFixed(2)}%)
                          </span>
                        </div>

                        <div className="ladder-tracker">
                          <div className="ladder-row">
                            <span className="ladder-k">Entry Price</span>
                            <span className="ladder-v">${pos.entry.toLocaleString()}</span>
                          </div>
                          <div className="ladder-row">
                            <span className="ladder-k">Current Mark</span>
                            <span className="ladder-v mark">${mark.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="ladder-row">
                            <span className="ladder-k">Stop Loss (SL)</span>
                            <span className="ladder-v sl">
                              {pos.stop_loss ? (
                                <>
                                  ${pos.stop_loss.toLocaleString()}{' '}
                                  <span style={{ fontSize: 10, opacity: 0.85 }}>
                                    ({(pos.stop_loss - pos.entry) * pos.qty >= 0 ? '+' : ''}
                                    ${((pos.stop_loss - pos.entry) * pos.qty).toFixed(2)})
                                  </span>
                                </>
                              ) : (
                                'Not Set'
                              )}
                            </span>
                          </div>
                          <div className="ladder-row">
                            <span className="ladder-k">Take Profit (TP)</span>
                            <span className="ladder-v tp">
                              {pos.take_profit ? (
                                <>
                                  ${pos.take_profit.toLocaleString()}{' '}
                                  <span style={{ fontSize: 10, opacity: 0.85 }}>
                                    ({(pos.take_profit - pos.entry) * pos.qty >= 0 ? '+' : ''}
                                    ${((pos.take_profit - pos.entry) * pos.qty).toFixed(2)})
                                  </span>
                                </>
                              ) : (
                                'Not Set'
                              )}
                            </span>
                          </div>
                          <div className="ladder-row">
                            <span className="ladder-k">Risk / Reward</span>
                            <span className="ladder-v">{(pos.rr || 0) > 0 ? `${(pos.rr || 0).toFixed(2)} : 1` : '—'}</span>
                          </div>
                          <div className="ladder-row">
                            <span className="ladder-k">Position Size</span>
                            <span className="ladder-v">{pos.qty} {pos.symbol.replace('USDT', '')} (${(pos.qty * mark).toFixed(2)})</span>
                          </div>
                        </div>

                        {/* Interactive Bot Takeover & Protection Box */}
                        <div className="bot-control-box">
                          <div className="bot-control-header">
                            <div className="bot-control-title">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="10" rx="2" ry="2"/>
                                <circle cx="12" cy="5" r="2"/>
                                <path d="M12 7v4"/>
                                <line x1="8" y1="16" x2="8" y2="16"/>
                                <line x1="16" y1="16" x2="16" y2="16"/>
                              </svg>
                              <span>Bot Auto-Pilot &amp; Trailing</span>
                            </div>
                            <div
                              className="toggle-switch-container"
                              onClick={() => {
                                const next = !posAutoManage
                                setPosAutoManage(next)
                                saveLivePosRules(next)
                              }}
                              title="Toggle between autonomous AI management and manual execution"
                            >
                              <span style={{ fontSize: 10, fontWeight: 800, color: posAutoManage ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--mono)' }}>
                                {posAutoManage ? 'AUTONOMOUS' : 'MANUAL'}
                              </span>
                              <div className={`toggle-switch ${posAutoManage ? 'on' : ''}`}>
                                <div className="toggle-switch-handle" />
                              </div>
                            </div>
                          </div>

                          {/* Quick Stop Loss & Take Profit Adjusters */}
                          <div className="quick-inputs-grid">
                            <div className="input-field-wrap">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label className="input-field-label">Stop Loss ($)</label>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  {[-2, -5].map(pct => (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => setPosSL((pos.entry * (1 + pct / 100)).toFixed(2))}
                                      style={{ fontSize: 9, padding: '1px 4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--negative)', fontFamily: 'var(--mono)', cursor: 'pointer' }}
                                    >
                                      {pct}%
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <input
                                type="number"
                                value={posSL}
                                placeholder="Set SL price"
                                onChange={e => setPosSL(e.target.value)}
                                className="terminal-input"
                              />
                              {posSL && !isNaN(parseFloat(posSL)) && (
                                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 4, fontWeight: 700, color: (parseFloat(posSL) - pos.entry) * pos.qty <= 0 ? 'var(--negative)' : 'var(--accent)' }}>
                                  Est. Loss: {(parseFloat(posSL) - pos.entry) * pos.qty <= 0 ? '' : '+'}${((parseFloat(posSL) - pos.entry) * pos.qty).toFixed(2)} ({(((parseFloat(posSL) / pos.entry) - 1) * 100) >= 0 ? '+' : ''}{(((parseFloat(posSL) / pos.entry) - 1) * 100).toFixed(2)}%)
                                </div>
                              )}
                            </div>

                            <div className="input-field-wrap">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label className="input-field-label">Take Profit ($)</label>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  {[5, 10].map(pct => (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => setPosTP((pos.entry * (1 + pct / 100)).toFixed(2))}
                                      style={{ fontSize: 9, padding: '1px 4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--accent)', fontFamily: 'var(--mono)', cursor: 'pointer' }}
                                    >
                                      +{pct}%
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <input
                                type="number"
                                value={posTP}
                                placeholder="Set TP price"
                                onChange={e => setPosTP(e.target.value)}
                                className="terminal-input"
                              />
                              {posTP && !isNaN(parseFloat(posTP)) && (
                                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 4, fontWeight: 700, color: (parseFloat(posTP) - pos.entry) * pos.qty >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                                  Est. Profit: {(parseFloat(posTP) - pos.entry) * pos.qty >= 0 ? '+' : ''}${((parseFloat(posTP) - pos.entry) * pos.qty).toFixed(2)} ({(((parseFloat(posTP) / pos.entry) - 1) * 100) >= 0 ? '+' : ''}{(((parseFloat(posTP) / pos.entry) - 1) * 100).toFixed(2)}%)
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8, marginTop: 2 }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={posBusy}
                              onClick={() => saveLivePosRules()}
                              style={{ padding: '7px 10px', fontSize: 11 }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                <polyline points="17 21 17 13 7 13 7 21"/>
                                <polyline points="7 3 7 8 15 8"/>
                              </svg>
                              Sync Protection
                            </button>
                            <button
                              type="button"
                              className="btn-danger"
                              disabled={posBusy}
                              onClick={emergencyExitLive}
                              style={{ padding: '7px 10px', fontSize: 11 }}
                            >
                              Exit Market
                            </button>
                          </div>

                          {/* Feedback Toast */}
                          {posToast && (
                            <div className={`toast-msg ${posToast.ok ? 'success' : 'error'}`} style={{ fontSize: 11, padding: '6px 10px' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                {posToast.ok ? <path d="M20 6L9 17l-5-5"/> : <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>}
                              </svg>
                              <span>{posToast.text}</span>
                            </div>
                          )}
                        </div>
                      </>
                    )
                  })() : (
                    <div className="state-empty" style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>Engine Flat · No Open Position</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 260, lineHeight: 1.4, textAlign: 'center' }}>
                        Awaiting algorithmic signal setup or enter manually below.
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={() => setActiveTab('manual')}
                        style={{ marginTop: 6, fontSize: 11, padding: '5px 12px' }}
                      >
                        Open Trade Ticket ↗
                      </button>
                    </div>
                  )}

                  {/* Signal Box */}
                  <div className="signal-box">
                    <div className="signal-row">
                      <span className="card-title" style={{ fontSize: 11 }}>Active Signal</span>
                      <span className={`signal-pill ${indicators?.signal === 'BUY' ? 'buy' : indicators?.signal === 'SELL' ? 'sell' : 'hold'}`}>
                        {indicators?.signal ?? 'HOLD'}
                      </span>
                    </div>
                    <div className="signal-reason">
                      {indicators?.signal_reason || 'Evaluating candles…'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Capital Manager Widget */}
              <div className="card-bezel">
                <div className="card-inner">
                  <div className="card-header">
                    <div className="card-title">Trading Capital</div>
                    <span className="card-hint">Limit per execution</span>
                  </div>

                  <div className="cap-input-row">
                    <input
                      className="cap-input"
                      type="number"
                      min={settings?.size_min ?? 10}
                      step="5"
                      value={capInput}
                      onChange={e => {
                        setCapInput(e.target.value)
                        if (capError) setCapError('')
                      }}
                      disabled={capSaving}
                      placeholder="USDT"
                    />
                    <button className="btn-primary" onClick={saveCapital} disabled={capSaving || !capInput}>
                      {capSaving ? 'Saving…' : 'Set Capital'}
                    </button>
                  </div>

                  {/* Quick Preset Pills */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    {[25, 50, 100, 250].map(preset => (
                      <button
                        key={preset}
                        onClick={() => {
                          setCapInput(String(preset))
                          if (capError) setCapError('')
                        }}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-2)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: 'var(--mono)',
                          cursor: 'pointer'
                        }}
                      >
                        ${preset}
                      </button>
                    ))}
                  </div>

                  {capError ? (
                    <div style={{ color: 'var(--negative)', fontSize: 11.5, marginTop: 8, fontWeight: 600 }}>
                      {capError}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                      Current limit: <b style={{ color: 'var(--text)' }}>${settings ? settings.max_capital.toFixed(2) : '—'}</b> · Available USDT: <b style={{ color: 'var(--text)' }}>${state.usdt.toFixed(2)}</b>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* FINANCIAL TELEMETRY: KPIS */}
          <div className="kpis-grid">
            <Kpi label="Total Funds" value={state.total_funds} fmt={usd} tone="plain" spark={eq.map(p => p.equity)} sub="Cash + Open Unrealized" />
            <Kpi label="Bot Net P&L" value={state.net_pnl} fmt={pnl} tone="auto" sub="Total Realized + Unrealized" />
            <Kpi label="Realized Profit" value={state.realized} fmt={pnl} tone="auto" sub="Closed Trades Only" />
            <Kpi label="USDT Cash" value={state.usdt} fmt={usd} tone="plain" sub="Free Wallet Balance" />
          </div>

          {/* PORTFOLIO GAIN / LOSS LEDGER */}
          {pf && (
            <div className="card-bezel" style={{ marginBottom: 20 }}>
              <div className="card-inner">
                <div className="card-header">
                  <div className="card-title">Portfolio Performance Ledger</div>
                  <span className="card-hint">
                    {state.creds_loaded ? 'Binance Demo Account' : '⚠ Demo Credentials Unset'}
                  </span>
                </div>
                <div className="portfolio-grid">
                  <GlTile title="Today" gain={pf.today_gain} loss={pf.today_loss} net={pf.today_net} />
                  <GlTile title="Yesterday" gain={pf.yesterday_gain} loss={pf.yesterday_loss} net={pf.yesterday_net} />
                  <GlTile title="Last 7 Days" gain={pf.week_gain} loss={pf.week_loss} net={pf.week_net} />
                </div>
              </div>
            </div>
          )}

          {/* INTELLIGENCE & EXECUTION HUB (TABS) */}
          <div className="card-bezel">
            <div className="card-inner">
              {/* Tab Navigation Bar */}
              <div className="tabs-nav">
                {[
                  ['all', 'Overview'],
                  ['perf', 'Performance Stats'],
                  ['tune', 'Strategy Review'],
                  ['backtest', 'Backtest Lab'],
                  ['signal', 'Signal & Risk'],
                  ['manual', 'Manual Trade'],
                  ['strategy', 'Strategy Explainer'],
                  ['scanner', 'Market Scanner'],
                  ['trades', `Trade History (${fills.length})`],
                  ['equity', 'Equity Curve']
                ].map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    className={`tab-btn ${activeTab === tabKey ? 'active' : ''}`}
                    onClick={() => setActiveTab(tabKey as any)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Strategy Switcher Bar */}
              <div className="strat-config-card">
                <div className="strat-field">
                  <label className="strat-label">Active Trading Strategy</label>
                  <select
                    className="strat-select"
                    value={strategies.current}
                    disabled={switching}
                    onChange={async e => {
                      const key = e.target.value
                      setSwitching(true)
                      try {
                        await setStrategy(key)
                        setStrategies(s => ({ ...s, current: key }))
                      } catch {
                        /* ignore */
                      } finally {
                        setSwitching(false)
                      }
                    }}
                  >
                    {Object.entries(strategies.list).map(([key, s]) => (
                      <option key={key} value={key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="strat-field">
                  <label className="strat-label">Live Parameters</label>
                  <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', paddingTop: 4 }}>
                    {Object.entries(state.strategy_params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('  ·  ')}
                  </div>
                </div>

                <div className="strat-field">
                  <label className="strat-label">Last Execution Exit</label>
                  <div
                    style={{
                      fontSize: 12,
                      fontFamily: 'var(--mono)',
                      color: state.last_exit?.reason.startsWith('TP')
                        ? 'var(--accent)'
                        : state.last_exit?.reason.startsWith('STOP')
                        ? 'var(--negative)'
                        : 'var(--text-2)',
                      paddingTop: 4
                    }}
                  >
                    {state.last_exit
                      ? `${state.last_exit.reason} @ $${state.last_exit.price.toLocaleString()}`
                      : 'No exits logged'}
                  </div>
                </div>
              </div>

              {/* TAB 1 / OVERVIEW: Performance Analytics */}
              {(activeTab === 'all' || activeTab === 'perf') && analytics && (
                <div style={{ marginBottom: 20 }}>
                  <div className="card-title" style={{ marginBottom: 12 }}>Performance &amp; Risk Analytics</div>
                  <div className="perf-grid">
                    <div className="perf-metric-card">
                      <span className="pm-k">Win Rate</span>
                      <span className={`pm-v ${analytics.win_rate >= 50 ? 'pos' : 'neg'}`}>
                        {analytics.win_rate.toFixed(1)}%
                      </span>
                      <span className="pm-sub">{analytics.wins}W / {analytics.losses}L · {analytics.round_trips} trades</span>
                    </div>

                    <div className="perf-metric-card">
                      <span className="pm-k">Profit Factor</span>
                      <span className={`pm-v ${analytics.profit_factor >= 1.5 ? 'pos' : analytics.profit_factor >= 1 ? '' : 'neg'}`}>
                        {analytics.profit_factor.toFixed(2)}
                      </span>
                      <span className="pm-sub">{analytics.profit_factor >= 1 ? 'Net Profitable' : 'Losing'}</span>
                    </div>

                    <div className="perf-metric-card">
                      <span className="pm-k">Max Drawdown</span>
                      <span className="pm-v neg">
                        {analytics.max_drawdown.toFixed(2)}%
                      </span>
                      <span className="pm-sub">Peak to trough</span>
                    </div>

                    <div className="perf-metric-card">
                      <span className="pm-k">Expectancy</span>
                      <span className={`pm-v ${analytics.expectancy >= 0 ? 'pos' : 'neg'}`}>
                        {analytics.expectancy >= 0 ? '+' : ''}${analytics.expectancy.toFixed(2)}
                      </span>
                      <span className="pm-sub">Avg per trade</span>
                    </div>

                    <div className="perf-metric-card">
                      <span className="pm-k">Avg Win / Loss</span>
                      <span className="pm-v">
                        <span className="pos">${analytics.avg_win.toFixed(2)}</span> / <span className="neg">${analytics.avg_loss.toFixed(2)}</span>
                      </span>
                      <span className="pm-sub">Ratio: {(analytics.avg_loss > 0 ? analytics.avg_win / analytics.avg_loss : 1).toFixed(2)}</span>
                    </div>

                    <div className="perf-metric-card">
                      <span className="pm-k">Avg Duration</span>
                      <span className="pm-v">
                        {analytics.avg_hold_min.toFixed(0)}m
                      </span>
                      <span className="pm-sub">Per completed trade</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2 / OVERVIEW: Strategy Self-Review */}
              {(activeTab === 'all' || activeTab === 'tune') && state.tune && (
                <div style={{ marginBottom: 20 }}>
                  <div className="card-title" style={{ marginBottom: 12 }}>Strategy Self-Review (Walk-Forward OOS)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    {state.tune.candidates.map((c, i) => (
                      <div
                        key={i}
                        className="card-bezel"
                        style={{
                          padding: 14,
                          borderLeft: `3px solid ${
                            c.strategy === state.tune!.best.strategy &&
                            JSON.stringify(c.params) === JSON.stringify(state.tune!.best.params)
                              ? 'var(--accent)'
                              : 'var(--border)'
                          }`
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{c.strategy}</div>
                        <div
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 18,
                            fontWeight: 800,
                            margin: '4px 0',
                            color: (c.test_ret ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)'
                          }}
                        >
                          {(c.test_ret ?? 0) >= 0 ? '+' : ''}
                          {(c.test_ret ?? 0).toFixed(2)}%
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          OOS · {c.trades} trades · {c.win_rate}% WR
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: Backtest Lab */}
              {(activeTab === 'all' || activeTab === 'backtest') && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="card-title">Backtest Optimization Lab</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[7, 14, 30, 60].map(d => (
                        <button
                          key={d}
                          className="btn-secondary"
                          onClick={() => {
                            setBtDays(d)
                            runBacktest(d)
                          }}
                          disabled={btLoading}
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>

                  {backtest && (
                    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14 }}>
                      {backtest.results.slice(0, 5).map((r, i) => (
                        <div key={i} className="bt-bar-row">
                          <span className="bt-bar-label">{r.strategy}</span>
                          <div className="bt-bar-track">
                            <div
                              className={`bt-bar-fill ${r.ret < 0 ? 'neg' : ''}`}
                              style={{ width: `${Math.min(Math.abs(r.ret) * 4, 100)}%` }}
                            />
                          </div>
                          <span className="bt-bar-val" style={{ color: r.ret >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                            {r.ret >= 0 ? '+' : ''}{r.ret.toFixed(2)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: Signal & Risk */}
              {(activeTab === 'all' || activeTab === 'signal') && (
                <div style={{ marginBottom: 20 }}>
                  <SignalRisk />
                </div>
              )}

              {/* TAB: Manual Trade */}
              {(activeTab === 'all' || activeTab === 'manual') && (
                <div style={{ marginBottom: 20 }}>
                  <ManualTrade state={state} fills={fills} />
                </div>
              )}

              {/* TAB: Scanner */}
              {(activeTab === 'all' || activeTab === 'scanner') && (
                <div style={{ marginBottom: 20 }}>
                  <Scanner
                    onSelectSymbol={async sym => {
                      if (sym === state?.symbol) {
                        setActiveTab('all')
                        return
                      }
                      try {
                        await setSymbol(sym)
                        const [s, k, ind] = await Promise.all([
                          fetchState(),
                          fetchKlines(tfState),
                          fetchIndicators(tfState)
                        ])
                        setState(s)
                        setKlines(k)
                        setIndicators(ind)
                        setActiveTab('all')
                      } catch (err) {
                        console.error('Failed to set symbol', err)
                      }
                    }}
                  />
                </div>
              )}

              {/* TAB: Strategy Explainer */}
              {(activeTab === 'all' || activeTab === 'strategy') && (
                <div style={{ marginBottom: 20 }}>
                  <StrategyExplainer />
                </div>
              )}

              {/* TAB: Trade History */}
              {(activeTab === 'all' || activeTab === 'trades') && (
                <div style={{ marginBottom: 20 }}>
                  <TradeTable fills={fills} />
                </div>
              )}

              {/* TAB: Equity Curve */}
              {(activeTab === 'all' || activeTab === 'equity') && (
                <div style={{ marginBottom: 20 }}>
                  <EquityChart data={eq} />
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card-bezel">
          <div className="card-inner state-empty" style={{ padding: '60px 24px' }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 16px'
              }}
            />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Connecting to Trading Engine...</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Awaiting communication bridge from local backend
            </div>
            {connErr && (
              <div style={{ marginTop: 16 }}>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setCustomUrlInput(getApiUrl())
                    setShowBridgeModal(true)
                  }}
                >
                  Configure Bridge URL
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
