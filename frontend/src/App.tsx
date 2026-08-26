import { useEffect, useState, useRef } from 'react'
import {
  fetchState,
  fetchFills,
  fetchKlines,
  fetchIndicators,
  fetchAnalytics,
  fetchBacktest,
  fetchStrategies,
  setSymbol,
  getApiUrl,
  setCustomApiUrl,
  fetchSignal,
  fetchRisk,
  fetchTAVerdict,
  postTriggerTARun,
  type Indicators,
  type Analytics,
  type Backtest,
  type Signal,
  type Risk,
  type TAVerdict,
} from './api'
import type { State, Fill, Klines } from './types'
import { type IndicatorOpts } from './components/PriceChart'
import SymbolSearch from './components/SymbolSearch'
import CommandPalette from './components/CommandPalette'

// Workspaces
import OverviewWorkspace from './components/Workspaces/OverviewWorkspace'
import TradeWorkspace from './components/Workspaces/TradeWorkspace'
import IntelligenceWorkspace from './components/Workspaces/IntelligenceWorkspace'
import ScannerWorkspace from './components/Workspaces/ScannerWorkspace'
import StrategiesWorkspace from './components/Workspaces/StrategiesWorkspace'
import PortfolioWorkspace from './components/Workspaces/PortfolioWorkspace'
import HistoryWorkspace from './components/Workspaces/HistoryWorkspace'

