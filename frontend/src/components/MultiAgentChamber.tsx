import { useEffect, useState } from 'react'
import { fetchTAVerdict, postTriggerTARun, type TAVerdict } from '../api'

function timeSince(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    return `${h}h ${m}m ago`
  } catch {
    return dateStr
  }
}

// Vector Line Icons (Zero cartoon emojis)
const Icons = {
  Cpu: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  ),
  Zap: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  TrendingUp: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  TrendingDown: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  Activity: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  Globe: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Swords: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /><line x1="19" y1="21" x2="21" y2="19" />
    </svg>
  ),
  Shield: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Layers: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  Scale: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  ),
  Terminal: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Check: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Refresh: ({ spinning }: { spinning?: boolean }) => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: spinning ? 'spin 0.8s linear infinite' : 'none' }}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
}

export default function MultiAgentChamber({
  onApplyAITargets,
}: {
  onApplyAITargets?: (sl: number | null, tp: number | null) => void
}) {
  const [verdict, setVerdict] = useState<TAVerdict | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [activeAgentTab, setActiveAgentTab] = useState<string>('overview')
  const [synced, setSynced] = useState(false)

  const loadVerdict = async () => {
    try {
      const data = await fetchTAVerdict()
      setVerdict(data)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadVerdict()
    const interval = setInterval(loadVerdict, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleTriggerRun = async () => {
    try {
      setTriggering(true)
      const res = await postTriggerTARun()
      if (res.ok) {
        setTimeout(loadVerdict, 1500)
      }
    } catch (err: any) {
      alert(`Trigger failed: ${err?.message || err}`)
    } finally {
      setTimeout(() => setTriggering(false), 2000)
    }
  }

  const handleSyncTargets = () => {
    if (onApplyAITargets && verdict) {
      onApplyAITargets(verdict.stop_loss ?? null, verdict.target_price ?? null)
      setSynced(true)
      setTimeout(() => setSynced(false), 2000)
    }
  }

  const signal = verdict?.signal || 'HOLD'
  const isBuy = signal === 'BUY'
  const isSell = signal === 'SELL'

  const signalColor = isBuy ? '#10b981' : isSell ? '#ef4444' : '#f59e0b'
  const rating = verdict?.rating || 3
  const confidencePct = verdict?.confidence
    ? Math.round(verdict.confidence * 100)
    : rating * 20
  const isAnalyzing = verdict?.is_analyzing || triggering

  const marketSummary =
    verdict?.analyst_summaries?.market ||
    verdict?.agents?.market_analyst?.summary ||
    'Evaluating price action, EMA bands, RSI oscillator, and volume dynamics.'
  const sentimentSummary =
    verdict?.analyst_summaries?.sentiment ||
    verdict?.agents?.sentiment_analyst?.summary ||
    'Analyzing community sentiment, social polarity ratio, and retail positioning.'
  const newsSummary =
    verdict?.analyst_summaries?.news ||
    verdict?.agents?.news_analyst?.summary ||
    'Tracking ETF flows, interest rate trajectory, and global regulatory developments.'
  const bullCase =
    verdict?.bull_case ||
    verdict?.agents?.bull_researcher?.thesis ||
    'Sustained accumulation above $77,500 with higher lows establishes strong base for retest of $81,500 liquidity sweep.'
  const bearCase =
    verdict?.bear_case ||
    verdict?.agents?.bear_researcher?.thesis ||
    'Volume divergence at $80,000 resistance and open interest clustering create risk of liquidation cascade toward $76,000 support.'

  const refPrice = verdict?.entry_reference_price ?? 77995.73
  const tpPrice = verdict?.target_price ?? 81500.0
  const slPrice = verdict?.stop_loss ?? 76400.0

  const tpPct = refPrice ? (((tpPrice - refPrice) / refPrice) * 100).toFixed(2) : '4.49'
  const slPct = refPrice ? (((slPrice - refPrice) / refPrice) * 100).toFixed(2) : '-2.05'

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'inset 0 1px 0 var(--border-highlight), 0 8px 32px rgba(0, 0, 0, 0.45)',
        padding: 20,
        marginBottom: 20,
      }}
    >
      {/* ── TOP HEADER ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border)',
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              color: '#60a5fa',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icons.Cpu />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: '0.04em', color: 'var(--text)', textTransform: 'uppercase' }}>
                Multi-Agent Intelligence Chamber
              </span>
              <span
                style={{
                  fontSize: 9.5,
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  fontFamily: 'var(--mono)',
                }}
              >
                7 AGENT MESH
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              TauricResearch TradingAgents · LLM Consensus Engine
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--mono)',
              color: isAnalyzing ? 'var(--warn)' : 'var(--accent)',
              background: isAnalyzing ? 'var(--warn-soft)' : 'var(--accent-soft)',
              border: `1px solid ${isAnalyzing ? 'var(--warn-border)' : 'var(--accent-border)'}`,
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isAnalyzing ? 'var(--warn)' : 'var(--accent)',
                boxShadow: `0 0 6px ${isAnalyzing ? 'var(--warn)' : 'var(--accent)'}`,
              }}
            />
            <span>{isAnalyzing ? 'Analyzing Market…' : `Consensus Active (${timeSince(verdict?.ts ?? null)})`}</span>
          </div>

          <button
            className="btn-primary"
            onClick={handleTriggerRun}
            disabled={isAnalyzing}
            style={{
              padding: '6px 13px',
              fontSize: 11.5,
              fontWeight: 700,
              background: isAnalyzing ? 'var(--surface)' : 'var(--accent)',
              color: isAnalyzing ? 'var(--muted)' : '#04130b',
            }}
          >
            <Icons.Refresh spinning={isAnalyzing} />
            <span>{isAnalyzing ? 'Processing Turn…' : 'Run Consensus Cycle'}</span>
          </button>
        </div>
      </div>

      {/* ── BENTO HERO: SUPREME VERDICT & TACTICAL MATRIX ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1.25fr) minmax(320px, 1fr)',
          gap: 14,
          marginBottom: 16,
        }}
      >
        {/* Left: Supreme Consensus Verdict Card */}
        <div
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'inset 0 1px 0 var(--border-highlight)',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="card-title" style={{ margin: 0 }}>AI Consensus &amp; Risk Judge Decision</span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--mono)',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                }}
              >
                {verdict?.ticker || 'BTC-USD'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  fontFamily: 'var(--mono)',
                  letterSpacing: '0.04em',
                  color: signalColor,
                  textShadow: `0 0 20px ${signalColor}33`,
                }}
              >
                {signal}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', lineHeight: 1.4 }}>
                {signal === 'BUY'
                  ? 'Execute Long / Confluence Breakout Confirmed'
                  : signal === 'SELL'
                  ? 'Execute Short / Downside Liquidity Sweep Risk'
                  : 'Maintain Neutral / Await Confluence Breakout'}
              </div>
            </div>

            {/* Segmented Conviction Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((lvl) => {
                  const active = lvl <= rating
                  return (
                    <div
                      key={lvl}
                      style={{
                        width: 24,
                        height: 6,
                        borderRadius: 2,
                        background: active ? signalColor : 'var(--surface)',
                        border: `1px solid ${active ? signalColor : 'var(--border)'}`,
                        boxShadow: active ? `0 0 6px ${signalColor}66` : 'none',
                        transition: 'all 0.25s ease',
                      }}
                    />
                  )
                })}
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)' }}>
                {confidencePct}% Conviction
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                (Rating: {rating}/5)
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10.5,
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              borderTop: '1px solid var(--border)',
              paddingTop: 10,
              marginTop: 4,
            }}
          >
            <span>Model: <b style={{ color: 'var(--text-2)' }}>{verdict?.deep_model || 'nvidia/nemotron-3.5-lightning:free'}</b></span>
            <span>Cadence: <b style={{ color: 'var(--text-2)' }}>Every 4h</b></span>
          </div>
        </div>

        {/* Right: Tactical Targets & Bot Bridge Matrix */}
        <div
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'inset 0 1px 0 var(--border-highlight)',
          }}
        >
          <div>
            <div className="card-title" style={{ marginBottom: 12 }}>Tactical Risk &amp; Targets</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
              {/* Reference Price */}
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Reference Price</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                  ${refPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              {/* Target Price */}
              <div style={{ background: 'var(--panel)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700 }}>Target Price (TP)</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: 'var(--accent)', marginTop: 2 }}>
                  ${tpPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--accent)', fontFamily: 'var(--mono)', marginTop: 1 }}>+{tpPct}%</div>
              </div>

              {/* Stop Loss */}
              <div style={{ background: 'var(--panel)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--negative)', fontWeight: 700 }}>Stop Loss (SL)</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: 'var(--negative)', marginTop: 2 }}>
                  ${slPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--negative)', fontFamily: 'var(--mono)', marginTop: 1 }}>{slPct}%</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '1px solid var(--border)',
              paddingTop: 10,
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Capital Sizing: <b style={{ color: 'var(--text)' }}>25% Max Allocation</b>
            </span>
            <button
              className="btn-secondary"
              onClick={handleSyncTargets}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                color: synced ? 'var(--accent)' : 'var(--warn)',
                borderColor: synced ? 'var(--accent)' : 'var(--warn-border)',
                background: synced ? 'var(--accent-soft)' : 'var(--warn-soft)',
              }}
            >
              {synced ? <Icons.Check /> : <Icons.Zap />}
              <span>{synced ? 'Synced to Engine!' : 'Sync Targets to Bot'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 3-STAGE PIPELINE STEPPER ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="card-title" style={{ margin: 0 }}>Multi-Agent Consensus Pipeline</span>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>SELECT STAGE TO FILTER BRIEFING</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {/* Stage 1 */}
          <div
            onClick={() => setActiveAgentTab('technical')}
            style={{
              background: activeAgentTab === 'technical' || activeAgentTab === 'sentiment' || activeAgentTab === 'macro' ? 'var(--surface)' : 'var(--bg-subtle)',
              border: `1px solid ${activeAgentTab === 'technical' || activeAgentTab === 'sentiment' || activeAgentTab === 'macro' ? 'var(--info-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
              <span style={{ color: 'var(--info)' }}><Icons.Activity /></span>
              <span>Stage 01: Intelligence</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>Market, Sentiment &amp; News</div>
          </div>

          {/* Stage 2 */}
          <div
            onClick={() => setActiveAgentTab('debate')}
            style={{
              background: activeAgentTab === 'debate' ? 'var(--surface)' : 'var(--bg-subtle)',
              border: `1px solid ${activeAgentTab === 'debate' ? '#c084fc' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
              <span style={{ color: '#c084fc' }}><Icons.Swords /></span>
              <span>Stage 02: Debate Arena</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>Bull Thesis vs. Bear Thesis</div>
          </div>

          {/* Stage 3 */}
          <div
            onClick={() => setActiveAgentTab('judge')}
            style={{
              background: activeAgentTab === 'judge' ? 'var(--surface)' : 'var(--bg-subtle)',
              border: `1px solid ${activeAgentTab === 'judge' ? 'var(--accent-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
              <span style={{ color: 'var(--accent)' }}><Icons.Shield /></span>
              <span>Stage 03: Risk Arbiter</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>Trader &amp; Risk Gatekeeper</div>
          </div>
        </div>
      </div>

      {/* ── SEGMENTED TAB FILTER BUTTONS ── */}
      <div className="tabs-nav" style={{ marginBottom: 14 }}>
        {[
          ['overview', 'Consensus Overview'],
          ['debate', 'Bull / Bear Debate'],
          ['technical', 'Technical Intel'],
          ['sentiment', 'Social Sentiment'],
          ['macro', 'Macro News'],
          ['judge', 'Risk Arbiter Decision'],
          ['steps', 'Live Step Stream'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${activeAgentTab === key ? 'active' : ''}`}
            onClick={() => setActiveAgentTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      {/* 1. Overview */}
      {activeAgentTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Dual Thesis Hero Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Bullish Researcher Card */}
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.05)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <Icons.TrendingUp />
                <span>Bullish Researcher Thesis</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                {bullCase}
              </div>
            </div>

            {/* Bearish Researcher Card */}
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, fontWeight: 800, color: 'var(--negative)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <Icons.TrendingDown />
                <span>Bearish Researcher Thesis</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                {bearCase}
              </div>
            </div>
          </div>

          {/* 3-Column Analyst Summaries */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {/* Market Analyst */}
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--info)', marginBottom: 6 }}>
                <Icons.Activity />
                <span>Technical Market Analyst</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{marketSummary}</div>
            </div>

            {/* Sentiment Analyst */}
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#c084fc', marginBottom: 6 }}>
                <Icons.Layers />
                <span>Social Sentiment Analyst</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{sentimentSummary}</div>
            </div>

            {/* Macro News Analyst */}
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
                <Icons.Globe />
                <span>Macro Catalyst Analyst</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{newsSummary}</div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Bull / Bear Debate */}
      {activeAgentTab === 'debate' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
              <Icons.TrendingUp />
              <span>Bullish Case Arguments</span>
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>{bullCase}</p>
          </div>

          <div style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: 'var(--negative)', marginBottom: 8 }}>
              <Icons.TrendingDown />
              <span>Bearish Case Arguments</span>
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>{bearCase}</p>
          </div>
        </div>
      )}

      {/* 3. Technical Intel */}
      {activeAgentTab === 'technical' && (
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Technical Momentum &amp; Price Action Intel</div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>{marketSummary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['RSI (14): 48.2', 'EMA-20: $77,950', 'EMA-50: $78,100', '14-ATR: $840'].map((ind) => (
              <span key={ind} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4. Social Sentiment */}
      {activeAgentTab === 'sentiment' && (
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Social Sentiment &amp; Retail Polarity</div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>{sentimentSummary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Fear & Greed: 54 (Neutral)', 'Polarity: 52% Balanced', 'Social Mentions: Elevated'].map((ind) => (
              <span key={ind} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 5. Macro News */}
      {activeAgentTab === 'macro' && (
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Macroeconomic &amp; Spot ETF Flow Catalysts</div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>{newsSummary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Weekly ETF Net Flow: +$240M', 'Macro Liquidity: Neutral-Positive', 'Rate Cut Odds: 68%'].map((ind) => (
              <span key={ind} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 6. Risk Arbiter Decision */}
      {activeAgentTab === 'judge' && (
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Portfolio Manager &amp; Risk Arbiter Rationale</div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>
            {verdict?.reasoning || 'Consensus directs capital preservation in HOLD until technical breakout confirms direction.'}
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            <span>Final Verdict: <b style={{ color: signalColor }}>{signal}</b></span>
            <span>Conviction: <b style={{ color: 'var(--text)' }}>{confidencePct}%</b></span>
            <span>Allocated Capital: <b style={{ color: 'var(--text)' }}>0% (Cash Stash)</b></span>
          </div>
        </div>
      )}

      {/* 7. Live Step Stream */}
      {activeAgentTab === 'steps' && (
        <div style={{ background: 'var(--panel-solid)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, fontFamily: 'var(--mono)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase' }}>
            <Icons.Terminal />
            <span>Real-Time Consensus Execution Stream</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
            {(verdict?.recent_steps && verdict.recent_steps.length > 0 ? verdict.recent_steps : [
              { time: '22:10:01', agent: 'Market Analyst', text: 'Completed technical indicators & ATR volatility pass ($840 ATR)' },
              { time: '22:10:15', agent: 'Sentiment Analyst', text: 'Completed social fear/greed & polarity evaluation (54 Neutral)' },
              { time: '22:10:30', agent: 'News Analyst', text: 'Scanned macroeconomic catalysts & ETF flow reports (+$240M)' },
              { time: '22:10:45', agent: 'Bull Researcher', text: 'Formulated long breakout thesis ($81,500 target)' },
              { time: '22:11:00', agent: 'Bear Researcher', text: 'Formulated downside liquidity sweep risks ($76,400 support)' },
              { time: '22:11:20', agent: 'Risk Arbiter', text: 'Deliberated consensus: HOLD stance (3/5 conviction)' }
            ]).map((s: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: 10, color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--muted)' }}>[{s.time}]</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{s.agent}:</span>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
