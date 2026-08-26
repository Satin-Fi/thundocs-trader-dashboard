import { useState, useEffect } from 'react'
import { postManualOrder, postManualUpdate, postExitPosition, fetchState } from '../api'
import type { State, Fill } from '../types'
import OrderReviewModal from './OrderReviewModal'

interface Props {
  state: State | null
  fills: Fill[]
}

export default function ManualTrade({ state, fills }: Props) {
  const [notional, setNotional] = useState('10')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [autoManage, setAutoManage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reviewOrder, setReviewOrder] = useState<'BUY' | 'SELL' | null>(null)

  const activePos = state?.positions?.find(p => p.symbol === state.symbol)
  const hasOpenPos = (activePos?.qty ?? 0) > 0.000001
  const price = state?.price ?? 0
  const atr = state?.atr ?? 840

  // Pre-fill / sync stops with position or AI/ATR targets
  useEffect(() => {
    if (activePos && activePos.entry) {
      if (activePos.stop_loss) setStopLoss(String(activePos.stop_loss))
      if (activePos.take_profit) setTakeProfit(String(activePos.take_profit))
    }
  }, [activePos?.symbol])

  // Listen to AI target apply event
  useEffect(() => {
    const handleSetTargets = (e: any) => {
      const { sl, tp } = e.detail || {}
      if (sl) setStopLoss(String(sl))
      if (tp) setTakeProfit(String(tp))
    }
    window.addEventListener('pt-set-targets', handleSetTargets)
    return () => window.removeEventListener('pt-set-targets', handleSetTargets)
  }, [])

  const handleReview = (side: 'BUY' | 'SELL') => {
    setReviewOrder(side)
  }

  const handleExecuteConfirmed = async () => {
    if (!reviewOrder) return
    const side = reviewOrder
    setBusy(true)
    setMsg(null)
    try {
      const notionalNum = parseFloat(notional) || 10
      const slNum = stopLoss ? parseFloat(stopLoss) : undefined
      const tpNum = takeProfit ? parseFloat(takeProfit) : undefined

      const res = await postManualOrder(side, notionalNum, autoManage, slNum, tpNum, state?.symbol)
      if (res && res.ok) {
        setMsg({ ok: true, text: `ORDER FILLED: ${side} ${res.qty.toFixed(6)} @ $${res.price.toLocaleString()}` })
        await fetchState()
        window.dispatchEvent(new Event('pt-manual-traded'))
      } else {
        setMsg({ ok: false, text: 'Order rejected by risk arbiter' })
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Execution error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setBusy(false)
      setReviewOrder(null)
    }
  }

  const handleUpdateLive = async () => {
    if (!state?.symbol) return
    setBusy(true)
    setMsg(null)
    try {
      const slNum = stopLoss ? parseFloat(stopLoss) : undefined
      const tpNum = takeProfit ? parseFloat(takeProfit) : undefined
      const res = await postManualUpdate(state.symbol, autoManage, slNum, tpNum)
      if (res && res.ok) {
        setMsg({ ok: true, text: 'Position stops & auto-pilot updated' })
        await fetchState()
      } else {
        setMsg({ ok: false, text: 'Failed to update live position' })
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Update error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setBusy(false)
    }
  }

  const handleExit = async () => {
    if (!window.confirm(`Execute immediate MARKET EXIT for ${state?.symbol ?? 'BTCUSDT'}?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postExitPosition(state?.symbol)
      if (res && res.ok) {
        setMsg({ ok: true, text: `POSITION CLOSED: ${res.qty.toFixed(6)} @ $${res.price.toLocaleString()}` })
        await fetchState()
        window.dispatchEvent(new Event('pt-manual-traded'))
      } else {
        setMsg({ ok: false, text: 'Exit execution failed' })
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Exit error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setBusy(false)
    }
  }

  // Pre-calculated risk metrics
  const notionalNum = parseFloat(notional) || 10
  const estQty = price > 0 ? notionalNum / price : 0
  const slPrice = stopLoss ? parseFloat(stopLoss) : (price > 0 ? price - 1.5 * atr : 0)
  const tpPrice = takeProfit ? parseFloat(takeProfit) : (price > 0 ? price + 2.0 * atr : 0)
  const estLoss = slPrice > 0 && price > 0 ? Math.abs((price - slPrice) * estQty) : notionalNum * 0.02
  const estReward = tpPrice > 0 && price > 0 ? Math.abs((tpPrice - price) * estQty) : notionalNum * 0.05
  const rr = estLoss > 0 ? (estReward / estLoss).toFixed(2) : '2.50'

  const actorSplit = state?.pnl_by_actor || {
    bot: { net: 0, realized: 0 },
    user: { net: 0, realized: 0 }
  }

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title" style={{ margin: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Order Execution Ticket
        </div>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--mono)',
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: 'var(--radius-sm)',
            background: hasOpenPos ? 'var(--accent-soft)' : 'var(--surface-2)',
            color: hasOpenPos ? 'var(--accent)' : 'var(--muted)',
            border: `1px solid ${hasOpenPos ? 'var(--accent-border)' : 'var(--border)'}`,
          }}
        >
          {hasOpenPos ? `OPEN: ${activePos?.qty}` : 'FLAT'}
        </span>
      </div>

      {/* Notional Capital Input */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Trade Capital (USDT)
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Vault: <b style={{ color: 'var(--text-1)' }}>${state ? state.usdt.toFixed(2) : '—'}</b>
          </span>
        </div>
        <input
          type="number"
          value={notional}
          min={1}
          step={1}
          onChange={(e) => setNotional(e.target.value)}
          className="terminal-input"
          style={{ width: '100%', fontSize: 14, fontWeight: 700 }}
          placeholder="10.00"
        />

        {/* Quick presets */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginTop: 6 }}>
          {[10, 25, 50, 100, 250].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setNotional(String(val))}
              style={{
                background: notional === String(val) ? 'var(--surface-active)' : 'var(--surface-0)',
                border: `1px solid ${notional === String(val) ? 'var(--accent)' : 'var(--border)'}`,
                color: notional === String(val) ? 'var(--accent)' : 'var(--text-2)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 0',
                fontSize: 10.5,
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ${val}
            </button>
          ))}
        </div>
      </div>

      {/* Stop Loss & Take Profit with dynamic ATR auto-fill */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Stop Loss ($)</span>
            <span
              onClick={() => price > 0 && setStopLoss((price - 1.5 * atr).toFixed(0))}
              style={{ fontSize: 9, color: 'var(--negative)', cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 700 }}
              title="Auto-fill 1.5x ATR Stop"
            >
              ⚡ 1.5x ATR
            </span>
          </div>
          <input
            type="number"
            value={stopLoss}
            placeholder={price > 0 ? (price - 1.5 * atr).toFixed(0) : '76000'}
            onChange={(e) => setStopLoss(e.target.value)}
            className="terminal-input"
            style={{ width: '100%', fontSize: 12 }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>Take Profit ($)</span>
            <span
              onClick={() => price > 0 && setTakeProfit((price + 2.0 * atr).toFixed(0))}
              style={{ fontSize: 9, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 700 }}
              title="Auto-fill 2.0x ATR Target"
            >
              ⚡ 2.0x ATR
            </span>
          </div>
          <input
            type="number"
            value={takeProfit}
            placeholder={price > 0 ? (price + 2.0 * atr).toFixed(0) : '81500'}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="terminal-input"
            style={{ width: '100%', fontSize: 12 }}
          />
        </div>
      </div>

      {/* Pre-Trade Risk & Reward Projection Strip */}
      <div
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          fontSize: 10.5,
          fontFamily: 'var(--mono)',
        }}
      >
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 9.5 }}>Max Risk:</div>
          <div style={{ color: 'var(--negative)', fontWeight: 700 }}>-${estLoss.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 9.5 }}>Exp. Reward:</div>
          <div style={{ color: 'var(--accent)', fontWeight: 700 }}>+${estReward.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 9.5 }}>Reward/Risk:</div>
          <div style={{ color: 'var(--text-1)', fontWeight: 700 }}>1 : {rr}</div>
        </div>
      </div>

      {/* Auto-Pilot Toggle */}
      <div
        onClick={() => setAutoManage(!autoManage)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surface-0)',
          border: `1px solid ${autoManage ? 'var(--accent-border)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          cursor: 'pointer',
        }}
      >
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-1)' }}>
            Bot Auto-Pilot &amp; Trailing Stops
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
            Bot algorithms trail stops and harvest profit
          </div>
        </div>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            fontFamily: 'var(--mono)',
            padding: '1px 6px',
            borderRadius: 3,
            background: autoManage ? 'var(--accent-soft)' : 'var(--surface-2)',
            color: autoManage ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          {autoManage ? 'ENABLED' : 'OFF'}
        </span>
      </div>

      {/* Order Execution Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => handleReview('BUY')}
          style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 800 }}
        >
          BUY (Long)
        </button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={() => handleReview('SELL')}
          style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 800 }}
        >
          SELL (Short)
        </button>
      </div>

      {/* Live Position Controls (if open) */}
      {hasOpenPos && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>Active Position Controls</span>
            <span>Mark: <b style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>${price.toLocaleString()}</b></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 6 }}>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={handleUpdateLive}
              style={{ fontSize: 11, padding: '6px 8px' }}
            >
              Sync Stops
            </button>
            <button
              className="btn-danger"
              disabled={busy}
              onClick={handleExit}
              style={{ fontSize: 11, padding: '6px 8px' }}
            >
              Close Market
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {msg && (
        <div
          style={{
            fontSize: 11,
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            background: msg.ok ? 'var(--accent-soft)' : 'var(--negative-soft)',
            color: msg.ok ? 'var(--accent)' : 'var(--negative)',
            border: `1px solid ${msg.ok ? 'var(--accent-border)' : 'var(--negative-border)'}`,
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Compact Attribution Footnote */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--muted)',
          fontFamily: 'var(--mono)',
        }}
      >
        <span>Bot Net: <b style={{ color: (actorSplit.bot.net ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>{(actorSplit.bot.net ?? 0) >= 0 ? '+' : ''}${actorSplit.bot.net?.toFixed(2)}</b></span>
        <span>You Net: <b style={{ color: (actorSplit.user.net ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>{(actorSplit.user.net ?? 0) >= 0 ? '+' : ''}${actorSplit.user.net?.toFixed(2)}</b></span>
        <span>Fills: <b style={{ color: 'var(--text-1)' }}>{fills.length}</b></span>
      </div>

      {/* Explicit Order Review Modal */}
      <OrderReviewModal
        open={!!reviewOrder}
        side={reviewOrder || 'BUY'}
        symbol={state?.symbol ?? 'BTCUSDT'}
        notional={notionalNum}
        price={price}
        stopLoss={slPrice}
        takeProfit={tpPrice}
        autoManage={autoManage}
        onConfirm={handleExecuteConfirmed}
        onCancel={() => setReviewOrder(null)}
        busy={busy}
      />
    </div>
  )
}
