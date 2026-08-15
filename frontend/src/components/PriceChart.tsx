import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type Time, type IPriceLine } from 'lightweight-charts'
import type { Kline, Fill } from '../types'

interface Props {
  klines: Kline[]
  fills: Fill[]
  position: {
    entry: number
    stop_loss: number
    take_profit: number
  } | null
  livePrice: number
  interval: string
}

export default function PriceChart({ klines, fills, position, livePrice, interval }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const slLinesRef = useRef<IPriceLine[]>([])      // entry / SL / TP lines
  const liveLineRef = useRef<IPriceLine | null>(null)
  const shownInterval = useRef<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // create chart once, with explicit width
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setErr(null)
    try {
      const w = el.clientWidth || el.parentElement?.clientWidth || 800
      const chart = createChart(el, {
        width: w,
        height: 440,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#aeb4c0',
          fontFamily: 'Inter, system-ui, sans-serif',
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.05)' },
          horzLines: { color: 'rgba(255,255,255,0.05)' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
        handleScale: true,
        handleScroll: true,
      })
      const candle = chart.addCandlestickSeries({
        upColor: '#00d992', downColor: '#fb565b',
        borderUpColor: '#00d992', borderDownColor: '#fb565b',
        wickUpColor: '#00d992', wickDownColor: '#fb565b',
      })
      const vol = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      })
      try { chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } }) } catch {}
      chartRef.current = chart
      candleRef.current = candle
      volRef.current = vol
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // keep width in sync with container
  useLayoutEffect(() => {
    const el = wrapRef.current, chart = chartRef.current
    if (!el || !chart) return
    const ro = new ResizeObserver(() => {
      try { chart.applyOptions({ width: el.clientWidth || 800 }) } catch {}
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // push candle/volume data + markers + entry/SL/TP lines when data or position changes
  useEffect(() => {
    const candle = candleRef.current, vol = volRef.current, chart = chartRef.current
    if (!candle || !vol || !chart) return
    setErr(null)
    try {
      candle.setData(klines.map(k => ({
        time: (k.t / 1000) as UTCTimestamp,
        open: k.o, high: k.h, low: k.l, close: k.c,
      })))
      vol.setData(klines.map(k => ({
        time: (k.t / 1000) as UTCTimestamp,
        value: k.v,
        color: k.c >= k.o ? 'rgba(0,217,146,0.4)' : 'rgba(251,86,91,0.4)',
      })))

      const markers: SeriesMarker<Time>[] = fills
        .filter(f => (f.side === 'BUY' || f.side === 'SELL') && f.t)
        .map(f => ({
          time: (Date.parse(f.t) / 1000) as UTCTimestamp,
          position: (f.side === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          color: f.side === 'BUY' ? '#00d992' : '#fb565b',
          shape: (f.side === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          text: f.side === 'BUY' ? 'B' : 'S',
        }))
      candle.setMarkers(markers)

      // entry / SL / TP lines — vivid, distinct colors so they don't blend into candles
      slLinesRef.current.forEach(l => { try { candle.removePriceLine(l) } catch {} })
      slLinesRef.current = []
      const addLine = (price: number, color: string, title: string) =>
        slLinesRef.current.push(candle.createPriceLine({ price, color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title }))
      if (position) {
        addLine(position.entry, '#22d3ee', 'ENTRY')        // cyan
        addLine(position.stop_loss, '#f43f5e', 'SL')       // rose/red
        addLine(position.take_profit, '#facc15', 'TP')     // gold
      } else {
        addLine(livePrice, '#22d3ee', 'ENTRY')
      }

      // keep the PRICE scale including SL/TP in view (never touch the TIME axis
      // here, so dragging/scrolling the chart does not snap back)
      const lows = klines.map(k => k.l), highs = klines.map(k => k.h)
      const prices = [...lows, ...highs, livePrice]
      if (position) prices.push(position.entry, position.stop_loss, position.take_profit)
      const pmin = Math.min(...prices), pmax = Math.max(...prices)
      const pad = (pmax - pmin) * 0.1 || 1
      chart.priceScale('right').applyOptions({ autoScale: false, visibleRange: { from: pmin - pad, to: pmax + pad } })

      // ONLY re-fit the TIME axis when the interval changes — never on a live tick
      if (shownInterval.current !== interval) {
        chart.timeScale().fitContent()
        shownInterval.current = interval
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [klines, fills, position, interval])

  // live price line — updates on every tick WITHOUT touching data or re-fitting
  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return
    try {
      if (liveLineRef.current) candle.removePriceLine(liveLineRef.current)
      liveLineRef.current = candle.createPriceLine({
        price: livePrice, color: '#e8edf5', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'LIVE',
      })
    } catch {}
  }, [livePrice])

  if (err) {
    return (
      <div ref={wrapRef} className="tv-chart">
        <div className="chart-err">chart error: {err}</div>
      </div>
    )
  }
  return <div ref={wrapRef} className="tv-chart" />
}
