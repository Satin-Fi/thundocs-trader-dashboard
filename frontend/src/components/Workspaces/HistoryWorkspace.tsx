import { useState } from 'react'
import type { Fill } from '../../types'
import TradeDetailDrawer from '../TradeDetailDrawer'

interface Props {
  fills: Fill[]
}

export default function HistoryWorkspace({ fills }: Props) {
  const [selectedFill, setSelectedFill] = useState<Fill | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="ws-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>
              Deterministic Execution Ledger &amp; Order Fills ({fills.length})
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
              Click any row to inspect historical Quant &amp; AI decision snapshot at entry time
            </div>
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Immutable Local Ledger Audit
          </span>
        </div>

        {fills.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Actor</th>
                  <th>Qty</th>
                  <th>Fill Price</th>
                  <th>Value (USDT)</th>
                  <th>Order Hash</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f, i) => {
                  const p = Number(f.price)
                  const q = Number(f.qty)
                  const val = p * q
                  const isUser = f.actor === 'user'
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedFill(f)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{new Date(f.t).toLocaleString()}</td>
                      <td style={{ fontWeight: 700, color: 'var(--text-1)' }}>{f.symbol}</td>
                      <td>
                        <span className={`badge-side ${f.side.toLowerCase()}`}>{f.side}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: isUser ? 'var(--accent-soft)' : 'var(--surface-2)', color: isUser ? 'var(--accent)' : 'var(--info)' }}>
                          {isUser ? 'YOU' : 'BOT'}
                        </span>
                      </td>
                      <td>{q.toFixed(6)}</td>
                      <td style={{ fontWeight: 700 }}>${p.toLocaleString()}</td>
                      <td>${val.toFixed(2)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 10.5 }}>{String(f.order).slice(0, 10)}...</td>
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '2px 7px', fontSize: 10 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedFill(f)
                          }}
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="state-empty">No trade executions recorded yet.</div>
        )}
      </div>

      {/* Slide-over Historical Decision Snapshot Drawer */}
      <TradeDetailDrawer fill={selectedFill} onClose={() => setSelectedFill(null)} />
    </div>
  )
}
