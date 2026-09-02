'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { withCreds } from '@/lib/kite-creds';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import { INDEX_SPECS } from '@/lib/kite-api';
import { Badge } from '@/components/ui/badge';
// Symbol type is just a string identifier
import { Crosshair, Maximize2, Minimize2, RefreshCw, Wifi, WifiOff } from 'lucide-react';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FlowBar {
  time: number;       // unix seconds
  bullish: number;     // CE Buy + PE Write
  bearish: number;     // PE Buy + CE Write
  netFlow: number;     // bullish - bearish
  cumDelta: number;
  ceBuy: number;
  peWrite: number;
  peBuy: number;
  ceWrite: number;
}

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

type SymbolId = string;

const SYMBOLS: { value: SymbolId; label: string; token: number }[] = [
  { value: 'NIFTY', label: 'Nifty 50', token: 256265 },
  { value: 'BANKNIFTY', label: 'Bank Nifty', token: 260105 },
  { value: 'SENSEX', label: 'Sensex', token: 265 },
  { value: 'FINNIFTY', label: 'Fin Nifty', token: 257801 },
];

const INTERVALS = [
  { value: '3minute', label: '3m' },
  { value: '5minute', label: '5m' },
  { value: '15minute', label: '15m' },
  { value: '60minute', label: '1h' },
];

const CROR = 10000000;

const THEME = {
  bg: '#0a0e17',
  paneBg: '#0a0e17',
  gridColor: '#1a1f2e',
  textColor: '#64748b',
  textMuted: '#475569',
  borderColor: '#1e293b',
  crosshairColor: '#475569',
  // Candle colors
  bullCandle: '#22c55e',
  bearCandle: '#ef4444',
  bullWick: '#22c55e',
  bearWick: '#ef4444',
  // Flow colors
  ceBuy: '#16a34a',
  peWrite: '#4ade80',
  peBuy: '#dc2626',
  ceWrite: '#f87171',
  bullish: '#22c55e',
  bearish: '#ef4444',
  cumDelta: '#fbbf24',
  volumeUp: 'rgba(34,197,94,0.25)',
  volumeDn: 'rgba(239,68,68,0.25)',
};

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

