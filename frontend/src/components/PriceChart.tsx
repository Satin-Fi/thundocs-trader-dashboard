import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi,
  type UTCTimestamp, type SeriesMarker, type Time, type IPriceLine,
  type LineData,
} from 'lightweight-charts'
import type { Kline, Fill } from '../types'
import type { Indicators } from '../api'

export interface IndicatorOpts {
  ema20: boolean
  ema50: boolean
  breakout: boolean
  rsi: boolean
  macd: boolean
  sr: boolean
}

interface Props {
  klines: Kline[]
  fills: Fill[]
  position: { entry: number; stop_loss: number; take_profit: number } | null
  livePrice: number
  interval: string
  indicators: Indicators | null
  opts: IndicatorOpts
}

export default function PriceChart({ klines, fills, position, livePrice, interval, indicators, opts }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const boUpRef = useRef<ISeriesApi<'Line'> | null>(null)
  const boLoRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const macdSigRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiWrapRef = useRef<HTMLDivElement | null>(null)
  const macdWrapRef = useRef<HTMLDivElement | null>(null)
  const slLinesRef = useRef<IPriceLine[]>([])
  const srLinesRef = useRef<IPriceLine[]>([])
  const liveLineRef = useRef<IPriceLine | null>(null)
  const shownInterval = useRef<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // create charts once — use autoSize so each chart ALWAYS fills its container
  // box exactly (no manual width => cannot overflow / go out of the container).
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setErr(null)
    try {
      const chart = createChart(el, {
        autoSize: true, height: 440,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#aeb4c0', fontFamily: 'Inter, system-ui, sans-serif' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
        handleScale: true, handleScroll: true,
      })
      const candle = chart.addCandlestickSeries({ upColor: '#00d992', downColor: '#fb565b', borderUpColor: '#00d992', borderDownColor: '#fb565b', wickUpColor: '#00d992', wickDownColor: '#fb565b' })
      const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
      try { chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } }) } catch {}

      // RSI sub-chart (created on a mounted ref div so autoSize can measure it)
      const rsiChart = createChart(rsiWrapRef.current!, { autoSize: true, height: 120, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#aeb4c0' }, grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } }, rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' }, timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false }, handleScale: false, handleScroll: true })
      const rsi = rsiChart.addLineSeries({ color: '#a78bfa', lineWidth: 2, priceFormat: { type: 'custom', formatter: (p: number) => p.toFixed(0) } })
      // RSI 30/70 guides
      rsi.createPriceLine({ price: 70, color: 'rgba(251,86,91,0.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '70' })
      rsi.createPriceLine({ price: 30, color: 'rgba(0,217,146,0.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '30' })

      // MACD sub-chart
      const macdChart = createChart(macdWrapRef.current!, { autoSize: true, height: 120, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#aeb4c0' }, grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } }, rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' }, timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false }, handleScale: false, handleScroll: true })
      const macdHist = macdChart.addHistogramSeries({ priceFormat: { type: 'custom', formatter: (p: number) => p.toFixed(0) } })
      const macdLine = macdChart.addLineSeries({ color: '#4ea8ff', lineWidth: 2 })
      const macdSig = macdChart.addLineSeries({ color: '#facc15', lineWidth: 2 })

      chartRef.current = chart; candleRef.current = candle; volRef.current = vol
      rsiChartRef.current = rsiChart; rsiRef.current = rsi
      macdChartRef.current = macdChart; macdHistRef.current = macdHist; macdLineRef.current = macdLine; macdSigRef.current = macdSig
      ;(window as any).__diag = () => ({
        rsiData: rsiRef.current ? rsiRef.current.data().length : -1,
        macdData: macdHistRef.current ? macdHistRef.current.data().length : -1,
        rsiWrapH: rsiWrapRef.current ? Math.round(rsiWrapRef.current.getBoundingClientRect().height) : -1,
        rsiWrapW: rsiWrapRef.current ? Math.round(rsiWrapRef.current.getBoundingClientRect().width) : -1,
        canvasCount: rsiWrapRef.current ? rsiWrapRef.current.querySelectorAll('canvas').length : -1,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // autoSize handles responsiveness; no manual width sync needed.

  // candle/volume/trade data + SL/TP + fit on interval change
  useEffect(() => {
    const candle = candleRef.current, vol = volRef.current, chart = chartRef.current
    if (!candle || !vol || !chart) return
    setErr(null)
    try {
      const t = (k: Kline): UTCTimestamp => (k.t / 1000) as UTCTimestamp
      candle.setData(klines.map(k => ({ time: t(k), open: k.o, high: k.h, low: k.l, close: k.c })))
      vol.setData(klines.map(k => ({ time: t(k), value: k.v, color: k.c >= k.o ? 'rgba(0,217,146,0.4)' : 'rgba(251,86,91,0.4)' })))
      const markers: SeriesMarker<Time>[] = fills.filter(f => (f.side === 'BUY' || f.side === 'SELL') && f.t).map(f => ({
        time: (Date.parse(f.t) / 1000) as UTCTimestamp,
        position: (f.side === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: f.side === 'BUY' ? '#00d992' : '#fb565b',
        shape: (f.side === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: f.side === 'BUY' ? 'B' : 'S',
      }))
      candle.setMarkers(markers)
      slLinesRef.current.forEach(l => { try { candle.removePriceLine(l) } catch {} })
      slLinesRef.current = []
      if (position) {
        const add = (price: number, color: string, title: string) => slLinesRef.current.push(candle.createPriceLine({ price, color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title }))
        add(position.entry, '#22d3ee', 'ENTRY')
        add(position.stop_loss, '#f43f5e', 'SL')
        add(position.take_profit, '#facc15', 'TP')
      }
      if (shownInterval.current !== interval) { chart.timeScale().fitContent(); shownInterval.current = interval }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [klines, fills, position, interval])

  // indicators: overlays + sub-charts, driven by opts toggles
  useEffect(() => {
    const chart = chartRef.current
    const candle = candleRef.current
    const rsi = rsiRef.current
    const mh = macdHistRef.current, ml = macdLineRef.current, ms = macdSigRef.current
    if (!chart || !candle || !rsi || !mh || !ml || !ms || !indicators) return
    try {
      const times = indicators.times as UTCTimestamp[]
      const toLine = (vals: (number | null)[]): LineData[] =>
        vals.map((v, i) => ({ time: times[i], value: v as number })).filter(d => d.value != null)

      // EMA overlays on the MAIN price chart
      if (!ema20Ref.current) ema20Ref.current = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
      if (!ema50Ref.current) ema50Ref.current = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
      ema20Ref.current.applyOptions({ visible: opts.ema20 }); ema50Ref.current.applyOptions({ visible: opts.ema50 })
      if (opts.ema20) ema20Ref.current.setData(toLine(indicators.ema20))
      if (opts.ema50) ema50Ref.current.setData(toLine(indicators.ema50))

      // Breakout bands on the main chart
      if (!boUpRef.current) boUpRef.current = chart.addLineSeries({ color: 'rgba(34,211,238,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
      if (!boLoRef.current) boLoRef.current = chart.addLineSeries({ color: 'rgba(244,63,94,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
      boUpRef.current.applyOptions({ visible: opts.breakout }); boLoRef.current.applyOptions({ visible: opts.breakout })
      if (opts.breakout) { boUpRef.current.setData(toLine(indicators.breakout_upper)); boLoRef.current.setData(toLine(indicators.breakout_lower)) }

      // Support / Resistance zones — price lines on the main chart, one per zone,
      // colored by type (green support / red resistance) and thickness by strength.
      srLinesRef.current.forEach(l => { try { candle.removePriceLine(l) } catch {} })
      srLinesRef.current = []
      if (opts.sr && indicators.sr_zones) {
        for (const z of indicators.sr_zones) {
          const isS = z.type === 'S'
          srLinesRef.current.push(candle.createPriceLine({
            price: z.level,
            color: isS ? 'rgba(0,217,146,0.55)' : 'rgba(251,86,91,0.55)',
            lineWidth: z.strength >= 6 ? 3 : z.strength >= 3 ? 2 : 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${isS ? 'S' : 'R'} ${z.level.toFixed(0)}`,
          }))
        }
      }

      // RSI sub-chart
      if (opts.rsi) { rsi.setData(toLine(indicators.rsi)); rsiChartRef.current?.timeScale().fitContent() }
      else rsi.setData([])

      // MACD sub-chart
      if (opts.macd) {
        mh.setData(indicators.macd_hist.map((v: number, i: number) => ({ time: times[i], value: v, color: v >= 0 ? 'rgba(0,217,146,0.6)' : 'rgba(251,86,91,0.6)' })))
        ml.setData(toLine(indicators.macd_line))
        ms.setData(toLine(indicators.macd_signal))
        macdChartRef.current?.timeScale().fitContent()
      } else {
        mh.setData([]); ml.setData([]); ms.setData([])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [indicators, opts])

  // live price line — every tick, no re-fit
  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return
    try {
      if (liveLineRef.current) candle.removePriceLine(liveLineRef.current)
      liveLineRef.current = candle.createPriceLine({ price: livePrice, color: '#e8edf5', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'LIVE' })
    } catch {}
  }, [livePrice])

  // sub-chart boxes only take space when their toggle is ON (off => hidden)
  useEffect(() => {
    if (rsiWrapRef.current) rsiWrapRef.current.style.display = opts.rsi ? '' : 'none'
    if (macdWrapRef.current) macdWrapRef.current.style.display = opts.macd ? '' : 'none'
  }, [opts.rsi, opts.macd])

  if (err) return <div ref={wrapRef} className="tv-chart"><div className="chart-err">chart error: {err}</div></div>
  return (
    <div className="tvwrap">
      <div ref={wrapRef} className="tv-chart" />
      <div className="chart-subs">
        <div ref={rsiWrapRef} className="subchart" />
        <div ref={macdWrapRef} className="subchart" />
      </div>
    </div>
  )
}