export type WorkspaceTab =
  | 'overview'
  | 'trade'
  | 'intelligence'
  | 'scanner'
  | 'strategies'
  | 'portfolio'
  | 'history'

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceTab>('overview')
  const [state, setState] = useState<State | null>(null)
  const [fills, setFills] = useState<Fill[]>([])
  const [klines, setKlines] = useState<Klines | null>(null)
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [tfState, setTf] = useState('15m')
  const [opts, setOpts] = useState<IndicatorOpts>({
    ema20: true,
    ema50: true,
    breakout: false,
    rsi: false,
    macd: false,
    sr: false,
  })
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [backtest, setBacktest] = useState<Backtest | null>(null)
  const [btDays, setBtDays] = useState(30)
  const [btLoading, setBtLoading] = useState(false)
  const [strategies, setStrategies] = useState<{
    current: string
    list: Record<string, { name: string; desc: string; params: Record<string, number> }>
  }>({ current: 'ema_trend', list: {} })

  const [signal, setSignal] = useState<Signal | null>(null)
  const [risk, setRisk] = useState<Risk | null>(null)
  const [verdict, setVerdict] = useState<TAVerdict | null>(null)

  const [online, setOnline] = useState(false)
  const [connErr, setConnErr] = useState<string | null>(null)
  const [showBridgeModal, setShowBridgeModal] = useState(false)
  const [customUrlInput, setCustomUrlInput] = useState('')
  const [showCmd, setShowCmd] = useState(false)

  const priceRef = useRef<HTMLSpanElement>(null)
  const prevPrice = useRef<number | null>(null)

  // 1. Initial and periodic load
  useEffect(() => {
    let alive = true
    const loadAll = async () => {
      try {
        const [s, f, k, ind, a, strats, sig, rsk, verd] = await Promise.all([
          fetchState(),
          fetchFills(),
          fetchKlines(tfState),
          fetchIndicators(tfState),
          fetchAnalytics().catch(() => null),
          fetchStrategies().catch(() => null),
          fetchSignal().catch(() => null),
          fetchRisk().catch(() => null),
          fetchTAVerdict().catch(() => null),
        ])
        if (!alive) return

        setState(s)
        setFills(f)
        setKlines(k)
        setIndicators(ind)
        if (a) setAnalytics(a)
        if (strats) setStrategies({ current: strats.current, list: strats.strategies })
        if (sig) setSignal(sig)
        if (rsk) setRisk(rsk)
        if (verd) setVerdict(verd)

        setOnline(true)
        setConnErr(null)
      } catch (err: any) {
        if (!alive) return
        setOnline(false)
        setConnErr(err?.message || 'Connection offline')
      }
    }

    loadAll()
    const int = setInterval(loadAll, 3000)
    return () => {
      alive = false
      clearInterval(int)
    }
  }, [tfState])

  // 2. Keyboard shortcut for Command Palette (⌘K / Ctrl+K and 1-7 numbers)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowCmd((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 3. Price flash animation
  useEffect(() => {
    if (state?.price && priceRef.current) {
      if (prevPrice.current !== null && prevPrice.current !== state.price) {
        const isUp = state.price >= prevPrice.current
        priceRef.current.classList.remove('up', 'down')
        void priceRef.current.offsetWidth
        priceRef.current.classList.add(isUp ? 'up' : 'down')
      }
      prevPrice.current = state.price
    }
  }, [state?.price])

  const runBacktest = async (days: number) => {
    try {
      setBtLoading(true)
      const res = await fetchBacktest(days)
      setBacktest(res)
    } catch {
      // ignore
    } finally {
      setBtLoading(false)
    }
  }

  const handleApplyAITargets = (sl: number | null, tp: number | null) => {
    window.dispatchEvent(new CustomEvent('pt-set-targets', { detail: { sl, tp } }))
  }

  const handleTriggerAI = async () => {
    try {
      await postTriggerTARun()
      setTimeout(async () => {
        const v = await fetchTAVerdict().catch(() => null)
        if (v) setVerdict(v)
      }, 1500)
    } catch {
      // ignore
    }
  }

  const activePos = state?.positions?.find((p) => p.symbol === state.symbol)
  const hasOpenPos = (activePos?.qty ?? 0) > 0.000001
  const usd = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="shell">
      {/* ── INTEGRATED APPLICATION HEADER ── */}
      <header className="topbar">
        {/* Brand & Terminal Identity */}
        <div className="brand">
          <div className="brand-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div>
            <div className="brand-title">
              THUNDOCS
              <span className="version-badge">QUANT TERMINAL V3</span>
            </div>
            <div className="brand-subtitle">AI-NATIVE ALGORITHMIC TRADING WORKSTATION</div>
          </div>
        </div>

        {/* Active Market Selector & Live Mark Price */}
        <div className="ticker-card">
          <SymbolSearch
            currentSymbol={state?.symbol ?? 'BTCUSDT'}
            onSymbolChange={async (sym) => {
              if (sym === state?.symbol) return
              try {
                await setSymbol(sym)
                const [s, k, ind] = await Promise.all([
                  fetchState(),
                  fetchKlines(tfState),
                  fetchIndicators(tfState),
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

        {/* Global Market Context Telemetry */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Regime Pill */}
          <div
            className={`ctx-pill ${
              state?.regime === 'trending'
                ? 'reg-trending'
                : state?.regime === 'ranging'
                ? 'reg-ranging'
                : 'reg-choppy'
            }`}
            title="Market Classification & Volatility Regime"
          >
            {state?.regime ? state.regime.toUpperCase() : 'CALIBRATING'}
          </div>

          {/* AI Consensus Pill */}
          <div
            style={{
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              background: verdict?.signal === 'BUY' ? 'var(--accent-soft)' : verdict?.signal === 'SELL' ? 'var(--negative-soft)' : 'var(--warn-soft)',
              color: verdict?.signal === 'BUY' ? 'var(--accent)' : verdict?.signal === 'SELL' ? 'var(--negative)' : 'var(--warn)',
              border: `1px solid ${verdict?.signal === 'BUY' ? 'var(--accent-border)' : verdict?.signal === 'SELL' ? 'var(--negative-border)' : 'var(--warn-border)'}`,
            }}
            title="AI 7-Agent Research Consensus"
          >
            AI: {verdict?.signal || 'HOLD'} ({verdict?.rating || 3}/5★)
          </div>

          {/* Active Position Pill */}
          <div
            style={{
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              background: hasOpenPos ? ((activePos?.unrealized_pnl ?? 0) >= 0 ? 'var(--accent-soft)' : 'var(--negative-soft)') : 'var(--surface-2)',
              color: hasOpenPos ? ((activePos?.unrealized_pnl ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)') : 'var(--muted)',
              border: '1px solid var(--border)',
            }}
          >
            {hasOpenPos ? `POS: ${activePos?.side} (${(activePos?.unrealized_pnl ?? 0) >= 0 ? '+' : ''}$${activePos?.unrealized_pnl.toFixed(2)})` : 'FLAT'}
          </div>

          {/* Paper Engine Badge */}
          <div
            style={{
              padding: '3px 7px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 9.5,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              background: 'rgba(245, 158, 11, 0.1)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              letterSpacing: '0.04em',
            }}
          >
            ● PAPER ENGINE
          </div>
        </div>

        {/* Header Actions: Command Palette, Bridge & Health */}
        <div className="header-actions">
          <button
            className="btn-icon"
            onClick={() => setShowCmd(true)}
            title="Command Center (⌘K / Ctrl+K)"
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          >
            <span>⌘K</span>
          </button>

          <button
            className="btn-icon"
            onClick={() => {
              setCustomUrlInput(getApiUrl())
              setShowBridgeModal(true)
            }}
            title="Configure Cloudflare Tunnel URL"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>Bridge</span>
          </button>

          {/* Multi-Subsystem Health Status */}
          <div
            className="status-badge"
            title="System Pipeline: Market Feed ●, Quant Engine ●, AI Pipeline ●, Order Execution ●"
          >
            <span className={`status-dot ${online ? 'on' : 'off'}`} />
            <span style={{ fontSize: 10, color: 'var(--text-1)' }}>
              {online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>

      {/* ── WORKSPACE NAVIGATION (CLEAN TEXT TABS) ── */}
      <nav className="tabs-nav">
        {[
          ['overview', 'Overview'],
          ['trade', 'Trade & Execution'],
          ['intelligence', 'Multi-Agent AI'],
          ['scanner', 'Market Scanner'],
          ['strategies', 'Strategy Lab'],
          ['portfolio', 'Portfolio & Attribution'],
          ['history', `Trade History (${fills.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${workspace === key ? 'active' : ''}`}
            onClick={() => setWorkspace(key as WorkspaceTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── BRIDGE TUNNEL MODAL ── */}
      {showBridgeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.85)', display: 'grid', placeItems: 'center', padding: 16, backdropFilter: 'blur(8px)' }}>
          <div className="ws-panel" style={{ maxWidth: 480, width: '100%', background: 'var(--surface-3)', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
            <div className="card-header">
              <div className="card-title">Cloudflare Bridge Tunnel Configuration</div>
              <button className="btn-icon" onClick={() => setShowBridgeModal(false)}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.5 }}>
              Paste the live URL printed by <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>python start.py</code> on your machine to sync real-time engine state:
            </p>
            <input
              type="text"
              className="terminal-input"
              style={{ width: '100%', marginBottom: 14 }}
              placeholder="https://xxxx.trycloudflare.com"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
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
      )}

      {/* ── COMMAND PALETTE MODAL (⌘K) ── */}
      <CommandPalette
        open={showCmd}
        onClose={() => setShowCmd(false)}
        onSelectWorkspace={(ws) => setWorkspace(ws as WorkspaceTab)}
        onSelectSymbol={async (sym) => {
          try {
            await setSymbol(sym)
            const [s, k, ind] = await Promise.all([
              fetchState(),
              fetchKlines(tfState),
              fetchIndicators(tfState),
            ])
            setState(s)
            setKlines(k)
            setIndicators(ind)
          } catch {
            // ignore
          }
        }}
        onTriggerAI={handleTriggerAI}
        onOpenBridge={() => {
          setCustomUrlInput(getApiUrl())
          setShowBridgeModal(true)
        }}
      />

      {/* ── WORKSPACE SURFACE ROUTER ── */}
      {state ? (
        <main>
          {workspace === 'overview' && (
            <OverviewWorkspace
              state={state}
              signal={signal}
              risk={risk}
              verdict={verdict}
              fills={fills}
              klines={klines}
              indicators={indicators}
              tfState={tfState}
              setTf={setTf}
              opts={opts}
              setOpts={setOpts}
              onNavigateWorkspace={(ws) => setWorkspace(ws as WorkspaceTab)}
              onSelectSymbol={async (sym) => {
                await setSymbol(sym)
                setWorkspace('trade')
              }}
            />
          )}

          {workspace === 'trade' && (
            <TradeWorkspace
              state={state}
              klines={klines}
              indicators={indicators}
              tfState={tfState}
              setTf={setTf}
              opts={opts}
              setOpts={setOpts}
              fills={fills}
            />
          )}

          {workspace === 'intelligence' && (
            <IntelligenceWorkspace onApplyAITargets={handleApplyAITargets} />
          )}

          {workspace === 'scanner' && (
            <ScannerWorkspace
              onSelectSymbol={async (sym) => {
                await setSymbol(sym)
                setWorkspace('trade')
              }}
            />
          )}

          {workspace === 'strategies' && (
            <StrategiesWorkspace
              state={state}
              strategies={strategies}
              setStrategies={setStrategies}
              backtest={backtest}
              btDays={btDays}
              setBtDays={setBtDays}
              runBacktest={runBacktest}
              btLoading={btLoading}
            />
          )}

          {workspace === 'portfolio' && (
            <PortfolioWorkspace
              state={state}
              analytics={analytics}
              eq={state.equity_curve}
              fills={fills}
            />
          )}

          {workspace === 'history' && (
            <HistoryWorkspace fills={fills} />
          )}
        </main>
      ) : (
        <div className="ws-panel" style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="status-dot off" />
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--mono)', letterSpacing: '0.04em', color: 'var(--text-1)' }}>QUANTITATIVE ENGINE</span>
            <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--warn-soft)', color: 'var(--warn)', border: '1px solid var(--warn-border)' }}>{online ? 'CONNECTING' : 'OFFLINE'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
            {connErr ? `Stream unavailable — ${connErr}.` : 'Establishing real-time stream from local backend…'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 0, borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
            {[
              ['Market Data', online ? 'connecting' : 'down'],
              ['Quant Engine', 'ready'],
              ['AI Pipeline', 'ready'],
              ['Risk Gate', 'ready'],
              ['Order Execution', 'paper'],
            ].map(([name, st]) => (
              <div key={name} style={{ padding: '10px 14px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span className={`status-dot ${st === 'down' ? 'off' : st === 'paper' ? 'paper' : 'on'}`} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: st === 'down' ? 'var(--negative)' : 'var(--text-2)', textTransform: 'uppercase' }}>{st}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Run <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>python start.py</code> on your machine, then connect the tunnel:</span>
            <button className="btn-primary" onClick={() => { setCustomUrlInput(getApiUrl()); setShowBridgeModal(true) }}>Configure Bridge</button>
          </div>
        </div>
      )}
    </div>
  )

}
