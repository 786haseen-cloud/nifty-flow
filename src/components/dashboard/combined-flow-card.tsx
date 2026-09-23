'use client';

/**
 * CombinedFlowCard — separate TradingView Lightweight Charts panel that
 * shows the SUMMED whole-market flow (4 indices + 15 F&O stocks = 19 symbols)
 * as a Bull/Bear histogram + Cumulative Delta line, always visible below the
 * main OptFlow TV chart.
 *
 * Why a separate component (not an 'ALL' button in the main chart):
 *   The user wanted both views at the same time — the main candlestick chart
 *   for the selected single symbol AND the combined whole-market flow
 *   aggregate. Putting 'ALL' as a symbol-selector toggle wiped the candlestick
 *   chart every time the user clicked it; that's the bug this card fixes.
 *
 * Architecture:
 *   - Owns its own lightweight-charts instance + container + ResizeObserver.
 *   - Shares the Kite snapshot via useKiteSnapshot() singleton (zero extra
 *     network — the snapshot is already polled for the main chart).
 *   - Each 15s poll computes 4-quadrant flow across all 19 symbols, sums them,
 *     appends a bar to flowBarsRef, and uses series.update() to preserve the
 *     visible time range (FIFO across the session — same as the main chart).
 *   - Always-visible legend (Bull / Bear / Net / CumΔ) — no hover required.
 *
 * No candles here — there's no single underlying to chart. The card is a
 * pure flow view: the histogram shows per-15s ₹ Cr flow, the line shows the
 * running cumulative delta.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import { computeCombinedFlow, computeSymbolFlow, CROR, ALL_MARKET_SYMBOLS, FLOW_INDICES } from '@/lib/combined-flow';
import { Layers, Wifi, WifiOff, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface FlowBar {
  time: number;
  bullish: number;     // CE Buy + PE Write (positive)
  bearish: number;     // PE Buy + CE Write (negative for histogram)
  netFlow: number;
  cumDelta: number;
}

// Same IST session window as the main chart (09:00 pre-market → 15:40 close).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SESSION_START_MIN_IST = 9 * 60;        // 09:00
const SESSION_END_MIN_IST = 15 * 60 + 40;   // 15:40

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

/** True if current IST time is within the 09:00 → 15:40 trading session
 *  window, Monday–Friday. Outside this window (pre-09:00, post-15:40, or
 *  weekend) the card stops processing polls and appending bars — the user
 *  explicitly asked for this so the card doesn't "keep running" after the
 *  market closes. */
function isMarketActive(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();           // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= SESSION_START_MIN_IST && mins <= SESSION_END_MIN_IST;
}

/** "HH:MM IST" for the toolbar — shows current IST clock so the user can
 *  see why the card is paused (e.g. "15:45 IST → market closed"). */
