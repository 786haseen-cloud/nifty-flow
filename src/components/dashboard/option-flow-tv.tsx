'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { withCreds } from '@/lib/kite-creds';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import { INDEX_SPECS } from '@/lib/kite-api';
import { computeSymbolFlow } from '@/lib/combined-flow';
import { Badge } from '@/components/ui/badge';
// Symbol type is just a string identifier
import { Crosshair, Maximize2, Minimize2, RefreshCw, Wifi, WifiOff } from 'lucide-react';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface CandleData {
  time: number;  // UTCTimestamp (unix seconds) for lightweight-charts v5
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
  { value: 'minute', label: '1m' },
  { value: '3minute', label: '3m' },
  { value: '5minute', label: '5m' },
  { value: '15minute', label: '15m' },
  { value: '60minute', label: '1h' },
];

const CROR = 10000000;

// ── IST time helpers ──
// Kite returns timestamps with +05:30 offset (e.g. "2024-08-15T09:15:00+05:30").
// lightweight-charts treats them as UTC seconds; the chart's default tick formatter
// prints them as UTC, so the user sees 03:45 instead of 09:15. We override the
// tick formatter + crosshair formatter to print in IST.
// Market session visible window: pre-market 09:00 → close 15:40 IST.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const PRE_MARKET_MIN = 9 * 60;        // 09:00 IST
const MARKET_OPEN_MIN = 9 * 60 + 15;   // 09:15 IST
const MARKET_CLOSE_MIN = 15 * 60 + 40; // 15:40 IST

/** True if current IST time is within the 09:00 → 15:40 trading session
 *  window, Monday–Friday. Used to gate the live-candle update + flow bar
 *  append so the chart stops shifting left after the market closes
 *  (without this, every 15s poll adds a synthetic candle at `now` past
 *  15:40 IST, which auto-scrolls the visible window leftward — bug the
 *  user reported as "OptFlow TV card moving on left side"). */
function isMarketActive(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();           // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= PRE_MARKET_MIN && mins <= MARKET_CLOSE_MIN;
}

