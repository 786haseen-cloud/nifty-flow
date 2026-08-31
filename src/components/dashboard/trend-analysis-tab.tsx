'use client';

/**
 * Trend Analysis Tab — Price + Cash + Options Flow visualization.
 *
 * ARCHITECTURE
 * ------------
 * This component is a PURE VIEW — it contains no state and no polling logic.
 * All state is held in the global `useTrendStore` Zustand store, which:
 *   - Persists to localStorage (survives page reload + browser restart)
 *   - Survives tab switches (because it lives outside the component tree)
 *   - Is updated by a singleton poller started once at app boot
 *
 * This fixes the original bug where switching away from the Trends tab
 * would unmount the component and destroy all accumulated chart data.
 *
 * To add new visualizations: read additional fields from the store, or
 * extend the store's `pollOnce()` action to fetch new data.
 */

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer, ComposedChart,
} from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Activity, Wallet } from 'lucide-react';
import { useTrendStore } from '@/lib/trend-store';
import {
  IDX_COLORS,
  IDX_NAMES,
  INDEX_SYMBOLS,
  type NiftyCandle,
  type StockCashFlow,
  type CashFlowTrendPoint,
  type FlowTrendPoint,
} from '@/lib/trend-types';

// ─── Trading Session X-Axis Helpers ───
// Charts display a fixed trading-session window 09:15 → 15:40 IST.
// The x-axis is a numeric "minutes since midnight" axis with this fixed domain,
// so the chart always shows the full trading session — even when only a few
// data points have arrived (e.g. user opens at 11 AM and the morning portion
// fills in via historical backfill, while the post-11 AM portion fills live).

const SESSION_START_MIN = 9 * 60 + 15;   // 9:15 AM  = 555
const SESSION_END_MIN   = 15 * 60 + 40;  // 3:40 PM  = 940

// Hourly tick marks at 9:15, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 15:40
const SESSION_TICKS = [
  SESSION_START_MIN,
  10 * 60, 11 * 60, 12 * 60, 13 * 60, 14 * 60, 15 * 60,
  SESSION_END_MIN,
];

/**
 * Convert a time string ("HH:MM" or "HH:MM:SS") to minutes since midnight.
 * Includes seconds as a fractional component so that data points with the
 * same HH:MM but different seconds get distinct X positions (otherwise
 * Recharts collapses them into a single dot and can't draw a connecting line).
 * Returns NaN if the string is unparseable — Recharts will skip those points.
 */
function timeStrToMinutes(t: string | undefined | null): number {
  if (!t) return NaN;
  const parts = t.split(':');
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m + (isNaN(s) ? 0 : s / 60);
}

/** Format minutes-since-midnight back to "HH:MM" for axis tick labels. */
function minutesToTimeStr(min: number): string {
  const rounded = Math.round(min);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Compute a dynamic X-axis domain [min, max] for trend charts.
 *
 * PROBLEM: The cashFlowTrend and flowTrend arrays use real wall-clock times
 * (e.g. "03:52:43" when testing outside market hours). The old fixed domain
 * [555, 940] (09:15–15:40 IST) causes all data points to be drawn at negative
 * X coordinates — making the charts appear empty.
 *
 * SOLUTION: Use the actual data range. If data falls within the trading
 * session, use the session domain. Otherwise, use the data's own min/max.
 */
function computeTrendDomain(
  points: { time: string }[]
): [number, number] {
  if (points.length === 0) return [SESSION_START_MIN, SESSION_END_MIN];

  const mins = points.map(p => timeStrToMinutes(p.time)).filter(m => !isNaN(m));
  if (mins.length === 0) return [SESSION_START_MIN, SESSION_END_MIN];

  const dataMin = Math.min(...mins);
  const dataMax = Math.max(...mins);

  // If all data is within the trading session, use the full session domain
  // so the chart always shows the complete 09:15–15:40 window.
  if (dataMin >= SESSION_START_MIN && dataMax <= SESSION_END_MIN) {
    return [SESSION_START_MIN, SESSION_END_MIN];
  }

  // Data is (partially) outside market hours (e.g. demo mode at 3 AM, or
  // pre-market polling). Use the data's own range with a small pad.
  const pad = Math.max(5, (dataMax - dataMin) * 0.05);
  return [Math.max(0, Math.floor(dataMin - pad)), Math.ceil(dataMax + pad)];
}

/**
 * Compute tick marks for a dynamic domain.
 * Generates ~6-8 evenly spaced ticks.
 */
function computeTrendTicks(domain: [number, number]): number[] {
  const [min, max] = domain;
  const range = max - min;
  if (range <= 0) return [min];
  const tickCount = Math.min(8, Math.max(4, Math.floor(range / 60) + 1));
  const step = range / (tickCount - 1);
  const ticks: number[] = [];
  for (let i = 0; i < tickCount; i++) {
    ticks.push(Math.round(min + step * i));
  }
  return ticks;
}

// ─── Custom Tooltips ───

function NiftyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as NiftyCandle;
  const labelStr = typeof label === 'number' ? minutesToTimeStr(label) : (d?.time || String(label ?? ''));
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{labelStr}</div>
      <div className="text-emerald-400 font-semibold">Close: {d?.close?.toLocaleString('en-IN')}</div>
      {d?.high ? (
        <div className="text-muted-foreground">
          H: {d.high.toLocaleString('en-IN')} L: {d.low.toLocaleString('en-IN')}
        </div>
      ) : null}
      {d?.volume ? (
        <div className="text-muted-foreground">Vol: {(d.volume / 1000000).toFixed(1)}M</div>
      ) : null}
    </div>
  );
}

function CashFlowTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const labelStr = typeof label === 'number' ? minutesToTimeStr(label) : (d?.time || String(label ?? ''));
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{labelStr}</div>
      <div className="text-emerald-400">NSE Cum: {d?.nse?.toFixed(1)} Cr</div>
      <div className="text-sky-400">BSE Cum: {d?.bse?.toFixed(1)} Cr</div>
      <div className={d?.net >= 0 ? 'text-amber-400 font-semibold' : 'text-red-400 font-semibold'}>
        Net Cum: {d?.net?.toFixed(1)} Cr
      </div>
      <div className="text-muted-foreground mt-1">
        This 15s:{' '}
        <span className={d?.interval >= 0 ? 'text-emerald-300' : 'text-red-300'}>
          {d?.interval >= 0 ? '+' : ''}{d?.interval?.toFixed(1)} Cr
        </span>
      </div>
    </div>
  );
}

function FlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const labelStr = typeof label === 'number' ? minutesToTimeStr(label) : String(label ?? '');
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{labelStr}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.dataKey}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value} Cr
        </div>
      ))}
    </div>
  );
}

function CashTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as StockCashFlow;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-semibold text-foreground mb-1">{d.symbol}</div>
      <div className="text-muted-foreground">{d.name}</div>
      <div className="mt-1 text-emerald-400">NSE: {(d.nseCashFlow / 10000000).toFixed(1)} Cr</div>
      <div className="text-sky-400">BSE: {(d.bseCashFlow / 10000000).toFixed(1)} Cr</div>
      <div className={d.combinedFlow >= 0 ? 'text-emerald-300 font-semibold mt-1' : 'text-red-400 font-semibold mt-1'}>
        Net: {(d.combinedFlow / 10000000).toFixed(1)} Cr
      </div>
      <div className="text-muted-foreground">Wt: {d.niftyWeight}%</div>
    </div>
  );
}

// ─── Main Component ───

