interface Props {
  open: boolean
  side: 'BUY' | 'SELL'
  symbol: string
  notional: number
  price: number
  stopLoss?: number
  takeProfit?: number
  autoManage: boolean
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}

export default function OrderReviewModal({
  open,
  side,
  symbol,
  notional,
  price,
  stopLoss,
  takeProfit,
  autoManage,
  onConfirm,
  onCancel,
  busy,
}: Props) {
  if (!open) return null

  const isBuy = side === 'BUY'
  const accent = isBuy ? 'var(--accent)' : 'var(--negative)'
  const estQty = price > 0 ? notional / price : 0
  const estLoss = stopLoss && price > 0 ? Math.abs((stopLoss - price) * estQty) : notional * 0.02
  const estProfit = takeProfit && price > 0 ? Math.abs((takeProfit - price) * estQty) : notional * 0.05
  const rr = estLoss > 0 ? (estProfit / estLoss).toFixed(2) : '2.50'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0, 0, 0, 0.82)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="card-bezel"
        style={{
          maxWidth: 440,
          width: '100%',
          borderTop: `3px solid ${accent}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <div className="card-inner">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  fontFamily: 'var(--mono)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: isBuy ? 'var(--accent-soft)' : 'var(--negative-soft)',
                  color: accent,
                  border: `1px solid ${isBuy ? 'var(--accent-border)' : 'var(--negative-border)'}`,
                }}
              >
                {side}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Confirm Order Execution</span>
            </div>
            <button className="btn-icon" onClick={onCancel} disabled={busy}>✕</button>
          </div>

          <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Market Symbol:</span>
              <b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{symbol}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Order Notional:</span>
              <b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>${notional.toFixed(2)} USDT</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Est. Size:</span>
              <b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{estQty.toFixed(6)} {symbol.replace('USDT', '')}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Ref. Price:</span>
              <b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>${price.toLocaleString()}</b>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Stop Loss:</span>
              <b style={{ color: stopLoss ? 'var(--negative)' : 'var(--text-2)', fontFamily: 'var(--mono)' }}>
                {stopLoss ? `$${stopLoss.toLocaleString()} (-$${estLoss.toFixed(2)})` : 'Dynamic Trailing'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Take Profit:</span>
              <b style={{ color: takeProfit ? 'var(--accent)' : 'var(--text-2)', fontFamily: 'var(--mono)' }}>
                {takeProfit ? `$${takeProfit.toLocaleString()} (+$${estProfit.toFixed(2)})` : 'Dynamic Trailing'}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Reward / Risk:</span>
              <b style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>1 : {rr}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Auto-Pilot Management:</span>
              <b style={{ color: autoManage ? 'var(--accent)' : 'var(--warn)', fontFamily: 'var(--mono)' }}>
                {autoManage ? 'ENABLED (Bot trails stop)' : 'MANUAL ONLY'}
              </b>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              className={isBuy ? 'btn-primary' : 'btn-danger'}
              onClick={onConfirm}
              disabled={busy}
              style={{ minWidth: 140 }}
            >
              {busy ? 'Routing...' : `Confirm ${side}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
