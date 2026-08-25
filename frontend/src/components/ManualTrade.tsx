import { useState, useEffect } from 'react'
import { postManualOrder, postManualUpdate, postExitPosition, fetchState } from '../api'
import type { State, Fill } from '../types'

export default function ManualTrade({ state, fills }: { state: State | null; fills: Fill[] }) {
  const [notional, setNotional] = useState('10')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [autoManage, setAutoManage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const activePos = state?.positions?.find(p => p.symbol === state.symbol)
  const hasOpenPos = (activePos?.qty ?? 0) > 0.000001
  const actorSplit = state?.pnl_by_actor || {
    bot: { realized: 0, open_value: 0, net: 0, btc_open: 0 },
    user: { realized: 0, open_value: 0, net: 0, btc_open: 0 }
  }

  const userFills = fills.filter(f => f.actor === 'user')
  const botFills = fills.filter(f => f.actor !== 'user')

  // Synchronize inputs when active symbol or manual_state changes
  useEffect(() => {
    if (state?.manual_state) {
      if (state.manual_state.sl != null) setStopLoss(String(state.manual_state.sl))
      if (state.manual_state.tp != null) setTakeProfit(String(state.manual_state.tp))
      if (state.manual_state.auto_manage !== undefined) setAutoManage(state.manual_state.auto_manage)
    } else if (activePos) {
      if (activePos.stop_loss) setStopLoss(String(activePos.stop_loss))
      if (activePos.take_profit) setTakeProfit(String(activePos.take_profit))
    }
  }, [state?.symbol, state?.manual_state])

  const handleOrder = async (side: 'BUY' | 'SELL') => {
    setBusy(true)
    setMsg(null)
    try {
      const slNum = stopLoss ? parseFloat(stopLoss) : undefined
      const tpNum = takeProfit ? parseFloat(takeProfit) : undefined
      const res = await postManualOrder(
        side,
        parseFloat(notional) || 10,
        autoManage,
        slNum,
        tpNum,
        state?.symbol
      )
      if (res.ok) {
        setMsg({ ok: true, text: `${side} filled ${res.qty.toFixed(6)} @ $${res.price.toLocaleString()} (you)` })
        await fetchState()
        window.dispatchEvent(new Event('pt-manual-traded'))
      } else {
        setMsg({ ok: false, text: 'Order execution failed' })
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Order error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setBusy(false)
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
      if (res.ok) {
        setMsg({ ok: true, text: `Protection & Bot settings synced for ${state.symbol}` })
        await fetchState()
      } else {
        setMsg({ ok: false, text: 'Update failed' })
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Update error: ' + (e instanceof Error ? e.message : 'offline') })
    } finally {
      setBusy(false)
    }
  }

  const handleExit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await postExitPosition(state?.symbol)
      if (res.ok) {
        setMsg({ ok: true, text: `EXIT filled ${res.qty.toFixed(6)} @ $${res.price.toLocaleString()} (you)` })
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* Left: Order Execution & Live Position Rules */}
      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Manual Trade Ticket · {state?.symbol ?? 'BTCUSDT'}
          </div>
          {hasOpenPos && (
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--mono)' }}>
              POSITION OPEN ({activePos?.qty})
            </span>
          )}
        </div>

        {/* Notional Capital */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="input-field-label">Trade Notional (USDT)</label>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              Avail: <b style={{ color: 'var(--text)' }}>${state ? state.usdt.toFixed(2) : ''}</b>
            </span>
          </div>
          <input
            type="number"
            value={notional}
            min={1}
            step={1}
            onChange={e => setNotional(e.target.value)}
            className="terminal-input"
            style={{ fontSize: 14, padding: '8px 12px' }}
            placeholder="10.00"
          />
          {/* Quick presets */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[10, 25, 50, 100, 250].map(val => (
              <button
                key={val}
                type="button"
                onClick={() => setNotional(String(val))}
                style={{
                  flex: 1,
                  background: notional === String(val) ? 'var(--surface-hover)' : 'var(--surface)',
                  border: `1px solid ${notional === String(val) ? 'var(--accent)' : 'var(--border)'}`,
                  color: notional === String(val) ? 'var(--accent)' : 'var(--text-2)',
                  borderRadius: 4,
                  padding: '4px 0',
                  fontSize: 11,
                  fontFamily: 'var(--mono)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                ${val}
              </button>
            ))}
          </div>
        </div>

        {/* Stop Loss & Take Profit inputs */}
        <div className="quick-inputs-grid" style={{ marginBottom: 14 }}>
          <div className="input-field-wrap">
            <label className="input-field-label">Stop Loss ($)</label>
            <input
              type="number"
              value={stopLoss}
              placeholder="e.g. 78000"
              onChange={e => setStopLoss(e.target.value)}
              className="terminal-input"
            />
            {stopLoss && !isNaN(parseFloat(stopLoss)) && state?.price ? (
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 4, fontWeight: 700, color: (parseFloat(stopLoss) - state.price) <= 0 ? 'var(--negative)' : 'var(--accent)' }}>
                Est. Loss: {(parseFloat(stopLoss) - state.price) * ((parseFloat(notional) || 10) / state.price) <= 0 ? '' : '+'}${((parseFloat(stopLoss) - state.price) * ((parseFloat(notional) || 10) / state.price)).toFixed(2)} USDT ({(((parseFloat(stopLoss) / state.price) - 1) * 100) >= 0 ? '+' : ''}{(((parseFloat(stopLoss) / state.price) - 1) * 100).toFixed(2)}%)
              </div>
            ) : null}
          </div>
          <div className="input-field-wrap">
            <label className="input-field-label">Take Profit ($)</label>
            <input
              type="number"
              value={takeProfit}
              placeholder="e.g. 85000"
              onChange={e => setTakeProfit(e.target.value)}
              className="terminal-input"
            />
            {takeProfit && !isNaN(parseFloat(takeProfit)) && state?.price ? (
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 4, fontWeight: 700, color: (parseFloat(takeProfit) - state.price) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                Est. Profit: {(parseFloat(takeProfit) - state.price) * ((parseFloat(notional) || 10) / state.price) >= 0 ? '+' : ''}${((parseFloat(takeProfit) - state.price) * ((parseFloat(notional) || 10) / state.price)).toFixed(2)} USDT ({(((parseFloat(takeProfit) / state.price) - 1) * 100) >= 0 ? '+' : ''}{(((parseFloat(takeProfit) / state.price) - 1) * 100).toFixed(2)}%)
              </div>
            ) : null}
          </div>
        </div>

        {/* Custom Toggle: Bot Auto-Manage */}
        <div
          onClick={() => setAutoManage(!autoManage)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--panel)',
            border: `1px solid ${autoManage ? 'var(--accent-border)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: 16,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Bot Auto-Pilot &amp; Trailing Stops</span>
              <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: autoManage ? 'var(--accent-soft)' : 'var(--surface)', color: autoManage ? 'var(--accent)' : 'var(--muted)', fontWeight: 800 }}>
                {autoManage ? 'ENABLED' : 'OFF'}
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
              Bot algorithms dynamically trail stops &amp; harvest profit for this position
            </div>
          </div>
          <div className={`toggle-switch ${autoManage ? 'on' : ''}`}>
            <div className="toggle-switch-handle" />
          </div>
        </div>

        {/* Order Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => handleOrder('BUY')}
            style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}
          >
            BUY (You)
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => handleOrder('SELL')}
            style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}
          >
            SELL (You)
          </button>
        </div>

        {/* Live Active Position Protection Controls */}
        {hasOpenPos && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-2)' }}>
                Live Position Controls
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                Mark: <b style={{ color: 'var(--info)' }}>${state ? state.price.toLocaleString() : ''}</b>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={handleUpdateLive}
                style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Sync Stops &amp; Bot Control
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={handleExit}
                style={{ padding: '9px 12px', fontSize: 12, fontWeight: 800 }}
              >
                Close (Market)
              </button>
            </div>
          </div>
        )}

        {/* Toast / Status messages */}
        {msg && (
          <div style={{ marginTop: 14 }} className={`toast-msg ${msg.ok ? 'success' : 'error'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {msg.ok ? <path d="M20 6L9 17l-5-5"/> : <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>}
            </svg>
            <span>{msg.text}</span>
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Price Ref: <b style={{ color: 'var(--text-2)' }}>${state ? state.price.toLocaleString() : ''}</b></span>
          <span>Min Size: <b style={{ color: 'var(--text-2)' }}>${state ? state.max_capital : 10}</b></span>
        </div>
      </div>

      {/* Right: You vs Bot attribution card */}
      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div className="card-title" style={{ marginBottom: 14 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20v-6M6 20V10M18 20V4"/>
          </svg>
          Earnings Attribution · You vs Bot
        </div>

        <AttributionCard
          label={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" ry="2"/>
                <circle cx="12" cy="5" r="2"/>
                <path d="M12 7v4"/>
                <line x1="8" y1="16" x2="8" y2="16"/>
                <line x1="16" y1="16" x2="16" y2="16"/>
              </svg>
              <span>Automated Bot Engine</span>
            </div>
          }
          data={actorSplit.bot}
          accent="var(--info)"
        />

        <div style={{ height: 10 }} />

        <AttributionCard
          label={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>You (Manual Execution)</span>
            </div>
          }
          data={actorSplit.user}
          accent="var(--accent)"
        />

        <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
          <span>Your Manual Trades: <b style={{ color: 'var(--text)' }}>{userFills.length}</b></span>
          <span>Bot Trades: <b style={{ color: 'var(--text)' }}>{botFills.length}</b></span>
        </div>
      </div>
    </div>
  )
}

function AttributionCard({ label, data, accent }: { label: React.ReactNode; data: { realized: number; open_value: number; net: number; btc_open: number }; accent: string }) {
  const net = data.net ?? 0
  const realized = data.realized ?? 0
  const open = data.open_value ?? 0
  return (
    <div style={{ background: 'var(--panel)', border: `1px solid var(--border)`, borderLeft: `3px solid ${accent}`, borderRadius: 'var(--radius-md)', padding: 14, boxShadow: 'inset 0 1px 0 var(--border-highlight)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 800, color: net >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
          {net >= 0 ? '+' : ''}${net.toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
        <span>Realized: <b style={{ color: 'var(--text-2)' }}>${realized.toFixed(2)}</b></span>
        <span>Open Value: <b style={{ color: 'var(--text-2)' }}>${open.toFixed(2)}</b></span>
        <span>Qty: <b style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{(data.btc_open ?? 0).toFixed(6)}</b></span>
      </div>
    </div>
  )
}
