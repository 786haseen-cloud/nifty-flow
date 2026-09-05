'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, Wifi, WifiOff, TrendingUp, TrendingDown, ArrowUpDown, BarChart3 } from 'lucide-react';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import type { StrikeFlowData } from '@/lib/kite-api';
import { TRACKED_SYMBOLS as SYMBOLS } from '@/lib/types';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface FlowRecord {
  timestamp: string;     // ISO string of when this was recorded
  ceBuy: number;
  ceWrite: number;
  peBuy: number;
  peWrite: number;
  netFlow: number;
}

interface TimeframeBar {
  time: string;         // HH:MM label
  ceBuy: number;
  ceWrite: number;
  peBuy: number;
  peWrite: number;
  netFlow: number;
  sampleCount: number;
}

// ═══════════════════════════════════════════
// 4-COLOR FLOW ENGINE
// ═══════════════════════════════════════════

const DIVISOR = 10000000;

function computeStrikeFlow(
  prev: StrikeFlowData, curr: StrikeFlowData, lotSize: number,
): { ceBuy: number; ceWrite: number; peBuy: number; peWrite: number } {
  const dceOI = curr.ceOI - prev.ceOI;
  const dceP = curr.ceLTP - prev.ceLTP;
  let ceBuy = 0, ceWrite = 0;

  if (dceOI > 0 && dceP >= 0) ceBuy = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  else if (dceOI > 0 && dceP < 0) ceWrite = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  else if (dceOI < 0 && dceP < 0) ceWrite = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  else if (dceOI < 0 && dceP >= 0) ceBuy = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  if (ceBuy === 0 && ceWrite === 0 && (curr.ceVol - prev.ceVol) > 0) {
    if (dceP >= 0) ceBuy = (curr.ceVol * curr.ceDelta * lotSize * 0.4) / DIVISOR;
    else ceWrite = (curr.ceVol * curr.ceDelta * lotSize * 0.4) / DIVISOR;
  }

  const dpeOI = curr.peOI - prev.peOI;
  const dpeP = curr.peLTP - prev.peLTP;
  let peBuy = 0, peWrite = 0;

  if (dpeOI > 0 && dpeP <= 0) peBuy = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  else if (dpeOI > 0 && dpeP > 0) peWrite = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  else if (dpeOI < 0 && dpeP > 0) peWrite = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  else if (dpeOI < 0 && dpeP <= 0) peBuy = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  if (peBuy === 0 && peWrite === 0 && (curr.peVol - prev.peVol) > 0) {
    if (dpeP <= 0) peBuy = (curr.peVol * curr.peDelta * lotSize * 0.4) / DIVISOR;
    else peWrite = (curr.peVol * curr.peDelta * lotSize * 0.4) / DIVISOR;
  }

  return { ceBuy, ceWrite, peBuy, peWrite };
}

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const POLL_INTERVAL = 15000; // 15s poll (faster for more data points)
// Symbol list from shared source of truth (types.ts TRACKED_SYMBOLS)

const TIMEFRAMES = [
  { label: '5 Min', minutes: 5, bars: 85 },    // 9:15 to 15:40 = 85 x 5min bars
  { label: '15 Min', minutes: 15, bars: 29 },   // 9:15 to 15:40 = 29 x 15min bars
  { label: '30 Min', minutes: 30, bars: 15 },
] as const;

type TFIndex = 0 | 1 | 2;

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function toIST(isoStr: string): string {
  const d = new Date(isoStr);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  return ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function toISTDate(isoStr: string): Date {
  const d = new Date(isoStr);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 60 * 60 * 1000);
}

function getTimeBucket(isoStr: string, minutes: number): string {
  const ist = toISTDate(isoStr);
  const bucketMin = Math.floor(ist.getMinutes() / minutes) * minutes;
  return `${String(ist.getHours()).padStart(2, '0')}:${String(bucketMin).padStart(2, '0')}`;
}

