import type { State, Signal, Risk, TAVerdict } from '../types'

interface Props {
  state: State | null
  signal: Signal | null
  risk: Risk | null
  verdict: TAVerdict | null
}

export default function ConfluenceMatrix({ state, signal, risk, verdict }: Props) {
  const quantSignal = signal?.signal || 'HOLD'
  const aiSignal = verdict?.signal || 'HOLD'
  const regime = state?.regime || 'choppy'
  const isChoppy = regime.toLowerCase() === 'choppy'
  const tradingBlocked = risk?.trading_blocked || false
  const aiConviction = verdict?.rating || 3

  const quantPass = quantSignal === 'BUY' || quantSignal === 'SELL'
  const aiPass = aiSignal === quantSignal
  const regimePass = !isChoppy
  const riskPass = !tradingBlocked

  const passesCount = [quantPass, aiPass, regimePass, riskPass].filter(Boolean).length
  const isEligible = passesCount >= 3 && !tradingBlocked

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        boxShadow: 'inset 0 1px 0 var(--border-highlight)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="card-title" style={{ margin: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          Trade Confluence &amp; Execution Gate
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            fontFamily: 'var(--mono)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            background: isEligible ? 'var(--accent-soft)' : 'var(--negative-soft)',
            color: isEligible ? 'var(--accent)' : 'var(--negative)',
            border: `1px solid ${isEligible ? 'var(--accent-border)' : 'var(--negative-border)'}`,
            letterSpacing: '0.04em',
          }}
        >
          {isEligible ? 'TRADE ELIGIBLE' : 'TRADE SUPPRESSED'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {/* Quant Signal */}
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Quant Signal</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: quantSignal === 'BUY' ? 'var(--accent)' : quantSignal === 'SELL' ? 'var(--negative)' : 'var(--text-2)', marginTop: 2 }}>
            {quantSignal} {quantPass ? '✓' : '—'}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>{signal?.strategy_name || 'Active Strategy'}</div>
        </div>

        {/* Market Regime */}
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Market Regime</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: regimePass ? 'var(--accent)' : 'var(--warn)', marginTop: 2, textTransform: 'uppercase' }}>
            {regime} {regimePass ? '✓' : '×'}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>Score: {state?.regime_score?.toFixed(0) || '50'}/100</div>
        </div>

        {/* AI Consensus */}
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>AI Consensus</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: aiSignal === 'BUY' ? 'var(--accent)' : aiSignal === 'SELL' ? 'var(--negative)' : 'var(--warn)', marginTop: 2 }}>
            {aiSignal} ({aiConviction}/5)
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>{aiPass ? 'Aligned ✓' : 'Divergent'}</div>
        </div>

        {/* Risk Filter */}
        <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Risk Gate</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: riskPass ? 'var(--accent)' : 'var(--negative)', marginTop: 2 }}>
            {riskPass ? 'CLEAR ✓' : 'BLOCKED ×'}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>R:R {risk?.entry_risk?.rr || '2.2'}</div>
        </div>
      </div>

      {/* Rationale explanation */}
      <div
        style={{
          fontSize: 11,
          color: isEligible ? 'var(--text-2)' : 'var(--muted)',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: isEligible ? 'var(--accent)' : 'var(--warn)', fontWeight: 700 }}>
          {isEligible ? 'Confluence Established:' : 'Gating Active:'}
        </span>
        <span>
          {isEligible
            ? `Quant engine (${quantSignal}) and AI research consensus (${aiSignal}) align under favorable market conditions.`
            : risk?.block_reasons?.length
            ? risk.block_reasons.join(' · ')
            : isChoppy
            ? 'Choppy regime suppresses breakout execution to prevent false signals.'
            : 'Waiting for directional alignment between Quant models and AI research.'}
        </span>
      </div>
    </div>
  )
}
