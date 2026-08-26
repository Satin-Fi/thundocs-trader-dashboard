import StrategyExplainer from '../StrategyExplainer'
import { setStrategy } from '../../api'
import type { State } from '../../types'
import { useState } from 'react'

interface Props {
  state: State | null
  strategies: { current: string; list: Record<string, { name: string; desc: string; params: Record<string, number> }> }
  setStrategies: React.Dispatch<React.SetStateAction<{ current: string; list: Record<string, { name: string; desc: string; params: Record<string, number> }> }>>
  backtest: any
  btDays: number
  setBtDays: (d: number) => void
  runBacktest: (d: number) => void
  btLoading: boolean
}

export default function StrategiesWorkspace({
  state,
  strategies,
  setStrategies,
  backtest,
  btDays,
  setBtDays,
  runBacktest,
  btLoading,
}: Props) {
  const [switching, setSwitching] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Active Strategy Switcher */}
      <div className="card-bezel">
        <div className="card-inner">
          <div className="strat-config-card" style={{ marginBottom: 0 }}>
            <div className="strat-field">
              <label className="strat-label">Active Trading Model</label>
              <select
                className="strat-select"
                value={strategies.current}
                disabled={switching}
                onChange={async (e) => {
                  const key = e.target.value
                  setSwitching(true)
                  try {
                    await setStrategy(key)
                    setStrategies((s) => ({ ...s, current: key }))
                  } catch {
                    // ignore
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
              <label className="strat-label">Model Parameters</label>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', paddingTop: 4 }}>
                {state?.strategy_params
                  ? Object.entries(state.strategy_params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('  ·  ')
                  : '—'}
              </div>
            </div>

            <div className="strat-field">
              <label className="strat-label">Last Execution Exit</label>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                  color: state?.last_exit?.reason.startsWith('TP')
                    ? 'var(--accent)'
                    : state?.last_exit?.reason.startsWith('STOP')
                    ? 'var(--negative)'
                    : 'var(--text-2)',
                  paddingTop: 4,
                }}
              >
                {state?.last_exit
                  ? `${state.last_exit.reason} @ $${state.last_exit.price.toLocaleString()}`
                  : 'No exits logged'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Explainer & 4 Families Deep Dive */}
      <div className="card-bezel">
        <div className="card-inner">
          <StrategyExplainer />
        </div>
      </div>

      {/* Walk-Forward Optimization & Backtest Lab */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Walk-Forward Self-Tuner Candidates */}
        <div className="card-bezel">
          <div className="card-inner">
            <div className="card-title" style={{ marginBottom: 12 }}>
              Walk-Forward Parameter Optimizer
            </div>
            {state?.tune ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {state.tune.candidates.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${
                        c.strategy === state.tune!.best.strategy &&
                        JSON.stringify(c.params) === JSON.stringify(state.tune!.best.params)
                          ? 'var(--accent)'
                          : 'var(--border)'
                      }`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{c.strategy}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                        {c.trades} trades · {c.win_rate}% WR
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, color: (c.test_ret ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                      {(c.test_ret ?? 0) >= 0 ? '+' : ''}{(c.test_ret ?? 0).toFixed(2)}% OOS
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="state-empty">Auto-tuner initializing cycle...</div>
            )}
          </div>
        </div>

        {/* Backtest Simulation Lab */}
        <div className="card-bezel">
          <div className="card-inner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>Backtest Simulation Lab</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[7, 14, 30, 60].map((d) => (
                  <button
                    key={d}
                    className={`btn-secondary ${btDays === d ? 'active' : ''}`}
                    onClick={() => {
                      setBtDays(d)
                      runBacktest(d)
                    }}
                    disabled={btLoading}
                    style={{ padding: '3px 7px', fontSize: 10.5 }}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {backtest ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {backtest.results.slice(0, 5).map((r: any, i: number) => (
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
            ) : (
              <div className="state-empty">Select a duration to run backtest simulation.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