function fmtIST(unixSec: number, withSeconds = false): string {
  const ist = new Date(unixSec * 1000 + IST_OFFSET_MS);
  const hh = ist.getUTCHours().toString().padStart(2, '0');
  const mm = ist.getUTCMinutes().toString().padStart(2, '0');
  if (withSeconds) {
    const ss = ist.getUTCSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

/** Compute today's IST market session as UTC epoch seconds for the chart's
 *  visible time range. Returns { from: 09:00 IST, to: 15:40 IST } in UTC epoch. */
function getMarketSessionRange(): { from: number; to: number } {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  // Build IST epoch milliseconds, then subtract IST offset to get UTC epoch.
  const fromMs = Date.UTC(y, m, d, 9, 0, 0) - IST_OFFSET_MS;
  const toMs = Date.UTC(y, m, d, 15, 40, 0) - IST_OFFSET_MS;
  return { from: Math.floor(fromMs / 1000), to: Math.floor(toMs / 1000) };
}

// ── Price-level buffer per symbol (visible band above/below spot) ──
// User request: "spot 24000 → 24500 up / 23500 down" — i.e. ±500 for NIFTY.
// Index step × 10 gives the same visual band per symbol (NIFTY 50×10=500,
// BANKNIFTY 100×10=1000, SENSEX 100×10=1000, FINNIFTY 50×10=500).
const PRICE_BUFFER: Record<string, number> = {
  NIFTY: 500,
  BANKNIFTY: 1000,
  SENSEX: 1000,
  FINNIFTY: 500,
};

const THEME = {
  bg: '#0a0e17',
  paneBg: '#0a0e17',
  gridColor: '#1a1f2e',
  textColor: '#64748b',
  textMuted: '#475569',
  borderColor: '#1e293b',
  crosshairColor: '#475569',
  // Price-line colors (spot / upper / lower)
  spotLine: '#e2e8f0',
  upperLine: '#22c55e',
  lowerLine: '#ef4444',
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
  // Price-line handles — recreated each time spot moves so the upper / lower
  // bands follow the live price (user: "should follow the spot price").
  const priceLinesRef = useRef<any[]>([]);
  const lastSpotRef = useRef<number | null>(null);

  const [symbol, setSymbol] = useState<SymbolId>('NIFTY');
  const [interval, setInterval] = useState('5minute');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [legend, setLegend] = useState({
    o: '--', h: '--', l: '--', c: '--', v: '--',
    bull: '--', bear: '--', net: '--', cum: '--',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Market-active state — re-evaluated every 30s. Drives the LIVE/PAUSED
  // badge in the toolbar AND gates the candle-update + flow-processing
  // effects so the chart stops shifting left after 15:40 IST.
  const [marketActive, setMarketActive] = useState(isMarketActive());

  // Latest bar reference — used to populate the legend by default (no hover
  // required). When the user hovers, the crosshair handler takes over and
  // shows the hovered bar's values; when the mouse leaves the chart, the
  // legend snaps back to this latest bar (subscribeCrosshairMove fires with
  // param.time === undefined on mouseout, which we detect).
  const lastBarRef = useRef<FlowBar | null>(null);
  const isHoveringRef = useRef(false);

  // Get snapshot for real-time data (uses singleton — no symbol filter needed)
  const { curr, prev, pollCount, errorCount } = useKiteSnapshot();

  // Re-evaluate market-active every 30s (reactivates promptly at 09:00 IST
  // if the user left the tab open overnight).
  useEffect(() => {
    const check = () => setMarketActive(isMarketActive());
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  // Restore legend to the latest flow bar (called on mouse-out from chart).
  const restoreLatestLegend = useCallback(() => {
    const bar = lastBarRef.current;
    if (!bar) {
      setLegend({
        o: '--', h: '--', l: '--', c: '--', v: '--',
        bull: '--', bear: '--', net: '--', cum: '--',
      });
      return;
    }
    setLegend(prev => ({
      ...prev,
      bull: (bar.bullish / CROR).toFixed(2) + ' Cr',
      bear: (Math.abs(bar.bearish) / CROR).toFixed(2) + ' Cr',
      net: (bar.netFlow / CROR).toFixed(2) + ' Cr',
      cum: (bar.cumDelta / CROR).toFixed(2) + ' Cr',
    }));
  }, []);

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
      // Localization: print IST on axis + crosshair. Kite returns ISO+05:30
      // timestamps; lightweight-charts stores them as UTC seconds, so we
      // add IST offset when formatting to recover the original IST clock time.
      localization: {
        timeFormatter: (time: number) => fmtIST(time, true),
        dateFormat: 'yyyy-MM-dd',
      },
      rightPriceScale: {
        borderColor: THEME.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.25 },
        autoScale: true,
      },
      timeScale: {
        borderColor: THEME.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        // IST tick mark formatter — replaces the default UTC labels (e.g.
        // 03:45 → 09:15). tickMarkType is from lightweight-charts enum:
        //   0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds.
        // We render hours:minutes for intraday ticks; date for boundary ticks.
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          if (tickMarkType <= 2) {
            const ist = new Date(time * 1000 + IST_OFFSET_MS);
            const dd = ist.getUTCDate().toString().padStart(2, '0');
            const mon = (ist.getUTCMonth() + 1).toString().padStart(2, '0');
            return `${dd}/${mon}`;
          }
          return fmtIST(time, false);
        },
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
    // Two modes:
    //   1. HOVERING — param.time is set; read the bar under the cursor and
    //      update the legend. Sets isHoveringRef = true.
    //   2. MOUSE-OUT — param.time is undefined; the user has left the chart.
    //      Restore the legend to the latest bar (lastBarRef) so the values
    //      stay visible after the mouse leaves — matching TradingView /
    //      Zerodha's behavior where the legend always shows something, not
    //      '--'.
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData) {
        // Mouse left the chart — restore the latest bar's legend.
        isHoveringRef.current = false;
        restoreLatestLegend();
        return;
      }
      isHoveringRef.current = true;
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
        // Clear any stale candles from a previous successful fetch so the
        // chart doesn't show outdated data after the token expires (user
        // reported this as "stale demo candles" making it look like a
        // second chart was rendering).
        candleSeries.setData([]);
        volSeries.setData([]);
        setIsLoading(false);
        return;
      }

      // Kite returns timestamp as ISO string (e.g. "2024-08-15T09:15:00+05:30").
      // Convert to UTCTimestamp (unix seconds) for lightweight-charts v5.
      const candles: CandleData[] = data.candles.map((c: any) => {
        const ts = typeof c.timestamp === 'number'
          ? c.timestamp
          : Math.floor(new Date(c.timestamp).getTime() / 1000);
        return {
          time: ts as any,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
      });

      candleSeries.setData(candles);

      // Volume with color based on candle direction
      const volData = candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? THEME.volumeUp : THEME.volumeDn,
      }));
      volSeries.setData(volData);

      // ── Constrain the visible time axis to today's IST market session:
      //    pre-market 09:00 → close 15:40. FIFO: as new bars arrive during the
      //    session, the right edge follows them; the morning bars scroll off
      //    the left once the session fills beyond the chart width. We set the
      //    visible range once after the initial fetch; the chart's auto-scroll
      //    (rightOffset + barSpacing above) keeps the latest bar pinned.
      try {
        const range = getMarketSessionRange();
        chart.timeScale().setVisibleRange({
          from: range.from as any,
          to: range.to as any,
        });
      } catch {
        // setVisibleRange can throw if no data — fall back to fitContent
        chart.timeScale().fitContent();
      }
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
    // Reset the per-symbol cached refs so the previous symbol's spot/last-bar
    // don't leak into the new symbol's first poll (e.g. NIFTY spot 24000 →
    // ALL view shouldn't keep showing 24000 as 'latest bar spot').
    lastBarRef.current = null;
    lastSpotRef.current = null;
    priceLinesRef.current = [];
    isHoveringRef.current = false;

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
  // Computes 4-color flow (CE Buy / PE Write / PE Buy / CE Write) per strike
  // for the SELECTED symbol only. The combined 4-index view lives in its
  // own component (CombinedFlowCard) so the two never interfere. Each poll
  // produces a new FlowBar appended to flowBarsRef (FIFO across the session);
  // the chart series re-set every poll. The latest bar also seeds the legend
  // (no hover required) — restoreLatestLegend fires when the mouse leaves.
  //
  // Market-hours gate: skip appending new flow bars when IST clock is outside
  // 09:00 → 15:40 (Mon–Fri). Same gate as the candle-update effect above —
  // without it, the chart keeps shifting left after close (the user's
  // "OptFlow TV card moving on left side" bug). Existing bars stay on the
  // chart so the user can scroll back through the closed session.
  useEffect(() => {
    if (!curr || !prev || !bullSeriesRef.current) return;
    // Market-hours gate.
    if (!marketActive) return;

    const { ceBuy, peWrite, peBuy, ceWrite } = computeSymbolFlow(curr, prev, symbol);

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
    lastBarRef.current = bar;

    const bullData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.bullish, color: THEME.bullish }));
    const bearData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.bearish, color: THEME.bearish }));
    const cumData = flowBarsRef.current.map(b => ({ time: b.time as any, value: b.cumDelta }));

    bullSeriesRef.current?.setData(bullData);
    bearSeriesRef.current?.setData(bearData);
    cumDeltaSeriesRef.current?.setData(cumData);

    if (!isHoveringRef.current) {
      restoreLatestLegend();
    }
  }, [curr, symbol, restoreLatestLegend, marketActive]);

  // ─── Update last candle with live price + refresh spot/upper/lower price
  //      lines so they follow the spot (user: "should follow the spot price").
  //      Also nudges the right price-scale's visible range so the upper / lower
  //      bands are always on screen.
  //
  //      Market-hours gate: skip the synthetic-candle update when IST clock
  //      is outside 09:00 → 15:40 (Mon–Fri). Without this, every 15s poll
  //      after market close appends a new candle at `now` (past 15:40 IST)
  //      which auto-scrolls the visible window leftward — the "OptFlow TV
  //      card moving on left side" bug. The spot price bands still update
  //      so they follow the latest spot during the live session; outside
  //      market hours we skip the bands too (no spot moving). ───
  useEffect(() => {
    if (!curr || !candleSeriesRef.current) return;
    // Market-hours gate — don't append synthetic candles after 15:40 IST.
    if (!marketActive) return;
    const symData = curr.symbols?.find((s: any) => s.symbol === symbol);
    if (!symData?.spotPrice) return;

    const spot = symData.spotPrice;
    const now = Math.floor(Date.now() / 1000);

    try {
      candleSeriesRef.current.update({
        time: now as any,
        close: spot,
        high: spot,
        low: spot,
        open: spot,
      });
    } catch {
      // ignore if time doesn't match
    }

    // Refresh price lines only when spot actually moves (avoid spamming
    // removePriceLine / createPriceLine on every 15s poll when spot is flat).
    if (lastSpotRef.current !== null && Math.abs(spot - lastSpotRef.current) < 1) {
      return;
    }
    lastSpotRef.current = spot;

    // Clear previous price lines
    for (const line of priceLinesRef.current) {
      try { candleSeriesRef.current.removePriceLine(line); } catch { /* noop */ }
    }
    priceLinesRef.current = [];

    const buffer = PRICE_BUFFER[symbol] ?? 500;
    const upper = spot + buffer;
    const lower = spot - buffer;

    // Spot price line — solid white
    try {
      const spotLine = candleSeriesRef.current.createPriceLine({
        price: spot,
        color: THEME.spotLine,
        lineWidth: 1,
        lineStyle: 0,        // Solid
        axisLabelVisible: true,
        title: `Spot ${spot.toFixed(0)}`,
      });
      priceLinesRef.current.push(spotLine);
    } catch { /* noop */ }

    // Upper level — dashed green
    try {
      const upLine = candleSeriesRef.current.createPriceLine({
        price: upper,
        color: THEME.upperLine,
        lineWidth: 1,
        lineStyle: 2,        // Dashed
        axisLabelVisible: true,
        title: `+${buffer}`,
      });
      priceLinesRef.current.push(upLine);
    } catch { /* noop */ }

    // Lower level — dashed red
    try {
      const dnLine = candleSeriesRef.current.createPriceLine({
        price: lower,
        color: THEME.lowerLine,
        lineWidth: 1,
        lineStyle: 2,        // Dashed
        axisLabelVisible: true,
        title: `-${buffer}`,
      });
      priceLinesRef.current.push(dnLine);
    } catch { /* noop */ }

    // Pin the right price scale's visible range to [lower, upper] so the
    // upper / lower bands always sit on screen (auto-scale alone collapses
    // to the candle range, hiding the bands when price compresses).
    try {
      chartRef.current?.priceScale('right').applyOptions({
        autoScale: false,
      });
      chartRef.current?.priceScale('right').setVisibleRange({
        from: lower - buffer * 0.1,
        to: upper + buffer * 0.1,
      });
    } catch { /* noop */ }
  }, [curr, symbol, marketActive]);

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
          {/* Market-hours badge: green LIVE 09:00→15:40 when active,
              amber PAUSED when outside market hours. */}
          <Badge
            variant="outline"
            className={`text-[8px] px-1 py-0 h-4 font-mono ${
              marketActive
                ? 'border-emerald-500/40 text-emerald-300'
                : 'border-amber-500/40 text-amber-300'
            }`}
            title={marketActive ? 'Market is open — live' : 'Outside 09:00 → 15:40 IST — polling paused'}
          >
            {marketActive ? 'LIVE 09→15:40' : 'PAUSED'}
          </Badge>
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

      {/* ── Chart container — wrapped in a relative parent so the error
          overlay can sit INSIDE the chart area, matching CombinedFlowCard.
          Previously the error was a sibling below the chart, leaving stale
          candles visible above. Now when there's an error the chart is
          cleared AND the error sits as an overlay so it's visually obvious
          the chart is empty. ── */}
      <div className="relative flex-1 min-h-[400px]">
        <div
          ref={containerRef}
          className={`flex-1 min-h-[400px] ${isFullscreen ? '' : 'rounded-b-lg'}`}
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
          <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-red-500/10 border-t border-red-500/30 text-red-400 text-xs rounded-b-lg z-10">
            <strong>✗ {error}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
