import { useState, useEffect, useRef } from 'react'

export default function SymbolSearch({ currentSymbol, onSymbolChange }: { currentSymbol: string, onSymbolChange: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [symbols, setSymbols] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(r => r.json())
      .then(d => {
        if (d.symbols) {
          const usdtPairs = d.symbols.filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING').map((s: any) => s.symbol)
          setSymbols(usdtPairs)
        }
      })
      .catch(() => {}) 
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = symbols
    .filter(s => s.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 100) 

  const displayList = symbols.length === 0 && query === '' 
    ? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
    : filtered

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button 
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
          background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', outline: 'none'
        }}
      >
        {currentSymbol}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 12,
          width: 200, background: 'var(--panel)', border: '1px solid var(--border-strong)',
          borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: '8px' }}>
            <input
              type="text" autoFocus placeholder="Search pair..." value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: '6px 10px', borderRadius: 4, fontSize: 12, outline: 'none', fontFamily: 'var(--mono)'
              }}
            />
          </div>
          
          <div style={{ maxHeight: 250, overflowY: 'auto', padding: '0 4px 4px' }}>
            {displayList.length === 0 ? (
              <div style={{ padding: '10px', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>No pairs found</div>
            ) : (
              displayList.map(sym => (
                <button
                  key={sym}
                  onClick={() => { setOpen(false); setQuery(''); onSymbolChange(sym) }}
                  style={{
                    width: '100%', textAlign: 'left', background: sym === currentSymbol ? 'var(--bg)' : 'transparent',
                    border: 'none', color: sym === currentSymbol ? 'var(--accent)' : 'var(--text)',
                    padding: '6px 10px', fontSize: 12, fontWeight: sym === currentSymbol ? 700 : 500,
                    borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = sym === currentSymbol ? 'var(--bg)' : 'transparent'}
                >
                  <span style={{ fontFamily: 'var(--mono)' }}>{sym.replace('USDT', '')}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>USDT</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