// Aggregate raw flow records into timeframe bars
function aggregateToBars(records: FlowRecord[], minutes: number, maxBars: number): TimeframeBar[] {
  const bucketMap = new Map<string, TimeframeBar>();

  for (const r of records) {
    const bucket = getTimeBucket(r.timestamp, minutes);
    const existing = bucketMap.get(bucket) || {
      time: bucket, ceBuy: 0, ceWrite: 0, peBuy: 0, peWrite: 0, netFlow: 0, sampleCount: 0,
    };
    existing.ceBuy += r.ceBuy;
    existing.ceWrite += r.ceWrite;
    existing.peBuy += r.peBuy;
    existing.peWrite += r.peWrite;
    existing.netFlow += r.netFlow;
    existing.sampleCount += 1;
    bucketMap.set(bucket, existing);
  }

  // Sort by time and limit to maxBars
  const bars = [...bucketMap.values()].sort((a, b) => a.time.localeCompare(b.time));
  return bars.slice(-maxBars);
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

export default function MultiTimeframeTab() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [tfIndex, setTfIndex] = useState<TFIndex>(0);
  const [mode, setMode] = useState('');

  // Per-symbol flow history (raw 15s snapshots)
  const flowHistoryRef = useRef<Map<string, FlowRecord[]>>(new Map());

  // Force re-render on new data
  const [, setTick] = useState(0);

  // Shared singleton — no duplicate fetch
  const { curr, prev } = useKiteSnapshot(POLL_INTERVAL);

  // Process new snapshot into flow history
  const snapshotTs = curr?.timestamp ?? '';
  useEffect(() => {
    if (!curr) return;
    setMode(curr.mode);

    const currMap = new Map(curr.symbols.map(s => [s.symbol, s]));

    if (curr.mode === 'demo') {
      const now = new Date().toISOString();
      for (const sym of SYMBOLS) {
        const hist = flowHistoryRef.current.get(sym) || [];
        hist.push({
          timestamp: now,
          ceBuy: Math.round(Math.random() * 100),
          ceWrite: Math.round(Math.random() * 80),
          peBuy: Math.round(Math.random() * 90),
          peWrite: Math.round(Math.random() * 70),
          netFlow: Math.round((Math.random() - 0.45) * 200),
        });
        flowHistoryRef.current.set(sym, hist.slice(-500));
      }
      setTick(t => t + 1);
      return;
    }

    // Live: diff with previous snapshot from singleton
    if (prev?.symbols) {
      const prevMap = new Map(prev.symbols.map(s => [s.symbol, s]));
      const now = new Date().toISOString();
      for (const [sym, cSnap] of currMap) {
        const pSnap = prevMap.get(sym);
        if (!pSnap) continue;

        let ceBuy = 0, ceWrite = 0, peBuy = 0, peWrite = 0;
        const prevStrikesMap = new Map(pSnap.strikes.map(s => [s.strike, s]));
        for (const cStrike of cSnap.strikes) {
          const pStrike = prevStrikesMap.get(cStrike.strike);
          if (pStrike) {
            const sf = computeStrikeFlow(pStrike, cStrike, cSnap.lotSize);
            ceBuy += sf.ceBuy;
            ceWrite += sf.ceWrite;
            peBuy += sf.peBuy;
            peWrite += sf.peWrite;
          }
        }
        const netFlow = ceBuy - ceWrite - peBuy + peWrite;

        const hist = flowHistoryRef.current.get(sym) || [];
        hist.push({ timestamp: now, ceBuy, ceWrite, peBuy, peWrite, netFlow });
        flowHistoryRef.current.set(sym, hist.slice(-500));
      }
    }

    setTick(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotTs]);

  // Get aggregated bars for selected symbol + timeframe
  const bars = useMemo(() => {
    const records = flowHistoryRef.current.get(symbol) || [];
    const tf = TIMEFRAMES[tfIndex];
    return aggregateToBars(records, tf.minutes, tf.bars);
  }, [symbol, tfIndex]);

  // Compute totals for summary
  const totals = useMemo(() => {
    const t = { ceBuy: 0, ceWrite: 0, peBuy: 0, peWrite: 0, netFlow: 0 };
    for (const b of bars) {
      t.ceBuy += b.ceBuy; t.ceWrite += b.ceWrite;
      t.peBuy += b.peBuy; t.peWrite += b.peWrite;
      t.netFlow += b.netFlow;
    }
    return t;
  }, [bars]);

  const maxAbs = useMemo(() => {
    if (bars.length === 0) return 1;
    return Math.max(
      ...bars.map(b => Math.max(b.ceBuy, b.ceWrite, b.peBuy, b.peWrite, Math.abs(b.netFlow))),
      1,
    );
  }, [bars]);

  const pct = (v: number) => Math.abs(v) / maxAbs * 100;

  const fmt = (v: number) => {
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 1) return v.toFixed(1);
    return v.toFixed(2);
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          className="bg-card border border-border/30 rounded px-2 py-1 text-xs text-foreground outline-none"
        >
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex gap-1 bg-muted/20 rounded p-0.5">
          {TIMEFRAMES.map((tf, i) => (
            <button
              key={tf.label}
              onClick={() => setTfIndex(i as TFIndex)}
              className={`text-[11px] px-2.5 py-1 rounded transition ${
                tfIndex === i ? 'bg-card border border-border/30 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Clock className="w-3 h-3 inline mr-1" />
              {tf.label}
            </button>
          ))}
        </div>

        {mode && (
          <Badge variant="outline" className={mode === 'live' ? 'border-emerald-500/30 text-emerald-400' : 'border-orange-500/30 text-orange-400'}>
            {mode === 'live' ? <><Wifi className="mr-1 h-3 w-3" />LIVE</> : <><WifiOff className="mr-1 h-3 w-3" />DEMO</>}
          </Badge>
        )}

        <Badge variant="outline" className="bg-sky-600/20 text-sky-400 border-sky-500/30">
          {bars.length} bars
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="bg-card/60 border border-emerald-500/20 rounded-lg p-2 text-center">
          <div className="text-[10px] text-emerald-400/80">CE Buy</div>
          <div className="text-sm font-mono font-bold text-emerald-400">{fmt(totals.ceBuy)} Cr</div>
        </div>
        <div className="bg-card/60 border border-red-500/20 rounded-lg p-2 text-center">
          <div className="text-[10px] text-red-400/80">CE Write</div>
          <div className="text-sm font-mono font-bold text-red-400">{fmt(totals.ceWrite)} Cr</div>
        </div>
        <div className="bg-card/60 border border-red-500/20 rounded-lg p-2 text-center">
          <div className="text-[10px] text-red-400/80">PE Buy</div>
          <div className="text-sm font-mono font-bold text-red-400">{fmt(totals.peBuy)} Cr</div>
        </div>
        <div className="bg-card/60 border border-emerald-500/20 rounded-lg p-2 text-center">
          <div className="text-[10px] text-emerald-400/80">PE Write</div>
          <div className="text-sm font-mono font-bold text-emerald-400">{fmt(totals.peWrite)} Cr</div>
        </div>
        <div className={`bg-card/60 border rounded-lg p-2 text-center col-span-2 sm:col-span-1 ${totals.netFlow >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'}`}>
          <div className={`text-[10px] ${totals.netFlow >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>Net Flow</div>
          <div className={`text-sm font-mono font-bold ${totals.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totals.netFlow >= 0 ? '+' : ''}{fmt(totals.netFlow)} Cr
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-card/60 border border-border/40 rounded-lg p-3 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 mb-3">
          <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
          {symbol} — {TIMEFRAMES[tfIndex].label} Flow Bars
          <span className="text-[10px] text-muted-foreground ml-1">(aggregated from 15s snapshots)</span>
        </div>

        {bars.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-12">
            Collecting data... Bars will appear after a few polling cycles.
          </div>
        ) : (
          <div className="flex items-end gap-[3px] h-48 min-w-[600px]">
            {bars.map((bar, i) => {
              const bullH = pct(bar.ceBuy + bar.peWrite); // green components
              const bearH = pct(bar.ceWrite + bar.peBuy); // red components
              const netH = pct(Math.abs(bar.netFlow));
              const isNetBull = bar.netFlow >= 0;

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative min-w-[6px]">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-card border border-border/50 rounded p-2 text-[10px] whitespace-nowrap shadow-lg">
                    <div className="font-medium">{bar.time} IST</div>
                    <div className="text-emerald-400">CE Buy: {fmt(bar.ceBuy)} Cr</div>
                    <div className="text-red-400">CE Write: {fmt(bar.ceWrite)} Cr</div>
                    <div className="text-red-400">PE Buy: {fmt(bar.peBuy)} Cr</div>
                    <div className="text-emerald-400">PE Write: {fmt(bar.peWrite)} Cr</div>
                    <div className={isNetBull ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                      Net: {bar.netFlow >= 0 ? '+' : ''}{fmt(bar.netFlow)} Cr
                    </div>
                    <div className="text-muted-foreground">Samples: {bar.sampleCount}</div>
                  </div>

                  {/* Net flow bar (full height, background) */}
                  <div className="w-full rounded-sm relative" style={{ height: `${Math.max(netH, 4)}%` }}>
                    <div className={`absolute inset-0 rounded-sm ${isNetBull ? 'bg-emerald-500/40' : 'bg-red-500/40'}`} />
                    {/* Inner intensity bar */}
                    <div
                      className={`absolute bottom-0 left-0 right-0 rounded-sm ${isNetBull ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ height: `${Math.min(netH * 0.7, 100)}%`, opacity: 0.8 }}
                    />
                  </div>

                  {/* Time label (show every Nth) */}
                  {(i % Math.max(1, Math.floor(bars.length / 12)) === 0 || i === bars.length - 1) && (
                    <span className="text-[8px] text-muted-foreground -rotate-45 origin-top-left mt-0.5">
                      {bar.time}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Data Table */}
      {bars.length > 0 && (
        <div className="bg-card/60 border border-border/40 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/30 border-b border-border/30">
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Time</th>
                <th className="text-right px-2 py-1.5 font-medium text-emerald-400">CE Buy</th>
                <th className="text-right px-2 py-1.5 font-medium text-red-400">CE Write</th>
                <th className="text-right px-2 py-1.5 font-medium text-red-400">PE Buy</th>
                <th className="text-right px-2 py-1.5 font-medium text-emerald-400">PE Write</th>
                <th className="text-right px-2 py-1.5 font-medium">Net</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Samples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/15">
              {[...bars].reverse().map((bar, i) => (
                <tr key={i} className="hover:bg-muted/10 transition">
                  <td className="px-2 py-1 font-mono">{bar.time}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-400">{fmt(bar.ceBuy)}</td>
                  <td className="px-2 py-1 text-right font-mono text-red-400">{fmt(bar.ceWrite)}</td>
                  <td className="px-2 py-1 text-right font-mono text-red-400">{fmt(bar.peBuy)}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-400">{fmt(bar.peWrite)}</td>
                  <td className={`px-2 py-1 text-right font-mono font-medium ${bar.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {bar.netFlow >= 0 ? '+' : ''}{fmt(bar.netFlow)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">{bar.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="text-[11px] text-muted-foreground space-y-1 bg-card/40 border border-border/20 rounded-lg p-3">
        <p><span className="text-foreground font-medium">How it works:</span> Polls every 15s, diffs consecutive snapshots to compute 4-color flow, then aggregates into {TIMEFRAMES[tfIndex].label} buckets.</p>
        <p><span className="text-foreground font-medium">Green bars</span> = net bullish (CE Buy + PE Write dominant). <span className="text-foreground font-medium">Red bars</span> = net bearish (CE Write + PE Buy dominant).</p>
        <p><span className="text-foreground font-medium">Bar height</span> = net flow magnitude in Cr. Hover for full breakdown per bar.</p>
        <p>Data accumulates during the session. Switch timeframes to see different granularity.</p>
      </div>
    </div>
  );
}
