import type { State, Analytics, Fill } from '../../types'
import EquityChart from '../EquityChart'
import MultiAgentGrid from '../MultiAgentGrid'

interface Props {
  state: State | null
  analytics: Analytics | null
  eq: Array<{ t: string; equity: number }>
  fills: Fill[]
}

export default function PortfolioWorkspace({ state, analytics, eq, fills }: Props) {
  const actorSplit = state?.pnl_by_actor || {
    bot: { realized: 0, open_value: 0, net: 0, btc_open: 0 },
    user: { realized: 0, open_value: 0, net: 0, btc_open: 0 },
  }

  const userFills = fills.filter((f) => f.actor === 'user')
  const botFills = fills.filter((f) => f.actor !== 'user')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Performance Analytics Grid */}
      {analytics && (
        <div className="card-bezel">
          <div className="card-inner">
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
        </div>
      )}

      {/* Equity Curve & Bot vs User Attribution */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.4fr) minmax(300px, 1fr)', gap: 14 }}>
        {/* Equity Curve */}
        <div className="card-bezel">
          <div className="card-inner">
            <div className="card-title" style={{ marginBottom: 12 }}>Cumulative Equity Curve</div>
            <EquityChart data={eq} />
          </div>
        </div>

        {/* You vs Bot Attribution */}
        <div className="card-bezel">
          <div className="card-inner" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
            <div>
              <div className="card-title" style={{ marginBottom: 14 }}>Earnings Attribution · You vs. Bot</div>

              {/* Bot tile */}
              <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderLeft: '3px solid var(--info)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Automated Bot Engine</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800, color: (actorSplit.bot.net ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                    {(actorSplit.bot.net ?? 0) >= 0 ? '+' : ''}${actorSplit.bot.net.toFixed(2)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10.5, color: 'var(--muted)' }}>
                  <span>Realized: <b style={{ color: 'var(--text-2)' }}>${actorSplit.bot.realized.toFixed(2)}</b></span>
                  <span>Trades: <b style={{ color: 'var(--text-2)' }}>{botFills.length}</b></span>
                </div>
              </div>

              {/* You tile */}
              <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>You (Manual Execution)</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800, color: (actorSplit.user.net ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                    {(actorSplit.user.net ?? 0) >= 0 ? '+' : ''}${actorSplit.user.net.toFixed(2)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10.5, color: 'var(--muted)' }}>
                  <span>Realized: <b style={{ color: 'var(--text-2)' }}>${actorSplit.user.realized.toFixed(2)}</b></span>
                  <span>Trades: <b style={{ color: 'var(--text-2)' }}>{userFills.length}</b></span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Orders Logged: <b style={{ color: 'var(--text)' }}>{fills.length}</b></span>
              <span>Attribution Split: <b style={{ color: 'var(--accent)' }}>Deterministic</b></span>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Agent Performance Grid */}
      <MultiAgentGrid />
    </div>
  )
}
