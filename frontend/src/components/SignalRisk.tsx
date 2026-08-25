import { useEffect, useState } from 'react'
import { fetchSignal, fetchRisk, type Signal, type Risk } from '../api'

/**
 * Signal & Risk panel: shows the LIVE signal the bot is evaluating, the reason
 * it isn't trading (if blocked), and the risk/reward of entering a trade now.
 */
export default function SignalRisk() {
  const [signal, setSignal] = useState<Signal | null>(null)
  const [risk, setRisk] = useState<Risk | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      fetchSignal().then(s => alive && setSignal(s)).catch(() => {})
      fetchRisk().then(r => alive && setRisk(r)).catch(() => {})
    }
    load()
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const sigColor = (s: string) => s === 'BUY' ? 'var(--accent)' : s === 'SELL' ? 'var(--negative)' : 'var(--text-2)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 18, alignItems: 'start' }}>
      {/* Current signal */}
      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>Current Trade Signal</div>
        {signal ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 900, color: sigColor(signal.signal) }}>{signal.signal}</span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{signal.strategy_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Position: <b>{signal.position}</b></div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--mono)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
              “{signal.reason}”
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
              <span>RSI: <b style={{ color: 'var(--text-2)' }}>{signal.rsi ?? '—'}</b></span>
              <span>Regime: <b style={{ color: 'var(--text-2)' }}>{signal.regime ?? '—'}</b></span>
              <span>Price: <b style={{ color: 'var(--text-2)' }}>${signal.price.toLocaleString()}</b></span>
            </div>
          </>
        ) : <div className="state-empty">Loading signal…</div>}
      </div>

      {/* Why not trading + entry risk */}
      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>Why Not Trading &amp; Entry Risk</div>
        {risk ? (
          <>
            {risk.trading_blocked ? (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--negative)', marginBottom: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Not entering right now:
                </div>
                {risk.block_reasons.map((b, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', padding: '2px 0' }}>• {b}</div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                Signal conditions are met for an entry.
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Risk if you place a trade now:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <RiskTile k="Stop Loss" v={`$${risk.entry_risk.sl_price.toLocaleString()}`} sub={`${risk.entry_risk.risk_pct}%`} neg />
              <RiskTile k="Take Profit" v={`$${risk.entry_risk.tp_price.toLocaleString()}`} sub={`+${risk.entry_risk.reward_pct}%`} pos />
              <RiskTile k="R:R Ratio" v={`${risk.entry_risk.rr}`} sub="reward/risk" />
              <RiskTile k="ATR (14)" v={risk.atr ? `$${risk.atr.toFixed(2)}` : '—'} sub={`RSI ${risk.rsi}`} />
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
              Available USDT: <b style={{ color: 'var(--text-2)' }}>${risk.available_usdt.toFixed(2)}</b> · Regime: <b style={{ color: 'var(--text-2)' }}>{risk.regime}</b>
            </div>
          </>
        ) : <div className="state-empty">Loading risk…</div>}
      </div>
    </div>
  )
}

function RiskTile({ k, v, sub, pos, neg }: { k: string; v: string; sub: string; pos?: boolean; neg?: boolean }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{k}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800, color: pos ? 'var(--accent)' : neg ? 'var(--negative)' : 'var(--text)' }}>{v}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>
    </div>
  )
}
