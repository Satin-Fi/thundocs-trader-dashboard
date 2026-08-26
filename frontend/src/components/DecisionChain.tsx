import type { State, Signal, Risk, TAVerdict } from '../types'

interface Props {
  state: State | null
  signal: Signal | null
  risk: Risk | null
  verdict: TAVerdict | null
}

export default function DecisionChain({ state, signal, risk, verdict }: Props) {
  const quantSignal = signal?.signal || 'HOLD'
  const aiSignal = verdict?.signal || 'HOLD'
  const regime = state?.regime || 'trending'
  const isChoppy = regime.toLowerCase() === 'choppy'
  const tradingBlocked = risk?.trading_blocked || false
  const aiRating = verdict?.rating || 3

  // Confluence evaluation:
  const quantAligned = quantSignal === 'BUY' || quantSignal === 'SELL'
  const aiAligned = aiSignal === quantSignal
  const regimeFavorable = !isChoppy
  const riskClear = !tradingBlocked

  const isTradeEligible = quantAligned && aiAligned && regimeFavorable && riskClear

  // Determination of exact why / why-not rationale
  let gateStatus = 'WAIT'
  let rationale = ''

  if (isTradeEligible) {
    gateStatus = 'ELIGIBLE'
    rationale = `Quant ${quantSignal} signal aligns with AI Consensus (${aiSignal}) under favorable ${regime} market structure. Risk envelope is clear.`
  } else if (tradingBlocked && risk?.block_reasons?.length) {
    gateStatus = 'BLOCKED'
    rationale = `Risk limit exceeded: ${risk.block_reasons.join(', ')}`
  } else if (isChoppy) {
    gateStatus = 'SUPPRESSED'
    rationale = 'Choppy market regime suppresses active breakout/trend execution to prevent false signals and capital chop.'
  } else if (quantSignal !== 'HOLD' && aiSignal === 'HOLD') {
    gateStatus = 'WAIT'
    rationale = `Quant engine generated a ${quantSignal} signal, but AI Research Consensus remains HOLD (${aiRating}/5★ conviction). Waiting for AI confirmation.`
  } else if (quantSignal !== 'HOLD' && aiSignal !== quantSignal) {
    gateStatus = 'DIVERGENT'
    rationale = `Signal conflict: Quant indicates ${quantSignal}, but AI Research Consensus indicates ${aiSignal}. Capital deployment paused until confluence established.`
  } else {
    gateStatus = 'SCANNING'
    rationale = 'Monitoring live market indicators and agent research stream for high-conviction confluence setups.'
  }

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header with Title & Final Action Pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-1)' }}>
            Decision Chain &amp; Execution Gate
          </span>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Deterministic Quant ↔ Interpretive AI Pipeline
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Gate Status:</span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              background:
                gateStatus === 'ELIGIBLE'
                  ? 'var(--accent-soft)'
                  : gateStatus === 'BLOCKED'
                  ? 'var(--negative-soft)'
                  : 'var(--warn-soft)',
              color:
                gateStatus === 'ELIGIBLE'
                  ? 'var(--accent)'
                  : gateStatus === 'BLOCKED'
                  ? 'var(--negative)'
                  : 'var(--warn)',
              border: `1px solid ${
                gateStatus === 'ELIGIBLE'
                  ? 'var(--accent-border)'
                  : gateStatus === 'BLOCKED'
                  ? 'var(--negative-border)'
                  : 'var(--warn-border)'
              }`,
            }}
          >
            {gateStatus}
          </span>
        </div>
      </div>

      {/* Visual Decision Graph Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {/* Node 1: Market & Regime */}
        <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>1. Market Regime</span>
            <span style={{ fontSize: 9.5, color: regimeFavorable ? 'var(--accent)' : 'var(--warn)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {regimeFavorable ? 'FAVORABLE ✓' : 'CHOPPY ×'}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: 'var(--text-1)', marginTop: 3, textTransform: 'uppercase' }}>
            {regime}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            Score: {state?.regime_score?.toFixed(0) ?? '50'}/100 · 14-ATR: ${state?.atr?.toFixed(0) ?? '840'}
          </div>
        </div>

        {/* Node 2: Quant Engine (Deterministic) */}
        <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>2. Quant Engine</span>
            <span style={{ fontSize: 9.5, color: quantAligned ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {quantAligned ? 'SIGNAL ✓' : 'NEUTRAL —'}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 13,
              fontWeight: 800,
              color: quantSignal === 'BUY' ? 'var(--accent)' : quantSignal === 'SELL' ? 'var(--negative)' : 'var(--text-2)',
              marginTop: 3,
            }}
          >
            {quantSignal} ({signal?.strategy_name ?? 'EMA Trend'})
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            Deterministic mathematical triggers
          </div>
        </div>

        {/* Node 3: AI Research (Interpretive) */}
        <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', borderLeft: '2px solid var(--ai)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ai)', textTransform: 'uppercase' }}>3. AI Consensus</span>
            <span style={{ fontSize: 9.5, color: aiAligned ? 'var(--accent)' : 'var(--warn)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {aiRating}/5 ★ Conviction
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 13,
              fontWeight: 800,
              color: aiSignal === 'BUY' ? 'var(--accent)' : aiSignal === 'SELL' ? 'var(--negative)' : 'var(--warn)',
              marginTop: 3,
            }}
          >
            {aiSignal} (Risk Judge / PM)
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            7-Agent Bull vs Bear consensus
          </div>
        </div>

        {/* Node 4: Risk Arbiter & Limits */}
        <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>4. Risk Guard</span>
            <span style={{ fontSize: 9.5, color: riskClear ? 'var(--accent)' : 'var(--negative)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
              {riskClear ? 'PASSED ✓' : 'BLOCKED ×'}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: riskClear ? 'var(--accent)' : 'var(--negative)', marginTop: 3 }}>
            {riskClear ? 'ENVELOPE CLEAR' : 'LIMIT BREACHED'}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            Risk/Reward: {risk?.entry_risk?.rr ?? '2.2'} · SL: 1.5x ATR
          </div>
        </div>
      </div>

      {/* Decision Rationale Explanation Strip */}
      <div
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          fontSize: 11,
          lineHeight: 1.45,
        }}
      >
        <span style={{ color: isTradeEligible ? 'var(--accent)' : 'var(--warn)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {isTradeEligible ? 'Execution Authorized:' : 'Why Action is Gated:'}
        </span>
        <span style={{ color: 'var(--text-1)' }}>{rationale}</span>
      </div>
    </div>
  )
}
