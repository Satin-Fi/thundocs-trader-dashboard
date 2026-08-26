import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onSelectWorkspace: (ws: string) => void
  onSelectSymbol: (sym: string) => void
  onTriggerAI: () => void
  onOpenBridge: () => void
}

export default function CommandPalette({
  open,
  onClose,
  onSelectWorkspace,
  onSelectSymbol,
  onTriggerAI,
  onOpenBridge,
}: Props) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) onClose()
        else {
          setQuery('')
          // trigger open
        }
      }
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const commands = [
    { cat: 'Workspaces', label: 'Overview Workspace', action: () => onSelectWorkspace('overview'), hint: 'G O' },
    { cat: 'Workspaces', label: 'Trade Execution & Chart', action: () => onSelectWorkspace('trade'), hint: 'G T' },
    { cat: 'Workspaces', label: 'Multi-Agent Intelligence', action: () => onSelectWorkspace('intelligence'), hint: 'G I' },
    { cat: 'Workspaces', label: 'Opportunity Scanner (20 Pairs)', action: () => onSelectWorkspace('scanner'), hint: 'G S' },
    { cat: 'Workspaces', label: 'Strategies & Auto-Tuner Lab', action: () => onSelectWorkspace('strategies'), hint: 'G L' },
    { cat: 'Workspaces', label: 'Portfolio Performance & Attribution', action: () => onSelectWorkspace('portfolio'), hint: 'G P' },
    { cat: 'Workspaces', label: 'Trade History Ledger', action: () => onSelectWorkspace('history'), hint: 'G H' },
    { cat: 'Actions', label: 'Run Multi-Agent Consensus Cycle', action: onTriggerAI, hint: '⌘ R' },
    { cat: 'Actions', label: 'Configure Cloudflare Bridge URL', action: onOpenBridge, hint: '⌘ B' },
    { cat: 'Markets', label: 'Switch to BTC-USD / BTCUSDT', action: () => onSelectSymbol('BTCUSDT'), hint: '$ BTC' },
    { cat: 'Markets', label: 'Switch to ETH-USD / ETHUSDT', action: () => onSelectSymbol('ETHUSDT'), hint: '$ ETH' },
    { cat: 'Markets', label: 'Switch to SOL-USD / SOLUSDT', action: () => onSelectSymbol('SOLUSDT'), hint: '$ SOL' },
    { cat: 'Markets', label: 'Switch to BNB-USD / BNBUSDT', action: () => onSelectSymbol('BNBUSDT'), hint: '$ BNB' },
    { cat: 'Markets', label: 'Switch to DOGE-USD / DOGEUSDT', action: () => onSelectSymbol('DOGEUSDT'), hint: '$ DOGE' },
  ]

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.cat.toLowerCase().includes(query.toLowerCase()) ||
    c.hint.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        className="card-bezel"
        style={{
          maxWidth: 540,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', marginRight: 10 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            autoFocus
            type="text"
            placeholder="Type a command, workspace or market symbol..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text)',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'var(--font)',
            }}
          />
          <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>ESC</span>
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              No commands matching "{query}"
            </div>
          ) : (
            filtered.map((c, i) => (
              <div
                key={i}
                onClick={() => {
                  c.action()
                  onClose()
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12.5,
                  color: 'var(--text)',
                  transition: 'all 0.1s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: 'var(--surface)', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>{c.cat}</span>
                  <span>{c.label}</span>
                </div>
                <span style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{c.hint}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