function istClock(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCHours().toString().padStart(2, '0')}:${ist.getUTCMinutes().toString().padStart(2, '0')} IST`;
}

function getMarketSessionRange(): { from: number; to: number } {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const fromMs = Date.UTC(y, m, d, 9, 0, 0) - IST_OFFSET_MS;
  const toMs = Date.UTC(y, m, d, 15, 40, 0) - IST_OFFSET_MS;
  return { from: Math.floor(fromMs / 1000), to: Math.floor(toMs / 1000) };
}

const THEME = {
  bg: '#0a0e17',
  gridColor: '#1a1f2e',
  textColor: '#64748b',
  borderColor: '#1e293b',
  crosshairColor: '#475569',
  bullish: '#22c55e',
  bearish: '#ef4444',
  cumDelta: '#fbbf24',
};

export default function CombinedFlowCard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const bullSeriesRef = useRef<any>(null);
  const bearSeriesRef = useRef<any>(null);
  const cumDeltaSeriesRef = useRef<any>(null);
  const flowBarsRef = useRef<FlowBar[]>([]);
  const cumDeltaRef = useRef(0);

  const [legend, setLegend] = useState({
    bull: '--', bear: '--', net: '--', cum: '--',
  });
  const [pollCount, setPollCount] = useState(0);

  // Toggle: 'all' = whole market (4 indices + 15 F&O stocks = 19 symbols),
  // 'indices' = 4 indices only. Default 'all' per the user's last request.
  // Switching clears the chart + resets cumulative delta so the two views
  // don't mix data — each view has its own clean cumulative sum.
  const [viewMode, setViewMode] = useState<'all' | 'indices'>('all');

  // Market-active state — re-evaluated every 30s. When false (outside
  // 09:00 → 15:40 IST, or weekend), the flow-processing effect early-returns
  // so we don't append new bars or update the legend. Existing bars stay on
  // the chart so the user can scroll back through the closed session.
  const [marketActive, setMarketActive] = useState(isMarketActive());

  // Snapshot mode — 'live' | 'demo' | 'error' | null (no poll yet).
  // Drives the error/warning overlay so the user sees WHY the chart is empty
  // (expired Kite token = demo mode, network/API failure = error mode, etc.).
  // Same pattern as the OptFlow TV card's "No candle data available. Check
  // Kite credentials." banner — the user explicitly asked for this consistency.
  const [snapshotMode, setSnapshotMode] = useState<'live' | 'demo' | 'error' | null>(null);

  // Has the time-scale's visible range (09:00 → 15:40 IST) been applied?
  // lightweight-charts can't apply setVisibleRange when the chart has no
  // data, so we set it in initChart (no-op if no data) AND re-apply it
  // after the first bar lands in the flow-processing effect below.
  const rangeSetRef = useRef(false);

  const { curr, prev } = useKiteSnapshot();

  // Re-evaluate market-active every 30s. The toggle uses local time so it
  // reactivates promptly when 09:00 IST rolls around (e.g. user left the
  // tab open overnight).
  useEffect(() => {
    const check = () => setMarketActive(isMarketActive());
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  // Track how many polls we've seen so the user can see the card is alive.
  // Also capture the snapshot mode (live/demo/error) so the overlay can
  // show a clear error/warning when the Kite token is expired or the API
  // fails — same UX as the OptFlow TV card's red banner.
  useEffect(() => {
    if (curr) {
      setPollCount((p) => p + 1);
      setSnapshotMode(curr.mode);
    }
  }, [curr]);

  // ─── Initialize chart ───
  const initChart = useCallback(async () => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const { createChart, HistogramSeries, LineSeries } = await import('lightweight-charts');

    const chart = createChart(containerRef.current, {
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
        mode: 0,
        vertLine: { color: THEME.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: THEME.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#1e293b' },
      },
      localization: {
        timeFormatter: (time: number) => fmtIST(time, true),
        dateFormat: 'yyyy-MM-dd',
      },
      rightPriceScale: {
        borderColor: THEME.borderColor,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        autoScale: true,
      },
      timeScale: {
        borderColor: THEME.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
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

    const bullSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      color: THEME.bullish,
    });

    const bearSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      color: THEME.bearish,
    });

    const cumDeltaSeries = chart.addSeries(LineSeries, {
      color: THEME.cumDelta,
      lineWidth: 1.5,
      priceFormat: { type: 'custom', formatter: (v: number) => (v / CROR).toFixed(2) + ' Cr' },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    bullSeriesRef.current = bullSeries;
    bearSeriesRef.current = bearSeries;
    cumDeltaSeriesRef.current = cumDeltaSeries;

    try {
      const range = getMarketSessionRange();
      chart.timeScale().setVisibleRange({
        from: range.from as any,
        to: range.to as any,
      });
    } catch {
      chart.timeScale().fitContent();
    }
  }, []);

  // ─── Init chart on mount ───
  useEffect(() => {
    initChart();
    flowBarsRef.current = [];
    cumDeltaRef.current = 0;
    rangeSetRef.current = false;  // reset on remount / re-init

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
      chartRef.current?.applyOptions({
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ─── Process flow data from snapshots ───
  // Sums 4-quadrant flow per 15s poll, across either ALL 19 symbols
  // (viewMode='all') or the 4 indices only (viewMode='indices'). Per-symbol
  // missing data is tolerated — we just sum the others.
  //
  // Market-hours gate:
  //   The card only processes polls when the IST clock is within 09:00 →
  //   15:40, Mon–Fri (isMarketActive()). Outside that window we early-return:
  //   no new bar, no legend update, no cumulative-delta change. Existing
  //   bars stay on the chart so the user can scroll back through the closed
  //   session — the user explicitly asked for this so the card doesn't "keep
  //   running" after the market closes.
  //
  // FIFO time-axis logic (matches the main OptFlow TV chart above):
  //   - Use series.update() to append each new bar to the right edge instead
  //     of series.setData() every poll. setData() resets the time scale's
  //     visible range every call (lightweight-charts calls fitContent()
  //     internally), which would break the pinned 09:00 → 15:40 IST window
  //     and let the time axis drift. update() preserves the visible range
  //     the user set / scrolled to.
  //   - On the FIRST bar, call timeScale().setVisibleRange() once to pin the
  //     market session window. initChart tries this earlier but the chart
  //     has no data yet so the call is a no-op; we retry here after the first
  //     bar lands, then guard with rangeSetRef so we never call it again
  //     (so subsequent user scrolls aren't overwritten).
  //   - New bars auto-pin to the right edge via the chart's rightOffset: 5
  //     + barSpacing: 8 (set in initChart). Older morning bars scroll off
  //     the left as the session fills — FIFO behavior, identical to the
  //     main chart.
  useEffect(() => {
    if (!curr || !prev || !bullSeriesRef.current) return;
    // Market-hours gate — stop processing outside 09:00 → 15:40 IST.
    if (!marketActive) return;

    // Compute flow across the chosen symbol set.
    let ceBuy = 0, peWrite = 0, peBuy = 0, ceWrite = 0;
    if (viewMode === 'all') {
      const f = computeCombinedFlow(curr, prev);
      ceBuy = f.ceBuy; peWrite = f.peWrite; peBuy = f.peBuy; ceWrite = f.ceWrite;
    } else {
      // 'indices' — sum only the 4 indices.
      for (const sym of FLOW_INDICES) {
        const f = computeSymbolFlow(curr, prev, sym);
        ceBuy += f.ceBuy; peWrite += f.peWrite; peBuy += f.peBuy; ceWrite += f.ceWrite;
      }
    }

    const bullish = ceBuy + peWrite;
    const bearish = peBuy + ceWrite;
    const net = bullish - bearish;
    cumDeltaRef.current += net;

    const now = Math.floor(Date.now() / 1000);
    const bar: FlowBar = {
      time: now,
      bullish,
      bearish: -bearish,
      netFlow: net,
      cumDelta: cumDeltaRef.current,
    };

    flowBarsRef.current = [...flowBarsRef.current, bar];

    // update() — append the latest bar. Preserves the visible range the
    // main chart and this card share (09:00 → 15:40 IST). If the time went
    // backwards (rare — clock skew) or the chart isn't ready, fall back to
    // a one-shot setData() of the whole ref so the chart doesn't get stuck.
    try {
      bullSeriesRef.current.update({
        time: now as any,
        value: bullish,
        color: THEME.bullish,
      });
      bearSeriesRef.current.update({
        time: now as any,
        value: -bearish,
        color: THEME.bearish,
      });
      cumDeltaSeriesRef.current.update({
        time: now as any,
        value: cumDeltaRef.current,
      });
    } catch {
      // Defensive fallback: rebuild the whole series from the ref.
      const bullData = flowBarsRef.current.map((b) => ({
        time: b.time as any,
        value: b.bullish,
        color: THEME.bullish,
      }));
      const bearData = flowBarsRef.current.map((b) => ({
        time: b.time as any,
        value: b.bearish,
        color: THEME.bearish,
      }));
      const cumData = flowBarsRef.current.map((b) => ({
        time: b.time as any,
        value: b.cumDelta,
      }));
      bullSeriesRef.current?.setData(bullData);
      bearSeriesRef.current?.setData(bearData);
      cumDeltaSeriesRef.current?.setData(cumData);
    }

    // After the FIRST bar lands, pin the time scale's visible range to
    // today's IST market session (09:00 pre-market → 15:40 close). This
    // matches the main chart's time axis exactly. rangeSetRef guards so
    // we only do this once — subsequent polls use update() which keeps
    // the user's scroll position intact.
    if (!rangeSetRef.current && chartRef.current && flowBarsRef.current.length === 1) {
      try {
        const range = getMarketSessionRange();
        chartRef.current.timeScale().setVisibleRange({
          from: range.from as any,
          to: range.to as any,
        });
        rangeSetRef.current = true;
      } catch {
        chartRef.current?.timeScale().fitContent();
      }
    }

    // Always-visible legend (no hover needed) — latest bar's values.
    setLegend({
      bull: (bullish / CROR).toFixed(2) + ' Cr',
      bear: (bearish / CROR).toFixed(2) + ' Cr',
      net: (net / CROR).toFixed(2) + ' Cr',
      cum: (cumDeltaRef.current / CROR).toFixed(2) + ' Cr',
    });
  }, [curr, prev, viewMode, marketActive]);

  // ─── Clear the chart when viewMode changes ───
  // Switching between 'all' (19 symbols) and 'indices' (4) changes the
  // scale of every bar by an order of magnitude. Mixing them in the same
  // cumulative delta would be meaningless, so we wipe the chart + reset
  // the cumulative delta + reset rangeSetRef so the next first-bar pin
  // runs again. Also resets on the initial mount (rangeSetRef default
  // false is already set above, but the effect still needs to clear the
  // series data so a remount doesn't show stale bars from a previous
  // session).
  useEffect(() => {
    flowBarsRef.current = [];
    cumDeltaRef.current = 0;
    rangeSetRef.current = false;
    if (bullSeriesRef.current) bullSeriesRef.current.setData([]);
    if (bearSeriesRef.current) bearSeriesRef.current.setData([]);
    if (cumDeltaSeriesRef.current) cumDeltaSeriesRef.current.setData([]);
    setLegend({ bull: '--', bear: '--', net: '--', cum: '--' });
  }, [viewMode]);

  return (
    <div className="rounded-xl border border-amber-500/30 bg-card/50 overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[#0d1117] border-b border-[#1e293b] flex-shrink-0 flex-wrap">
        <Layers className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-semibold text-amber-300 mr-2">Combined Flow</span>

        {/* View-mode toggle — 'all' (19 symbols) vs 'indices' (4) */}
        <div className="flex gap-0.5">
          <button
            onClick={() => setViewMode('all')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
              viewMode === 'all'
                ? 'bg-amber-500/25 text-amber-300'
                : 'text-amber-500/60 hover:text-amber-300 hover:bg-amber-500/10'
            }`}
            title="Aggregate across 4 indices + 15 F&O stocks (19 symbols)"
          >
            All 19
          </button>
          <button
            onClick={() => setViewMode('indices')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
              viewMode === 'indices'
                ? 'bg-amber-500/25 text-amber-300'
                : 'text-amber-500/60 hover:text-amber-300 hover:bg-amber-500/10'
            }`}
            title="Aggregate across the 4 indices only (NIFTY + BANKNIFTY + SENSEX + FINNIFTY)"
          >
            4 Indices
          </button>
        </div>

        <span className="text-[10px] text-amber-300/60 hidden sm:inline">
          {viewMode === 'all'
            ? 'Whole market · 19 symbols · ₹ Cr per 15s poll'
            : '4 indices only · ₹ Cr per 15s poll'}
        </span>

        {/* Market-status indicator: green when active, amber when paused */}
        <div
          className={`ml-auto flex items-center gap-1 text-[10px] font-mono ${
            marketActive ? 'text-emerald-400' : 'text-amber-400/80'
          }`}
          title={marketActive ? 'Market is open — polling live' : 'Outside 09:00 → 15:40 IST — polling paused'}
        >
          <Clock className="h-3 w-3" />
          <span>{marketActive ? 'LIVE 09:00→15:40' : `PAUSED · ${istClock()}`}</span>
        </div>

        <div className="flex items-center gap-1 ml-2">
          {pollCount > 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 text-slate-500">
              {pollCount} polls
            </Badge>
          )}
          {curr ? (
            <Wifi className="h-3 w-3 text-emerald-400" />
          ) : (
            <WifiOff className="h-3 w-3 text-red-400" />
          )}
        </div>
      </div>

      {/* ── Legend bar ── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#0b0f18] border-b border-[#1e293b] text-[10px] font-mono flex-shrink-0">
        <span className="flex items-center gap-0.5">
          <span
            className="inline-block w-2 h-2 rounded-sm"
            style={{ background: THEME.bullish }}
          />
          <span className="text-emerald-400">Bull {legend.bull}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <span
            className="inline-block w-2 h-2 rounded-sm"
            style={{ background: THEME.bearish }}
          />
          <span className="text-red-400">Bear {legend.bear}</span>
        </span>
        <span className="text-slate-500">
          Net{' '}
          <span className={legend.net.startsWith('-') ? 'text-red-400' : 'text-emerald-400'}>
            {legend.net}
          </span>
        </span>
        <span className="text-slate-500">
          CumΔ <span className="text-amber-400">{legend.cum}</span>
        </span>
      </div>

      {/* ── Chart container — fixed modest height; the main chart above stays the primary view. ── */}
      <div className="relative">
        <div
          ref={containerRef}
          className="min-h-[260px] rounded-b-lg"
          style={{ height: 280 }}
        />

        {/* ── Overlay: error / warning banner shown when snapshot mode is
            'demo' (Kite token expired) or 'error' (API failed). Matches the
            OptFlow TV card's red banner UX so the user knows why the chart
            is empty. Hidden in 'live' mode (chart has data to show). ── */}
        {snapshotMode === 'demo' && (
          <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-[11px] text-amber-300 bg-amber-500/10 border-t border-amber-500/30 rounded-b-lg">
            <strong>⚠ No flow data available.</strong> Kite credentials expired or not configured — flow bars will appear once a valid access token is set in <strong>Settings</strong>.
          </div>
        )}
        {snapshotMode === 'error' && (
          <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-[11px] text-red-400 bg-red-500/10 border-t border-red-500/30 rounded-b-lg">
            <strong>✗ Snapshot error.</strong> The Kite API rejected the request (likely expired token). Refresh credentials in <strong>Settings</strong> → Generate Access Token.
          </div>
        )}
        {snapshotMode === null && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-300/70">
            Connecting to Kite snapshot…
          </div>
        )}
      </div>
    </div>
  );
}
