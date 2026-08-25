import { useEffect, useState } from 'react'
import { fetchStrategyDetail, type StrategyDetail } from '../api'

/**
 * Strategy explainer tab: plain-language explanation of the ACTIVE strategy,
 * its parameters, current regime context, and the self-tuner's verdict.
 */
export default function StrategyExplainer() {
  const [detail, setDetail] = useState<StrategyDetail | null>(null)
  const [active, setActive] = useState('')

  useEffect(() => {
    let alive = true
    const load = () => fetchStrategyDetail().then(d => alive && setDetail(d)).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const stratName = active ? detail?.all_strategies[active]?.name : detail?.name
  const stratKey = active ? active : detail?.key
  const stratDesc = active
    ? detail?.all_strategies[active]?.desc
    : (detail?.how_it_works ?? detail?.description)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(260px, 1fr)', gap: 18, alignItems: 'start' }}>
      <div className="panel" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span className="dot-indicator" style={{ background: 'var(--accent)' }} />
          <span className="card-title">{stratName ?? 'Strategy'}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--mono)', margin: '6px 0 14px' }}>
          {stratKey ?? '—'}
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
          {stratDesc ?? 'Loading…'}
        </div>

        {((active && detail?.all_strategies[active]?.params) || (!active && detail?.params)) && (
          <div style={{ marginTop: 16 }}>
            <div className="strat-label" style={{ marginBottom: 6 }}>Live Parameters</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries((active ? detail?.all_strategies[active]?.params : detail?.params) || {}).map(([k, v]) => (
                <span key={k} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontFamily: 'var(--mono)' }}>
                  {k}=<b style={{ color: 'var(--text)' }}>{v}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {detail?.tuned && (
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 700, color: 'var(--text)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Auto-Tuner Context
            </div>
            Last ran {detail.tuned.ts ? new Date(detail.tuned.ts).toLocaleString() : '—'}.
            Best model: <b style={{ color: 'var(--text-2)' }}>{detail.tuned.best?.strategy}</b> ({detail.tuned.best?.test_ret?.toFixed(2)}% OOS). Applied: {detail.tuned.applied ? 'yes' : 'no'}.
          </div>
        )}
      </div>

      {/* Strategy selector + regime context */}
      <div className="panel" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>All Strategies</div>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(detail.all_strategies).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setActive(active === key ? '' : key)}
                style={{
                  textAlign: 'left',
                  background: active === key ? 'var(--bg)' : 'transparent',
                  border: `1px solid ${active === key ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer', color: 'var(--text)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.desc}</div>
              </button>
            ))}
          </div>
        )}
        {detail && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)' }}>
            Current RSI: <b style={{ color: 'var(--text-2)' }}>{detail.current_rsi ?? '—'}</b> · Regime: <b style={{ color: 'var(--text-2)' }}>{detail.regime}</b> ({detail.regime_score})
          </div>
        )}
      </div>
    </div>
  )
}
