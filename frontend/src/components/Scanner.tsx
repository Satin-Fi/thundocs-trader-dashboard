import { useEffect, useState } from 'react'
import { fetchScanner, ScannerResult, setSymbol } from '../api'

export default function Scanner({ onSelectSymbol }: { onSelectSymbol?: (sym: string) => void }) {
  const [results, setResults] = useState<ScannerResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchScanner()
        setResults(res.results)
      } catch (e) { console.error("Scanner load err", e) }
      finally { setLoading(false) }
    }
    load()
    const int = setInterval(load, 30000)
    return () => clearInterval(int)
  }, [])

  if (loading) return <div className="state-empty">Scanning top 20 USDT pairs for opportunities…</div>
  if (!results.length) return <div className="state-empty">Scanner starting up, waiting for first market cycle…</div>

  return (
    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Smart Market Scanner · Top Volume Pairs
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 16 }}>
        Real-time multi-asset intelligence: scans top 20 Binance USDT markets on 15m timeframes for breakout, oversold &amp; trend continuation setups.
      </div>
      
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market Pair</th>
              <th>Live Price</th>
              <th>24h Delta</th>
              <th>15m RSI</th>
              <th>Bot Assessment</th>
              <th style={{ textAlign: 'right' }}>Execution</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => {
              let stateColor = 'var(--text-2)'
              let bg = 'var(--surface)'
              let border = 'var(--border)'
              if (r.state.includes('Buy') || r.state.includes('Breakout') || r.state.includes('Oversold')) {
                stateColor = 'var(--accent)'
                bg = 'var(--accent-soft)'
                border = 'var(--accent-border)'
              } else if (r.state.includes('Sell') || r.state.includes('Overbought')) {
                stateColor = 'var(--negative)'
                bg = 'var(--negative-soft)'
                border = 'var(--negative-border)'
              }
              
              return (
                <tr key={r.symbol}>
                  <td style={{ fontWeight: 800, color: 'var(--text)' }}>
                    <span style={{ fontFamily: 'var(--mono)' }}>{r.symbol.replace('USDT', '')}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>/USDT</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>${r.price < 1 ? r.price.toFixed(4) : r.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: r.priceChange >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                    {r.priceChange > 0 ? '+' : ''}{r.priceChange.toFixed(2)}%
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.rsi.toFixed(1)}</td>
                  <td>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: bg, color: stateColor, border: `1px solid ${border}` }}>
                      {r.state}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button 
                      className="btn-secondary"
                      onClick={async () => {
                        try {
                          await setSymbol(r.symbol)
                          if (onSelectSymbol) {
                            onSelectSymbol(r.symbol)
                          } else {
                            window.location.reload()
                          }
                        } catch (e) {}
                      }}
                      style={{ padding: '4px 10px', fontSize: 11, display: 'inline-flex' }}
                    >
                      Trade Chart ↗
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
