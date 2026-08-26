import type { State, Signal, Risk, TAVerdict, Fill, Klines, Indicators } from '../../types'
import PriceChart, { type IndicatorOpts } from '../PriceChart'
import DecisionChain from '../DecisionChain'

interface Props {
  state: State | null
  signal: Signal | null
  risk: Risk | null
  verdict: TAVerdict | null
  fills: Fill[]
  klines: Klines | null
  indicators: Indicators | null
  tfState: string
  setTf: (tf: string) => void
  opts: IndicatorOpts
  setOpts: React.Dispatch<React.SetStateAction<IndicatorOpts>>
  onNavigateWorkspace: (ws: string) => void
  onSelectSymbol: (sym: string) => void
}

const usd = (n: number, d = 2) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export default function OverviewWorkspace({
  state,
  signal,
  risk,
  verdict,
  fills,
  klines,
  indicators,
  tfState,
  setTf,
  opts,
  setOpts,
  onNavigateWorkspace,
  onSelectSymbol,
}: Props) {
  const activePos = state?.positions?.find((p) => p.symbol === state.symbol)
  const hasOpenPos = (activePos?.qty ?? 0) > 0.000001
  const price = state?.price ?? 0
  const atr = state?.atr ?? 840
  const isBuy = activePos?.side === 'BUY' || activePos?.side === 'LONG'
  const entry = activePos?.entry ?? 0
  const sl = activePos?.stop_loss || (entry > 0 ? (isBuy ? entry - 1.5 * atr : entry + 1.5 * atr) : 0)
  const tp = activePos?.take_profit || (entry > 0 ? (isBuy ? entry + 2.0 * atr : entry - 2.0 * atr) : 0)
  const qty = activePos?.qty ?? 0
  const riskUsd = qty > 0 && entry > 0 ? Math.abs((entry - sl) * qty) : (risk?.entry_risk?.risk_pct ? risk.entry_risk.risk_pct * (state?.total_funds ?? 10000) / 100 : 284)
  const rewardUsd = qty > 0 && entry > 0 ? Math.abs((tp - entry) * qty) : (risk?.entry_risk?.reward_pct ? risk.entry_risk.reward_pct * (state?.total_funds ?? 10000) / 100 : 485)
  const rr = risk?.entry_risk?.rr ?? (riskUsd > 0 ? rewardUsd / riskUsd : 0)
  const pos = activePos && entry ? { entry, stop_loss: activePos.stop_loss ?? sl, take_profit: activePos.take_profit ?? tp } : null

  // ── Confluence gate ──
  const quant = signal?.signal ?? 'HOLD'
  const regime = state?.regime ?? '—'
  const regScore = state?.regime_score ?? 0
  const aiSig = verdict?.signal ?? signal?.ai?.verdict ?? 'HOLD'
  const aiProvider = signal?.ai?.provider ?? verdict?.provider ?? null
  const blocked = risk?.trading_blocked
  const blockReasons = risk?.block_reasons ?? []
  const finalDecision = blocked ? 'BLOCKED' : (quant === 'BUY' || quant === 'SELL') ? quant : 'WAIT'

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── 1. MARKET TELEMETRY BAND ── */}
      <div className="market-ribbon" style={{ marginBottom: 0, borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
        <div className="ribbon-stat">
          <span className="ribbon-label">Instrument</span>
          <span className="ribbon-val" style={{ color: 'var(--text-1)' }}>{state?.symbol ?? 'BTCUSDT'}</span>
        </div>
        <div className="ribbon-stat">
          <span className="ribbon-label">Mark Price</span>
          <span className="ribbon-val" style={{ color: 'var(--accent)', fontSize: 18 }}>{usd(price)}</span>
        </div>
        <div className="ribbon-stat">
          <span className="ribbon-label">24h Change</span>
          <span className="ribbon-val" style={{ color: (state?.portfolio?.today_net ?? 0) >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
            {pct((state?.portfolio?.today_net ?? 0) / (state?.total_funds ?? 1) * 100)}
          </span>
        </div>
        <div className="ribbon-stat">
          <span className="ribbon-label">ATR (14)</span>
          <span className="ribbon-val">{usd(atr)}</span>
        </div>
        <div className="ribbon-stat">
          <span className="ribbon-label">Regime</span>
          <span className="ribbon-val" style={{ color: 'var(--info)', textTransform: 'uppercase', fontSize: 13 }}>
            {regime} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{regScore.toFixed(0)}</span>
          </span>
        </div>
        <div className="ribbon-stat">
          <span className="ribbon-label">AI Consensus</span>
          <span className="ribbon-val" style={{ color: aiSig === 'BUY' ? 'var(--accent)' : aiSig === 'SELL' ? 'var(--negative)' : 'var(--warn)', fontSize: 13 }}>
            {aiSig} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{verdict?.rating ?? 3}/5</span>
          </span>
        </div>
        <div className="ribbon-stat" style={{ borderRight: 'none' }}>
          <span className="ribbon-label">Vault</span>
          <span className="ribbon-val">{usd(state?.total_funds ?? 10000)}</span>
        </div>
      </div>

      {/* ── 2. PRIMARY WORKSTATION: CHART (70%) + POSITION RAIL (30%) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {/* Chart hero */}
        <div style={{ borderRight: '1px solid var(--border)', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
            <div className="tf-group">
              {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                <button key={tf} className={`tf-btn ${tfState === tf ? 'active' : ''}`} onClick={() => setTf(tf)}>{tf}</button>
              ))}
            </div>
            <div className="ind-group">
              {(['ema20', 'ema50', 'breakout', 'rsi', 'macd', 'sr'] as unknown as [keyof IndicatorOpts, string][]).map(([key, label]) => (
                <button key={key} className={`ind-chip ${opts[key] ? 'on' : ''}`} onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}>{label.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <PriceChart klines={klines?.candles ?? []} indicators={indicators} livePrice={price} interval={tfState} position={pos} opts={opts} fills={fills} />
        </div>

        {/* Position rail */}
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-label" style={{ margin: 0 }}><span className="accent-bar" />POSITION</span>
            <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--mono)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: hasOpenPos ? 'var(--accent-soft)' : 'var(--surface-2)', color: hasOpenPos ? 'var(--accent)' : 'var(--muted)', border: `1px solid ${hasOpenPos ? 'var(--accent-border)' : 'var(--border)'}` }}>
              {hasOpenPos ? `${activePos?.side}` : 'FLAT'}
            </span>
          </div>

          {hasOpenPos && activePos ? (
            <>
              <div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Unrealized Return</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 800, color: activePos.unrealized_pnl >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                  {activePos.unrealized_pnl >= 0 ? '+' : ''}{usd(activePos.unrealized_pnl)} <span style={{ fontSize: 13 }}>{pct(activePos.unrealized_pct)}</span>
                </div>
              </div>
              <div className="divider" />
              <div className="kv"><span className="k">Size</span><span className="v">{activePos.qty} {state?.symbol.replace('USDT', '')}</span></div>
              <div className="kv"><span className="k">Entry</span><span className="v">{usd(activePos.entry)}</span></div>
              <div className="kv"><span className="k">Mark</span><span className="v" style={{ color: 'var(--accent)' }}>{usd(price)}</span></div>
              <div className="kv"><span className="k">Stop</span><span className="v neg">{usd(activePos.stop_loss || sl)}</span></div>
              <div className="kv"><span className="k">Target</span><span className="v pos">{usd(activePos.take_profit || tp)}</span></div>
              <div className="kv"><span className="k">Risk / R:R</span><span className="v">{usd(riskUsd)} / 1:{rr.toFixed(2)}</span></div>
              <div className="divider" />
              <div className="kv"><span className="k">Actor</span><span className="v">{state?.manual_state ? 'YOU / BOT' : 'BOT'}</span></div>
              <div className="kv"><span className="k">Management</span><span className="v" style={{ color: 'var(--accent)' }}>AUTO</span></div>
            </>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>NO OPEN POSITION</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Engine is hunting for confirmed confluence. <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => onNavigateWorkspace('scanner')}>Scan markets →</a></div>
            </div>
          )}
          <button className="btn-primary" style={{ marginTop: 'auto', width: '100%' }} onClick={() => onNavigateWorkspace('trade')}>Open Trade Terminal →</button>
        </div>
      </div>

      {/* ── 3. CONFLUENCE GATE ── */}
      <div className="ws-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.3fr', gap: 0, alignItems: 'stretch' }}>
        <ConfluenceCell label="QUANT" value={quant} tone={quant === 'BUY' ? 'pos' : quant === 'SELL' ? 'neg' : 'warn'} sub={signal?.strategy_name ?? '—'} />
        <ConfluenceCell label="REGIME" value={regime.toUpperCase()} tone="info" sub={`score ${regScore.toFixed(0)}`} />
        <ConfluenceCell label="AI" value={aiSig} tone={aiSig === 'BUY' ? 'pos' : aiSig === 'SELL' ? 'neg' : 'warn'} sub={aiProvider ? `via ${aiProvider}` : (verdict ? 'heuristic' : 'pending')} />
        <ConfluenceCell label="RISK" value={blocked ? 'BLOCK' : 'CLEAR'} tone={blocked ? 'neg' : 'pos'} sub={risk ? `R:R 1:${rr.toFixed(2)}` : '—'} />
        <div style={{ padding: '10px 16px', borderLeft: '1px solid var(--border)' }}>
          <div className="section-label" style={{ marginBottom: 6 }}><span className="accent-bar" style={{ background: 'var(--ai)' }} />FINAL DECISION</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 900, color: finalDecision === 'BLOCKED' ? 'var(--negative)' : finalDecision === 'WAIT' ? 'var(--warn)' : 'var(--accent)' }}>{finalDecision}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.4 }}>
            {blocked
              ? `Blocked: ${blockReasons.slice(0, 2).join('; ') || 'risk gate'}`
              : `Quant ${quant}, regime ${regime}, AI ${aiSig}.`}
          </div>
        </div>
      </div>

      {/* ── 4. AI CONSENSUS + EXECUTION LEDGER ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 0 }}>
        <div className="ws-panel" style={{ borderRight: '1px solid var(--border)', paddingRight: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="section-label" style={{ margin: 0, color: 'var(--ai)' }}><span className="accent-bar" style={{ background: 'var(--ai)' }} />AI CONSENSUS</span>
            <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => onNavigateWorkspace('intelligence')}>Chamber →</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 900, color: aiSig === 'BUY' ? 'var(--accent)' : aiSig === 'SELL' ? 'var(--negative)' : 'var(--warn)' }}>{aiSig}</span>
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>Conviction {verdict?.rating ?? 3}/5 · {verdict?.deep_model ?? aiProvider ?? 'quant'}</span>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>
            {verdict?.reasoning ? verdict.reasoning.slice(0, 200) : signal?.ai?.reason ?? 'Multi-agent committee evaluating the setup. Open the Intelligence workspace for bull/bear debate and agent evidence.'}
          </p>
        </div>

        <div className="ws-panel" style={{ paddingLeft: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="section-label" style={{ margin: 0 }}><span className="accent-bar" />EXECUTION LEDGER</span>
            <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => onNavigateWorkspace('history')}>History →</button>
          </div>
          {fills.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', padding: '10px 0' }}>No fills recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {fills.slice(0, 4).map((f, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={`badge-side ${f.side.toLowerCase()}`}>{f.side}</span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--mono)', cursor: 'pointer', color: 'var(--text-1)' }} onClick={() => onSelectSymbol(f.symbol)}>{f.symbol}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-1)' }}>{usd(Number(f.price))}</span>
                    <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--surface-2)', color: f.actor === 'user' ? 'var(--ai)' : 'var(--muted)', borderRadius: 3, fontFamily: 'var(--mono)', fontWeight: 700 }}>{f.actor === 'user' ? 'YOU' : 'BOT'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DecisionChain state={state} signal={signal} risk={risk} verdict={verdict} />
    </div>
  )
}

function ConfluenceCell({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'pos' | 'neg' | 'warn' | 'info' }) {
  const color = tone === 'pos' ? 'var(--accent)' : tone === 'neg' ? 'var(--negative)' : tone === 'info' ? 'var(--info)' : 'var(--warn)'
  return (
    <div style={{ padding: '10px 16px', borderRight: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{sub}</div>
    </div>
  )
}
