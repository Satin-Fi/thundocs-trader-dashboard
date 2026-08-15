import { useEffect, useRef } from 'react'
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, type UTCTimestamp, type SeriesMarker, type Time } from 'lightweight-charts'
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
}

export default function PriceChart({ klines, fills, position, livePrice }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const linesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const lastLen = useRef(0)

  // create chart once
  useEffect(() => {
    if (!wrapRef.current) return
    const chart = createChart(wrapRef.current, {
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
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    chartRef.current = chart
    candleRef.current = candle
    volRef.current = vol
    const ro = new ResizeObserver(() => chart.applyOptions({ width: wrapRef.current?.clientWidth ?? 800 }))
    ro.observe(wrapRef.current)
    chart.applyOptions({ width: wrapRef.current.clientWidth })
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [])

  // push data + markers + price lines whenever inputs change
  useEffect(() => {
    const candle = candleRef.current, vol = volRef.current, chart = chartRef.current
    if (!candle || !vol || !chart) return

    const cdata: CandlestickData[] = klines.map(k => ({
      time: (k.t / 1000) as UTCTimestamp,
      open: k.o, high: k.h, low: k.l, close: k.c,
    }))
    const vdata: HistogramData[] = klines.map(k => ({
      time: (k.t / 1000) as UTCTimestamp,
      value: k.v,
      color: k.c >= k.o ? 'rgba(0,217,146,0.4)' : 'rgba(251,86,91,0.4)',
    }))
    candle.setData(cdata)
    vol.setData(vdata)
    lastLen.current = cdata.length

    // trade markers (buy/sell)
    const markers: SeriesMarker<Time>[] = fills
      .filter(f => f.side === 'BUY' || f.side === 'SELL')
      .map(f => ({
        time: (Date.parse(f.t) / 1000) as UTCTimestamp,
        position: f.side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: f.side === 'BUY' ? '#00d992' : '#fb565b',
        shape: f.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: f.side === 'BUY' ? 'B' : 'S',
      }))
    candle.setMarkers(markers)

    // price lines: entry / SL / TP / live — remove previous first to avoid stacking
    linesRef.current.forEach(l => candle.removePriceLine(l))
    linesRef.current = []
    const addLine = (price: number, color: string, title: string, style: 0 | 2 | 3 = 2) =>
      linesRef.current.push(candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }))
    addLine(position?.entry ?? livePrice, '#00d992', 'ENTRY')
    if (position) {
      addLine(position.stop_loss, '#fb565b', 'SL')
      addLine(position.take_profit, '#00d992', 'TP')
    }
    addLine(livePrice, '#e8edf5', 'LIVE', 3)
    chart.timeScale().fitContent()
  }, [klines, fills, position, livePrice])

  return <div ref={wrapRef} className="tv-chart" />
}
