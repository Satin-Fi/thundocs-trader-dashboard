import PriceChart, { type IndicatorOpts } from '../PriceChart'
import ManualTrade from '../ManualTrade'
import TradeTable from '../TradeTable'
import type { State, Klines, Indicators, Fill } from '../../types'

interface Props {
  state: State | null
  klines: Klines | null
  indicators: Indicators | null
  tfState: string
  setTf: (tf: string) => void
  opts: IndicatorOpts
  setOpts: React.Dispatch<React.SetStateAction<IndicatorOpts>>
  fills: Fill[]
}

export default function TradeWorkspace({
  state,
  klines,
  indicators,
  tfState,
  setTf,
  opts,
  setOpts,
  fills,
}: Props) {
  const activePos = state?.positions?.find((p) => p.symbol === state.symbol)
  const posObj = activePos && activePos.entry ? {
    entry: activePos.entry,
    stop_loss: activePos.stop_loss ?? 0,
    take_profit: activePos.take_profit ?? 0,
  } : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── BENTO MAIN: CHART + EXECUTION PANEL ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 12 }}>
        {/* Left: Interactive Candlestick Chart */}
        <div className="card-bezel chart-panel" style={{ minHeight: 640 }}>
          <div className="card-inner" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="chart-toolbar">
              <div className="tf-group">
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <button
                    key={tf}
                    className={`tf-btn ${tfState === tf ? 'active' : ''}`}
                    onClick={() => setTf(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              <div className="ind-group">
                {(
                  [
                    ['ema20', 'EMA 20'],
                    ['ema50', 'EMA 50'],
                    ['breakout', 'Breakout'],
                    ['rsi', 'RSI'],
                    ['macd', 'MACD'],
                    ['sr', 'S/R'],
                  ] as [keyof IndicatorOpts, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`ind-chip ${opts[key] ? 'on' : ''}`}
                    onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <PriceChart
              klines={klines?.candles ?? []}
              indicators={indicators}
              livePrice={state?.price ?? 0}
              interval={tfState}
              position={posObj}
              opts={opts}
              fills={fills}
            />
          </div>
        </div>

        {/* Right: Order Execution & Live Position Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ManualTrade state={state} fills={fills} />
        </div>
      </div>

      {/* ── BOTTOM DRAWER: EXECUTION LEDGER ── */}
      <div className="card-bezel">
        <div className="card-inner">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              Execution Fills &amp; Order Stream ({fills.length})
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              Deterministic local ledger audit
            </span>
          </div>

          <TradeTable fills={fills} />
        </div>
      </div>
    </div>
  )
}
