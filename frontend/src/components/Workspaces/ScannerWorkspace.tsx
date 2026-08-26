import Scanner from '../Scanner'

interface Props {
  onSelectSymbol: (sym: string) => void
}

export default function ScannerWorkspace({ onSelectSymbol }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card-bezel">
        <div className="card-inner">
          <Scanner onSelectSymbol={onSelectSymbol} />
        </div>
      </div>
    </div>
  )
}