export default function TrendAnalysisTab() {
  // Read everything from the global store — no local state, no polling.
  // The store is updated by a singleton poller started at app boot.
  const niftyCandles = useTrendStore((s) => s.niftyCandles);
  const stockCashFlow = useTrendStore((s) => s.stockCashFlow);
  const trendMode = useTrendStore((s) => s.trendMode);
  const cashFlowTrend = useTrendStore((s) => s.cashFlowTrend);
  const flowTrend = useTrendStore((s) => s.flowTrend);
  const cumulativeFlow = useTrendStore((s) => s.cumulativeFlow);
  const currentIdxFlows = useTrendStore((s) => s.currentIdxFlows);
  const currentStockFlow = useTrendStore((s) => s.currentStockFlow);
  const currentIntervalCashFlow = useTrendStore((s) => s.currentIntervalCashFlow);
  const prevStockTotals = useTrendStore((s) => s.prevStockTotals);
  const lastPollAt = useTrendStore((s) => s.lastPollAt);

  // ─── Derived values ───

  const niftyCurrentPrice = niftyCandles.length > 0 ? niftyCandles[niftyCandles.length - 1].close : 0;
  const niftyOpenPrice = niftyCandles.length > 0 ? niftyCandles[0].close : 0;
  const niftyChange = niftyOpenPrice > 0 ? niftyCurrentPrice - niftyOpenPrice : 0;
  const niftyChangePct = niftyOpenPrice > 0 ? (niftyChange / niftyOpenPrice) * 100 : 0;

  // Live cash flow totals — straight from the latest snapshot (these are
  // cumulative-since-market-open values from the API, no client accumulation)
  const totalNseFlow = stockCashFlow.reduce((s, v) => s + v.nseCashFlow, 0);
  const totalBseFlow = stockCashFlow.reduce((s, v) => s + v.bseCashFlow, 0);
  const totalCombinedFlow = totalNseFlow + totalBseFlow;
  const totalWeightedFlow = stockCashFlow.reduce((s, v) => s + v.weightedFlow, 0);

  // Cumulative NSE/BSE for header card — comes from the trend's last point
  // (which IS the cumulative-since-market-open value, not a client-accumulated delta)
  const lastCashPoint = cashFlowTrend.length > 0 ? cashFlowTrend[cashFlowTrend.length - 1] : null;
  const cumNseCr = lastCashPoint?.nse ?? 0;
  const cumBseCr = lastCashPoint?.bse ?? 0;
  const cumNetCr = lastCashPoint?.net ?? 0;

  // Last poll timestamp display
  const lastPollStr = lastPollAt > 0
    ? new Date(lastPollAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—';

  // ─── Dynamic X-axis domains for trend charts ───
  // cashFlowTrend and flowTrend use real wall-clock times which may fall
  // outside the trading session (e.g. demo mode at 3 AM). We compute a
  // domain that fits the actual data so lines are always visible.
  // Also applies to niftyCandles when the API uses the 2-point quote fallback
  // (which synthesizes candle times from the current wall-clock time).
  const niftyDomain = computeTrendDomain(niftyCandles);
  const niftyTicks = computeTrendTicks(niftyDomain);
  const cashDomain = computeTrendDomain(cashFlowTrend);
  const cashTicks = computeTrendTicks(cashDomain);
  const flowDomain = computeTrendDomain(flowTrend);
  const flowTicks = computeTrendTicks(flowDomain);

  // ─── Pre-compute numeric X for each data point ───
  // Recharts Line/Area components fail to render connected lines when the
  // XAxis uses a function-based dataKey (they collapse to single dots).
  // The fix is to add a numeric `x` field to each point and use dataKey="x".
  // This ensures Recharts sees distinct X values and connects them properly.
  const niftyChartData = useMemo(
    () => niftyCandles.map(c => ({ ...c, x: timeStrToMinutes(c.time) })),
    [niftyCandles]
  );
  const cashChartData = useMemo(
    () => cashFlowTrend.map(p => ({ ...p, x: timeStrToMinutes(p.time) })),
    [cashFlowTrend]
  );
  const flowChartData = useMemo(
    () => flowTrend.map(p => ({ ...p, x: timeStrToMinutes(p.time) })),
    [flowTrend]
  );

  // ─── Format helpers ───

  const fmtCr = (v: number) => {
    const cr = v / 10000000;
    if (Math.abs(cr) >= 100) return `${cr.toFixed(0)}`;
    if (Math.abs(cr) >= 1) return `${cr.toFixed(1)}`;
    return `${cr.toFixed(2)}`;
  };

  // ─── Render ───

  return (
    <div className="space-y-4">
      {/* Demo mode warning banner — shown prominently when user has no/expired creds */}
      {trendMode === 'demo' && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-300">
          <strong className="font-semibold">⚠ Demo Data Active</strong> — Showing simulated prices (e.g. Nifty ~24,350).
          Real market data requires a valid Kite access token. Open the <strong>Settings</strong> tab → paste your
          <strong> request_token</strong> → click <strong>Generate Access Token</strong>. The token refreshes daily at midnight IST.
        </div>
      )}

      {/* Header with mode badge + summary cards */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={trendMode === 'live' ? 'border-emerald-500/40 text-emerald-300' : 'border-orange-500/40 text-orange-300'}>
            {trendMode === 'live' ? 'LIVE' : trendMode === 'error' ? 'Error' : 'Demo'}
          </Badge>
          <span className="text-xs text-muted-foreground">Trend Analysis — Price + Cash + Options Flow</span>
          <span className="text-[10px] text-muted-foreground">Persistent across tab switches</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Last poll: {lastPollStr}</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Cash pts: {cashFlowTrend.length}</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Flow pts: {flowTrend.length}</span>
        </div>
      </div>

      {/* Section 1: Nifty 50 Spot Price + Cash Flow Trend (stacked) */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Nifty 50 — Intraday Price Trend</h3>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {niftyCurrentPrice > 0 && (
              <>
                <span className="font-mono font-semibold text-emerald-400">
                  {niftyCurrentPrice.toLocaleString('en-IN')}
                </span>
                <span className={`flex items-center gap-0.5 font-mono ${niftyChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {niftyChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {niftyChange >= 0 ? '+' : ''}{niftyChange.toFixed(1)} ({niftyChangePct >= 0 ? '+' : ''}{niftyChangePct.toFixed(2)}%)
                </span>
              </>
            )}
          </div>
        </div>
        <div className="h-[200px]">
          {niftyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={niftyChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="niftyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={niftyDomain}
                  ticks={niftyTicks}
                  tickFormatter={(v: number) => minutesToTimeStr(v)}
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  allowDataOverflow
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  tickFormatter={(v: number) => (v / 1000).toFixed(1) + 'K'}
                  width={55}
                />
                <Tooltip content={<NiftyTooltip />} />
                {niftyOpenPrice > 0 && (
                  <ReferenceLine y={niftyOpenPrice} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />
                )}
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#niftyGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Waiting for candle data...
            </div>
          )}
        </div>

        {/* Net Cash Flow Trend — directly below Nifty price */}
        <div className="mt-1 pt-3 border-t border-border/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-sky-400" />
              <h4 className="text-xs font-semibold">Net Cash Flow — 15 Stocks (NSE + BSE, Cumulative since open)</h4>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">NSE: {cumNseCr.toFixed(1)} Cr</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-muted-foreground">BSE: {cumBseCr.toFixed(1)} Cr</span>
              </div>
              <div className={`font-mono font-semibold ${cumNetCr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                Net: {cumNetCr.toFixed(1)} Cr
              </div>
              <span className={`font-mono ${currentIntervalCashFlow >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                15s: {currentIntervalCashFlow >= 0 ? '+' : ''}{fmtCr(currentIntervalCashFlow)} Cr
              </span>
            </div>
          </div>
          <div className="h-[130px]">
            {cashChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cashNetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cumNetCr >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={cumNetCr >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={cashDomain}
                    ticks={cashTicks}
                    tickFormatter={(v: number) => minutesToTimeStr(v)}
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    allowDataOverflow
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={40}
                  />
                  <Tooltip content={<CashFlowTrendTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  {/* NSE cumulative line */}
                  <Line type="monotone" dataKey="nse" stroke="#22c55e" strokeWidth={1.2} dot={false} strokeOpacity={0.7} />
                  {/* BSE cumulative line */}
                  <Line type="monotone" dataKey="bse" stroke="#0ea5e9" strokeWidth={1.2} dot={false} strokeOpacity={0.7} />
                  {/* Net combined area */}
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#cashNetGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating cash flow trend... (need 2+ polls)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Index Options Flow + Current Flow Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Index Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              <h3 className="text-sm font-semibold">Index Options Money Flow</h3>
            </div>
            <span className="text-[10px] text-muted-foreground">Cumulative Net Flow (Cr)</span>
          </div>
          {/* Current interval cards */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {INDEX_SYMBOLS.map((idx) => {
              const flow = currentIdxFlows[idx] || 0;
              const cum = cumulativeFlow[idx] || 0;
              const c = IDX_COLORS[idx];
              return (
                <div key={idx} className={`${c.bg} rounded-lg p-1.5 text-center`}>
                  <div className="text-[9px] text-muted-foreground">{IDX_NAMES[idx]}</div>
                  <div className={`text-xs font-mono font-semibold ${flow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {flow >= 0 ? '+' : ''}{fmtCr(flow)}
                  </div>
                  <div className="text-[9px] text-muted-foreground font-mono">
                    cum: {fmtCr(cum)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-[200px]">
            {flowChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={flowChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={flowDomain}
                    ticks={flowTicks}
                    tickFormatter={(v: number) => minutesToTimeStr(v)}
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    allowDataOverflow
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={45}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  {INDEX_SYMBOLS.map((idx) => (
                    <Line
                      key={idx}
                      type="monotone"
                      dataKey={idx}
                      stroke={IDX_COLORS[idx].stroke}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>

        {/* Stock Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Stock Options Money Flow (15 F&O Stocks)</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-semibold ${currentStockFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                Interval: {currentStockFlow >= 0 ? '+' : ''}{fmtCr(currentStockFlow)} Cr
              </span>
              <span className="text-[10px] text-muted-foreground">
                Cum: {fmtCr(cumulativeFlow.stockAggregate || 0)} Cr
              </span>
            </div>
          </div>
          <div className="h-[230px]">
            {flowChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stockFlowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={flowDomain}
                    ticks={flowTicks}
                    tickFormatter={(v: number) => minutesToTimeStr(v)}
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    allowDataOverflow
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={45}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  <Area
                    type="monotone"
                    dataKey="stockAggregate"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#stockFlowGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating stock options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Dual Exchange Cash Flow */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold">Dual Exchange Cash Flow — 15 F&O Stocks (NSE + BSE)</h3>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">NSE: {fmtCr(totalNseFlow)} Cr</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
              <span className="text-muted-foreground">BSE: {fmtCr(totalBseFlow)} Cr</span>
            </div>
            <div className={`font-mono font-semibold ${totalCombinedFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Net: {fmtCr(totalCombinedFlow)} Cr
            </div>
            <div className="text-muted-foreground">
              Weighted: {fmtCr(totalWeightedFlow)} Cr
            </div>
          </div>
        </div>
        <div className="h-[280px]">
          {stockCashFlow.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stockCashFlow}
                margin={{ top: 5, right: 10, left: 10, bottom: 60 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  tickFormatter={(v: number) => `${(v / 10000000).toFixed(0)}Cr`}
                />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  width={85}
                />
                <Tooltip content={<CashTooltip />} />
                <ReferenceLine x={0} stroke="#ffffff30" />
                <Bar dataKey="nseCashFlow" fill="#22c55e" radius={[0, 3, 3, 0]} maxBarSize={12} />
                <Bar dataKey="bseCashFlow" fill="#0ea5e9" radius={[0, 3, 3, 0]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Waiting for stock cash flow data...
            </div>
          )}
        </div>
        {/* Cash flow summary table */}
        {stockCashFlow.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-left py-1 pr-2">Symbol</th>
                  <th className="text-right py-1 px-1">Wt%</th>
                  <th className="text-right py-1 px-1">NSE LTP</th>
                  <th className="text-right py-1 px-1">NSE Chg%</th>
                  <th className="text-right py-1 px-1">NSE Flow</th>
                  <th className="text-right py-1 px-1">BSE LTP</th>
                  <th className="text-right py-1 px-1">BSE Chg%</th>
                  <th className="text-right py-1 px-1">BSE Flow</th>
                  <th className="text-right py-1 px-1">Combined</th>
                  <th className="text-right py-1 pl-1">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {stockCashFlow.map((s) => (
                  <tr key={s.symbol} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="py-1 pr-2 font-medium">{s.symbol}</td>
                    <td className="text-right py-1 px-1 text-muted-foreground">{s.niftyWeight}%</td>
                    <td className="text-right py-1 px-1 font-mono">{s.nseLtp.toLocaleString('en-IN')}</td>
                    <td className={`text-right py-1 px-1 font-mono ${s.nseChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.nseChange >= 0 ? '+' : ''}{s.nseChange}%
                    </td>
                    <td className={`text-right py-1 px-1 font-mono ${s.nseCashFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtCr(s.nseCashFlow)}
                    </td>
                    <td className="text-right py-1 px-1 font-mono">{s.bseLtp > 0 ? s.bseLtp.toLocaleString('en-IN') : '-'}</td>
                    <td className={`text-right py-1 px-1 font-mono ${s.bseChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.bseLtp > 0 ? `${s.bseChange >= 0 ? '+' : ''}${s.bseChange}%` : '-'}
                    </td>
                    <td className={`text-right py-1 px-1 font-mono ${s.bseCashFlow >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
                      {s.bseLtp > 0 ? fmtCr(s.bseCashFlow) : '-'}
                    </td>
                    <td className={`text-right py-1 px-1 font-mono font-semibold ${s.combinedFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                      {fmtCr(s.combinedFlow)}
                    </td>
                    <td className={`text-right py-1 pl-1 font-mono ${s.weightedFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                      {fmtCr(s.weightedFlow)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
