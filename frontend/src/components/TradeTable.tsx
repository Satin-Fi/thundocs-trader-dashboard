import type { Fill } from '../types'

export default function TradeTable({ fills }: { fills: Fill[] }) {
  if (!fills.length) return <div className="empty">no trades yet — the bot will log fills here as signals fire</div>
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th><th>Side</th><th>Qty (BTC)</th><th>Price</th><th>Value (USDT)</th>
        </tr>
      </thead>
      <tbody>
        {fills.map((f, i) => (
          <tr key={i}>
            <td className="t-time">{new Date(f.t).toLocaleString()}</td>
            <td><span className={`badge ${f.side.toLowerCase()}`}>{f.side}</span></td>
            <td>{f.qty}</td>
            <td>${f.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${(f.qty * f.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
