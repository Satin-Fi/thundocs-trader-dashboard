import type { Fill } from '../types'
import { useState } from 'react'

export default function TradeTable({ fills }: { fills: Fill[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  if (!fills.length) {
    return (
      <div className="state-empty">
        <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>No executions recorded</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Order fills will appear here once executed by the engine</div>
      </div>
    )
  }

  const copyOrder = (orderId?: number | string) => {
    if (!orderId) return
    navigator.clipboard.writeText(String(orderId))
    setCopied(String(orderId))
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Qty (BTC)</th>
            <th>Execution Price</th>
            <th>Total Value</th>
            <th style={{ textAlign: 'right' }}>Order ID</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--text-2)', fontSize: 12 }}>{new Date(f.t).toLocaleString()}</td>
              <td>
                <span className={`badge-side ${f.side.toLowerCase()}`}>
                  {f.side === 'BUY' ? '▲ BUY' : '▼ SELL'}
                </span>
              </td>
              <td>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                  background: f.actor === 'user' ? 'rgba(45,212,138,0.15)' : 'var(--bg-subtle)',
                  color: f.actor === 'user' ? 'var(--accent)' : 'var(--muted)',
                  border: `1px solid ${f.actor === 'user' ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                  {f.actor === 'user' ? 'YOU' : 'BOT'}
                </span>
              </td>
              <td style={{ fontWeight: 600 }}>{f.qty}</td>
              <td style={{ fontWeight: 600 }}>${Number(f.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style={{ color: 'var(--text)', fontWeight: 700 }}>${(Number(f.qty) * Number(f.price)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style={{ textAlign: 'right' }}>
                {f.order ? (
                  <button
                    onClick={() => copyOrder(f.order)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: copied === String(f.order) ? 'var(--accent)' : 'var(--faint)',
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                    title="Click to copy Order ID"
                  >
                    {copied === String(f.order) ? 'COPIED ✓' : `#${String(f.order).slice(-6)}`}
                  </button>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