export default function OptionFlowTV() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volSeriesRef = useRef<any>(null);
  const bullSeriesRef = useRef<any>(null);
  const bearSeriesRef = useRef<any>(null);
  const cumDeltaSeriesRef = useRef<any>(null);
  const flowBarsRef = useRef<FlowBar[]>([]);
  const cumDeltaRef = useRef(0);
  const prevFlowRef = useRef<any>(null);
  const legendRef = useRef<HTMLDivElement>(null);

  const [symbol, setSymbol] = useState<SymbolId>('NIFTY');
  const [interval, setInterval] = useState('5minute');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [legend, setLegend] = useState({
    o: '--', h: '--', l: '--', c: '--', v: '--',
    bull: '--', bear: '--', net: '--', cum: '--',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Get snapshot for real-time data (uses singleton — no symbol filter needed)
  const { curr, prev, pollCount, errorCount } = useKiteSnapshot();

  // ─── Initialize chart ───
  const initChart = useCallback(async () => {
    if (!containerRef.current) return;

    // Cleanup existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const { createChart, CandlestickSeries, HistogramSeries, LineSeries } = await import('lightweight-charts');

    const container = containerRef.current;
    const h = container.clientHeight;

    const chart = createChart(container, {
      layout: {
        background: { type: 'solid', color: THEME.bg },
        textColor: THEME.textColor,
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: THEME.gridColor },
        horzLines: { color: THEME.gridColor },
      },
      crosshair: {
        mode: 0, // Normal
        vertLine: { color: THEME.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: THEME.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: { borderColor: THEME.borderColor, scaleMargins: { top: 0.05, bottom: 0.25 } },
      timeScale: {
        borderColor: THEME.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // ── Candlestick series ──
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.bullCandle,
      downColor: THEME.bearCandle,
      borderUpColor: THEME.bullCandle,
      borderDownColor: THEME.bearCandle,
      wickUpColor: THEME.bullWick,
      wickDownColor: THEME.bearWick,
    });

    // ── Volume series (overlay on candlestick) ──
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // ── OI Flow pane: Bullish histogram ──
    const bullSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      color: THEME.bullish,
    });

    // ── OI Flow pane: Bearish histogram ──
    const bearSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      color: THEME.bearish,
    });

    // ── Cumulative Delta line ──
    const cumDeltaSeries = chart.addSeries(LineSeries, {
      color: THEME.cumDelta,
      lineWidth: 1.5,
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Store refs
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    bullSeriesRef.current = bullSeries;
    bearSeriesRef.current = bearSeries;
    cumDeltaSeriesRef.current = cumDeltaSeries;

    // ── Crosshair legend ──
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData) {
        return;
      }
      const candleData = param.seriesData.get(candleSeries) as any;
      const volData = param.seriesData.get(volSeries) as any;
      const bullData = param.seriesData.get(bullSeries) as any;
      const bearData = param.seriesData.get(bearSeries) as any;
      const cumData = param.seriesData.get(cumDeltaSeries) as any;

      setLegend({
        o: candleData?.open?.toFixed(1) ?? '--',
        h: candleData?.high?.toFixed(1) ?? '--',
        l: candleData?.low?.toFixed(1) ?? '--',
        c: candleData?.close?.toFixed(1) ?? '--',
        v: volData?.value ? (volData.value / 100000).toFixed(1) + 'L' : '--',
        bull: bullData?.value ? (bullData.value / CROR).toFixed(2) + ' Cr' : '--',
        bear: bearData?.value ? (bearData.value / CROR).toFixed(2) + ' Cr' : '--',
        net: bullData && bearData ? (((bullData.value || 0) - (bearData.value || 0)) / CROR).toFixed(2) + ' Cr' : '--',
        cum: cumData?.value ? (cumData.value / CROR).toFixed(2) + ' Cr' : '--',
      });
    });

    // ── Fetch candles ──
    setIsLoading(true);
    setError('');

    try {
      const symInfo = SYMBOLS.find(s => s.value === symbol);
      const token = symInfo?.token || 256265;
      const res = await fetch(withCreds(`/api/kite/candles?token=${token}&interval=${interval}&days=1`));
      const data = await res.json();

      if (data.mode === 'demo' || data.count === 0) {
        setError('No candle data available. Check Kite credentials.');
        setIsLoading(false);
        return;
      }

      const candles: CandleData[] = data.candles.map((c: any) => ({
        time: new Date(c.timestamp * 1000).toISOString().split('T')[0] + ' ' +
               new Date(c.timestamp * 1000).toISOString().split('T')[1].substring(0, 5),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      candleSeries.setData(candles);

      // Volume with color based on candle direction
      const volData = candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? THEME.volumeUp : THEME.volumeDn,
      }));
      volSeries.setData(volData);

      chart.timeScale().fitContent();
    } catch (e: any) {
      setError('Failed to load candles: ' + e.message);
    }

    setIsLoading(false);
  }, [symbol, interval]);

  // ─── Init chart on mount and when symbol/interval changes ───
  useEffect(() => {
    initChart();
    flowBarsRef.current = [];
    cumDeltaRef.current = 0;
    prevFlowRef.current = null;

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [initChart]);

  // ─── Resize observer ───
  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return;
    const ro = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: containerRef.current!.clientWidth, height: containerRef.current!.clientHeight });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ─── Process flow data from snapshots ───
  useEffect(() => {
    if (!curr || !prev || !bullSeriesRef.current) return;

    const spec = INDEX_SPECS.find(s => s.symbol === symbol);
    if (!spec) return;

    // Find this symbol's flow data
    const currFlow = curr.symbols?.find((s: any) => s.symbol === symbol);
    const prevFlow = prev.symbols?.find((s: any) => s.symbol === symbol);
    if (!currFlow || !prevFlow) return;

    // Compute 4-color flow from OI diffs across strikes
    let ceBuy = 0, peWrite = 0, peBuy = 0, ceWrite = 0;

    for (const cs of currFlow.strikes || []) {
      const ps = (prevFlow.strikes || []).find((s: any) => s.strike === cs.strike);
      if (!ps) continue;

      const ceOiChg = (cs.ceOI || 0) - (ps.ceOI || 0);
      const peOiChg = (cs.peOI || 0) - (ps.peOI || 0);
      const ceLtpChg = (cs.ceLTP || 0) - (ps.ceLTP || 0);
      const peLtpChg = (cs.peLTP || 0) - (ps.peLTP || 0);

      // CE Buy: OI increased + LTP up (writers paying up = buyers aggressive)
      if (ceOiChg > 0 && ceLtpChg >= 0) ceBuy += ceOiChg * (cs.ceLTP || 0) * (spec.lotSize || 1);
      // CE Write: OI increased + LTP down (writers adding at lower prices = selling)
      else if (ceOiChg > 0 && ceLtpChg < 0) ceWrite += ceOiChg * (cs.ceLTP || 0) * (spec.lotSize || 1);

      // PE Write: OI increased + LTP up (writers writing PE as market rises)
      if (peOiChg > 0 && peLtpChg >= 0) peWrite += peOiChg * (cs.peLTP || 0) * (spec.lotSize || 1);
      // PE Buy: OI increased + LTP down (buyers aggressive on puts)
      else if (peOiChg > 0 && peLtpChg < 0) peBuy += peOiChg * (cs.peLTP || 0) * (spec.lotSize || 1);
    }

    const bullish = ceBuy + peWrite;
    const bearish = peBuy + ceWrite;
    const net = bullish - bearish;
    cumDeltaRef.current += net;

    const now = Math.floor(Date.now() / 1000);
    const bar: FlowBar = {
      time: now,
      bullish,
      bearish: -bearish,  // negative for bear histogram
      netFlow: net,
      cumDelta: cumDeltaRef.current,
      ceBuy, peWrite, peBuy, ceWrite,
    };

    flowBarsRef.current = [...flowBarsRef.current, bar];

    // Update chart series
    const bullData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.bullish, color: THEME.bullish }));
    const bearData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.bearish, color: THEME.bearish }));
    const cumData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.cumDelta }));

    bullSeriesRef.current?.setData(bullData);
    bearSeriesRef.current?.setData(bearData);
    cumDeltaSeriesRef.current?.setData(cumData);

  }, [curr, symbol]);

  // ─── Update last candle with live price ───
  useEffect(() => {
    if (!curr || !candleSeriesRef.current) return;
    const symData = curr.symbols?.find((s: any) => s.symbol === symbol);
    if (!symData?.spotPrice) return;

    const spot = symData.spotPrice;
    const timeStr = new Date().toISOString().split('T')[0] + ' ' +
                    new Date().toISOString().split('T')[1].substring(0, 5);

    try {
      candleSeriesRef.current.update({
        time: timeStr,
        close: spot,
        high: spot,
        low: spot,
        open: spot,
      });
    } catch {
      // ignore if time doesn't match
    }
  }, [curr, symbol]);

  // ─── Fullscreen toggle ───
  const toggleFullscreen = () => {
    setIsFullscreen(f => !f);
    setTimeout(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    }, 50);
  };

  const currentSymbolInfo = SYMBOLS.find(s => s.value === symbol);
  const spotPrice = curr?.symbols?.find((s: any) => s.symbol === symbol)?.spotPrice;
  const prevPrice = prev?.symbols?.find((s: any) => s.symbol === symbol)?.spotPrice;
  const priceChg = prevPrice ? spotPrice! - prevPrice : 0;
  const priceChgPct = prevPrice ? (priceChg / prevPrice) * 100 : 0;
  const isUp = priceChg >= 0;

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-[#0a0e17]' : ''}`}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[#0d1117] border-b border-[#1e293b] flex-shrink-0">
        <Crosshair className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-semibold text-purple-300 mr-2">OptFlow TV</span>

        {/* Symbol selector */}
        <div className="flex gap-0.5">
          {SYMBOLS.map(s => (
            <button
              key={s.value}
              onClick={() => setSymbol(s.value)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                symbol === s.value
                  ? 'bg-purple-500/25 text-purple-300'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#1e293b]" />

        {/* Interval selector */}
        <div className="flex gap-0.5">
          {INTERVALS.map(iv => (
            <button
              key={iv.value}
              onClick={() => setInterval(iv.value)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                interval === iv.value
                  ? 'bg-amber-500/25 text-amber-300'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>

        {/* Spot price */}
        {spotPrice && (
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {currentSymbolInfo?.label} {spotPrice.toFixed(0)}
            </span>
            <span className={`text-[10px] font-mono ${isUp ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {isUp ? '+' : ''}{priceChg.toFixed(0)} ({isUp ? '+' : ''}{priceChgPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* Status indicators */}
        <div className="flex items-center gap-1 ml-2">
          {errorCount > 0 && <Badge variant="destructive" className="text-[8px] px-1 py-0 h-4">{errorCount} err</Badge>}
          {pollCount > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 text-slate-500">{pollCount}</Badge>}
          {curr ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-red-400" />}
        </div>

        {/* Fullscreen toggle */}
        <button onClick={toggleFullscreen} className="ml-1 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── Legend bar ── */}
      <div ref={legendRef} className="flex items-center gap-3 px-3 py-1 bg-[#0b0f18] border-b border-[#1e293b] text-[10px] font-mono flex-shrink-0">
        <span className="text-slate-500">O <span className="text-slate-300">{legend.o}</span></span>
        <span className="text-slate-500">H <span className="text-slate-300">{legend.h}</span></span>
        <span className="text-slate-500">L <span className="text-slate-300">{legend.l}</span></span>
        <span className="text-slate-500">C <span className="text-slate-300">{legend.c}</span></span>
        <span className="text-slate-500">Vol <span className="text-slate-300">{legend.v}</span></span>

        <div className="w-px h-3 bg-[#1e293b]" />

        <span className="flex items-center gap-0.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: THEME.bullish }} />
          <span className="text-emerald-400">Bull {legend.bull}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: THEME.bearish }} />
          <span className="text-red-400">Bear {legend.bear}</span>
        </span>
        <span className="text-slate-500">Net <span className={legend.net.startsWith('-') ? 'text-red-400' : 'text-emerald-400'}>{legend.net}</span></span>
        <span className="text-slate-500">CumΔ <span className="text-amber-400">{legend.cum}</span></span>
      </div>

      {/* ── Chart container ── */}
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 ${isFullscreen ? '' : 'rounded-b-lg'}`}
        style={{ height: isFullscreen ? undefined : 'calc(100vh - 200px)' }}
      />

      {/* ── Loading / Error overlay ── */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading chart...
          </div>
        </div>
      )}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded mx-2 mt-1">
          {error}
        </div>
      )}
    </div>
  );
}
