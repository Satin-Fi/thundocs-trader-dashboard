import MultiAgentChamber from '../MultiAgentChamber'
import SignalRisk from '../SignalRisk'

interface Props {
  onApplyAITargets?: (sl: number | null, tp: number | null) => void
}

export default function IntelligenceWorkspace({ onApplyAITargets }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Flagship 7-Agent Intelligence Chamber */}
      <MultiAgentChamber onApplyAITargets={onApplyAITargets} />

      {/* Signal & Risk Gate Deep Dive */}
      <div className="card-bezel">
        <div className="card-inner">
          <div className="card-title" style={{ marginBottom: 14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Deterministic Signal &amp; Risk Guard Gating
          </div>
          <SignalRisk />
        </div>
      </div>
    </div>
  )
}
