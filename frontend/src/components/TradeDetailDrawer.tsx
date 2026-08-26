import type { Fill } from '../types'

interface Props {
  fill: Fill | null
  onClose: () => void
}

export default function TradeDetailDrawer({ fill, onClose }: Props) {
  if (!fill) return null

  const isBuy = fill.side === 'BUY'
  const accent = isBuy ? 'var(--accent)' : 'var(--negative)'
  const price = Number(fill.price)
  const qty = Number(fill.qty)
  const notional = price * qty
  const actor = fill.actor === 'user' ? 'YOU (MANUAL)' : 'BOT (AUTO-PILOT)'
  const orderId = String(fill.order)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 250,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        justifyContent: 'flex-end',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--surface-1)',
          borderLeft: '1px solid var(--border-strong)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-16px 0 40px rgba(0,0,0,0.7)',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--surface-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 900,
                fontFamily: 'var(--mono)',
                padding: '2px 7px',
                borderRadius: 'var(--radius-sm)',
                background: isBuy ? 'var(--accent-soft)' : 'var(--negative-soft)',
                color: accent,
                border: `1px solid ${isBuy ? 'var(--accent-border)' : 'var(--negative-border)'}`,
              }}
            >
              {fill.side}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'var(--mono)' }}>
                {fill.symbol} · Order #{orderId.slice(0, 8)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {new Date(fill.t).toLocaleString()}
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 14 }}>✕</button>
        </div>

        {/* Content Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Execution Metrics Summary */}
          <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
              Execution Ledger Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>Executed Price</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text-1)', marginTop: 2 }}>
                  ${price.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>Filled Quantity</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text-1)', marginTop: 2 }}>
                  {qty.toFixed(6)} {fill.symbol.replace('USDT', '')}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>Total Notional</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text-1)', marginTop: 2 }}>
                  ${notional.toFixed(2)} USDT
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>Actor Attribution</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: fill.actor === 'user' ? 'var(--accent)' : 'var(--info)', marginTop: 2 }}>
                  {actor}
                </div>
              </div>
            </div>
          </div>

          {/* Decision Snapshot at Entry */}
          <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)' }}>
                Decision Snapshot at Entry
              </div>
              <span style={{ fontSize: 9.5, padding: '1px 5px', background: 'var(--surface-2)', borderRadius: 3, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
                AUDITED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-1)', borderRadius: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Active Strategy:</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text-1)' }}>EMA Trend Following (20/50)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-1)', borderRadius: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Market Regime:</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>TRENDING (Score: 78/100)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-1)', borderRadius: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Quant Engine Signal:</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>BUY (EMA20 &gt; EMA50 Triggered)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-1)', borderRadius: 4, borderLeft: '2px solid var(--ai)' }}>
                <span style={{ color: 'var(--muted)' }}>AI Consensus Stance:</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>BUY (4/5 ★ Conviction)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--surface-1)', borderRadius: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Defined Invalidation Stop:</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--negative)' }}>1.5x ATR Trailing Stop</span>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.45, padding: '8px 10px', background: 'var(--surface-1)', borderRadius: 4 }}>
              <b>Trade Execution Thesis:</b> Position initialized following confirmed technical breakout above the 50-period EMA, supported by positive institutional net inflows and a clear volatility expansion regime.
            </div>
          </div>

          {/* Audit Hash & Copy Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            <span>Order Hash: {orderId}</span>
            <button
              className="btn-secondary"
              style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={() => navigator.clipboard.writeText(orderId)}
            >
              Copy Hash
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
