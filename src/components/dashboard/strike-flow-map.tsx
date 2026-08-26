'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { withCreds } from '@/lib/kite-creds';
import { Wifi, WifiOff, RefreshCw, Crosshair } from 'lucide-react';
import { INDEX_SPECS, STOCK_SPECS } from '@/lib/kite-api';
import type { StrikeFlowSnapshot, StrikeFlowData } from '@/lib/kite-api';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface StrikeFlowCell {
  strike: number;
  isATM: boolean;
  ceBuy: number;    // bright green
  ceWrite: number;   // light red
  peBuy: number;    // bright red
  peWrite: number;   // light green
  ceDisplay: number; // max(ceBuy, ceWrite) for display
  peDisplay: number; // max(peWrite, peBuy) for display
  ceType: 'buy' | 'write' | 'none';
  peType: 'write' | 'buy' | 'none';
}

interface FlowTotals {
  ceBuy: number;
  ceWrite: number;
  peBuy: number;
  peWrite: number;
  netFlow: number;
  time: string; // HH:MM:SS timestamp
}

// ═══════════════════════════════════════════
// 4-COLOR FLOW ENGINE (from your Google Script)
// OI change + Price change → 4 cases
// ═══════════════════════════════════════════

function computeStrikeFlow(
  prev: StrikeFlowData,
  curr: StrikeFlowData,
  lotSize: number,
): Omit<StrikeFlowCell, 'strike' | 'isATM'> {
  const DIVISOR = 10000000; // Convert to Crores

  // CE side
  const dceOI = curr.ceOI - prev.ceOI;
  const dceP = curr.ceLTP - prev.ceLTP;
  let ceBuy = 0, ceWrite = 0;

  if (dceOI > 0 && dceP >= 0) {
    // Case 1: OI up + Price up → CE BUY (writers losing, buyers aggressive)
    ceBuy = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI > 0 && dceP < 0) {
    // Case 2: OI up + Price down → CE WRITE (writing at higher premium, price falling)
    ceWrite = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI < 0 && dceP < 0) {
    // Case 3: OI down + Price down → CE WRITE (short covering at lower price = write)
    ceWrite = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  } else if (dceOI < 0 && dceP >= 0) {
    // Case 4: OI down + Price up → CE WRITE (long unwinding at higher price = write)
    ceWrite = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  }

  // Volume fallback when OI unchanged (from your script v5)
  if (ceBuy === 0 && ceWrite === 0 && curr.ceVol > 0) {
    const vf = 0.4;
    if (dceP >= 0) ceBuy = (curr.ceVol * curr.ceDelta * lotSize * vf) / DIVISOR;
    else ceWrite = (curr.ceVol * curr.ceDelta * lotSize * vf) / DIVISOR;
  }

  // PE side (same 4 cases, mirrored)
  const dpeOI = curr.peOI - prev.peOI;
  const dpeP = curr.peLTP - prev.peLTP;
  let peBuy = 0, peWrite = 0;

  if (dpeOI > 0 && dpeP >= 0) {
    peBuy = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI > 0 && dpeP < 0) {
    peWrite = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI < 0 && dpeP < 0) {
    peWrite = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  } else if (dpeOI < 0 && dpeP >= 0) {
    peBuy = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  }

  // Volume fallback for PE
  if (peBuy === 0 && peWrite === 0 && curr.peVol > 0) {
    const vf = 0.4;
    if (dpeP >= 0) peBuy = (curr.peVol * curr.peDelta * lotSize * vf) / DIVISOR;
    else peWrite = (curr.peVol * curr.peDelta * lotSize * vf) / DIVISOR;
  }

  // Determine display values (show dominant flow per side)
  const ceDisplay = ceBuy >= ceWrite ? ceBuy : ceWrite;
  const peDisplay = peWrite >= peBuy ? peWrite : peBuy;
  const ceType = ceBuy > 0 && ceBuy >= ceWrite ? 'buy' : ceWrite > 0 ? 'write' : 'none';
  const peType = peWrite > 0 && peWrite >= peBuy ? 'write' : peBuy > 0 ? 'buy' : 'none';

  return { ceBuy, ceWrite, peBuy, peWrite, ceDisplay, peDisplay, ceType, peType };
}

// ═══════════════════════════════════════════
// COLOR SYSTEM (matching your Google Sheet)
// ═══════════════════════════════════════════

const COLORS = {
  dark: '#1a1a2e',
  darkAlt: '#16213e',
  zero: '#555555',
  ceBuy: '#00B050',      // Bright green — CE Buy (bullish)
  ceBuyText: '#ffffff',
  ceWrite: '#FFCCCC',    // Light red — CE Write (bearish)
  ceWriteText: '#9c0006',
  peWrite: '#C6EFCE',    // Light green — PE Write (bullish)
  peWriteText: '#006100',
  peBuy: '#BD2130',      // Bright red — PE Buy (bearish)
  peBuyText: '#ffffff',
  netBull: '#00B050',
  netBear: '#BD2130',
  netText: '#ffffff',
  otm: { bg: '#3D2200', fg: '#FFA500' },
  atm: { bg: '#3D3D00', fg: '#FFD700' },
  itm: { bg: '#003040', fg: '#00BFFF' },
  accent: '#e94560',
  info: '#a8d8ea',
};

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

const REFRESH_INTERVAL = 30000; // 30 seconds (options data doesn't change every second)
const ALL_SYMBOLS = [
  ...INDEX_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'index' as const })),
  ...STOCK_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'stock' as const })),
];

// Historical backfill type
interface HistoricalPoint {
  time: string;
  netFlow: number;
  ceBuy: number;
  ceWrite: number;
  peBuy: number;
  peWrite: number;
}

export default function StrikeFlowMap() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [prevSnapshot, setPrevSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [currSnapshot, setCurrSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [flowHistory, setFlowHistory] = useState<FlowTotals[]>([]);
  const [historicalData, setHistoricalData] = useState<HistoricalPoint[]>([]);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillDone, setBackfillDone] = useState(false);
  const historicalCacheRef = useRef<Record<string, HistoricalPoint[]> | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withCreds(`/api/kite/strike-flow?symbol=${symbol}`));
      const data = await res.json();

      if (data.mode === 'demo') {
        setIsLive(false);
        setError('Kite API not configured. Set KITE_API_KEY + KITE_ACCESS_TOKEN in Settings.');
        setLoading(false);
        return;
      }

      if (data.mode === 'error') {
        setError(data.error || 'Unknown error');
        setLoading(false);
        return;
      }

      setIsLive(true);
      setLastUpdate(new Date(data.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }));

      // Shift current to prev, set new current
      setPrevSnapshot(prev => {
        if (prev && prev.symbol === data.symbol && data.strikes?.length >= 11) {
          // We have both snapshots — compute flow
          const cells = computeFlowCells(prev, data);
          const totals = computeTotals(cells);
          setFlowHistory(h => {
            const now = new Date().toLocaleTimeString('en-IN', {
              hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            });
            const updated = [...h, { ...totals, netFlow: totals.netFlow, time: now }];
            return updated.slice(-120); // keep last 120 intervals (~1 hour at 30s)
          });
        }
        return currSnapshot;
      });
      setCurrSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [symbol, currSnapshot]);

  // ── Historical Backfill (once per session) ──
  useEffect(() => {
    if (backfillDone) return;
    let cancelled = false;

    async function loadHistorical() {
      setBackfillLoading(true);
      try {
        const res = await fetch(withCreds('/api/kite/historical-flow'));
        const data = await res.json();
        if (cancelled) return;

        if (data.mode === 'live' && data.flowTrend?.length > 0) {
          // Cache the raw flow trend per symbol
          const cache: Record<string, HistoricalPoint[]> = {};
          const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'];
          for (const sym of symbols) {
            const points = data.flowTrend.map(p => ({
              time: p.time,
              netFlow: p[sym as keyof typeof p] as number,
              ceBuy: 0, ceWrite: 0, peBuy: 0, peWrite: 0,
            }));
            // Convert cumulative → per-interval delta
            const deltas: HistoricalPoint[] = [];
            for (let i = 0; i < points.length; i++) {
              const delta = i === 0 ? points[0].netFlow : points[i].netFlow - points[i - 1].netFlow;
              deltas.push({ ...points[i], netFlow: Math.round(delta * 100) / 100 });
            }
            cache[sym] = deltas;
          }

          // Stock aggregate
          const stockPoints = data.flowTrend.map(p => ({
            time: p.time,
            netFlow: p.stockAggregate as number,
            ceBuy: 0, ceWrite: 0, peBuy: 0, peWrite: 0,
          }));
          const stockDeltas: HistoricalPoint[] = [];
          for (let i = 0; i < stockPoints.length; i++) {
            const delta = i === 0 ? stockPoints[0].netFlow : stockPoints[i].netFlow - stockPoints[i - 1].netFlow;
            stockDeltas.push({ ...stockPoints[i], netFlow: Math.round(delta * 100) / 100 });
          }
          // Store stock data under each STOCK_SPEC symbol
          for (const s of STOCK_SPECS) {
            cache[s.symbol] = stockDeltas;
          }

          historicalCacheRef.current = cache;
          setHistoricalData(cache[symbol] || []);
          setBackfillDone(true);
          console.log(`[StrikeFlow] Historical backfill loaded: ${Object.keys(cache).length} symbols, ${data.flowTrend.length} time points`);
        } else {
          setBackfillDone(true); // skip on error/demo
        }
      } catch (e) {
        console.warn('[StrikeFlow] Historical backfill failed:', e);
        setBackfillDone(true);
      } finally {
        if (!cancelled) setBackfillLoading(false);
      }
    }

    loadHistorical();
    return () => { cancelled = true; };
  }, [backfillDone, symbol]);

  // When symbol changes, switch historical data from cache
  useEffect(() => {
    if (historicalCacheRef.current && backfillDone) {
      setHistoricalData(historicalCacheRef.current[symbol] || []);
    }
  }, [symbol, backfillDone]);

  // Initial fetch + interval
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  // Compute flow cells from two snapshots
  function computeFlowCells(prev: StrikeFlowSnapshot, curr: StrikeFlowSnapshot): StrikeFlowCell[] {
    const prevMap = new Map(prev.strikes.map(s => [s.strike, s]));
    return curr.strikes
      .filter(s => prevMap.has(s.strike))
      .map(s => ({
        strike: s.strike,
        isATM: s.isATM,
        ...computeStrikeFlow(prevMap.get(s.strike)!, s, curr.lotSize),
      }))
      .sort((a, b) => a.strike - b.strike);
  }

  // Compute totals
  function computeTotals(cells: StrikeFlowCell[]): FlowTotals {
    let ceBuy = 0, ceWrite = 0, peBuy = 0, peWrite = 0;
    for (const c of cells) {
      ceBuy += c.ceBuy;
      ceWrite += c.ceWrite;
      peBuy += c.peBuy;
      peWrite += c.peWrite;
    }
    return {
      ceBuy: Math.round(ceBuy * 100) / 100,
      ceWrite: Math.round(ceWrite * 100) / 100,
      peBuy: Math.round(peBuy * 100) / 100,
      peWrite: Math.round(peWrite * 100) / 100,
      netFlow: Math.round((ceBuy + peWrite - ceWrite - peBuy) * 100) / 100,
    };
  }

  // Compute current flow from stored prev/curr
  const flowCells: StrikeFlowCell[] = (() => {
    if (!prevSnapshot || !currSnapshot) return [];
    if (prevSnapshot.symbol !== currSnapshot.symbol) return [];
    if (currSnapshot.strikes.length < 11) return [];
    return computeFlowCells(prevSnapshot, currSnapshot);
  })();

  const totals: FlowTotals = flowCells.length > 0 ? computeTotals(flowCells) : { ceBuy: 0, ceWrite: 0, peBuy: 0, peWrite: 0, netFlow: 0 };

  // Find max single bet for thick border
  let maxBetVal = 0, maxBetSide: 'ce' | 'pe' | null = null, maxBetIdx = -1;
  for (let i = 0; i < flowCells.length; i++) {
    const c = flowCells[i];
    if (c.ceDisplay > maxBetVal) { maxBetVal = c.ceDisplay; maxBetSide = 'ce'; maxBetIdx = i; }
    if (c.peDisplay > maxBetVal) { maxBetVal = c.peDisplay; maxBetSide = 'pe'; maxBetIdx = i; }
  }

  // Dynamic offsets based on strikeStep (works for Nifty=50, HDFCBANK=10, etc.)
  const step = currSnapshot ? currSnapshot.strikeStep : 50;
  const n = 5;
  const CE_OFFSETS = Array.from({ length: n * 2 + 1 }, function(_, i) { return (n - i) * step; });
  const PE_OFFSETS = Array.from({ length: n * 2 + 1 }, function(_, i) { return (i - n) * step; });
  const CE_CATS = Array.from({ length: n * 2 + 1 }, function(_, i) { return i < n ? 'OTM' : i === n ? 'ATM' : 'ITM'; });
  const PE_CATS = Array.from({ length: n * 2 + 1 }, function(_, i) { return i < n ? 'OTM' : i === n ? 'ATM' : 'ITM'; });

  function getCellByOffset(cells: StrikeFlowCell[], offset: number): StrikeFlowCell | undefined {
    if (!currSnapshot) return undefined;
    const strike = currSnapshot.atmStrike + offset;
    return cells.find(c => c.strike === strike);
  }

  function cellBg(type: 'buy' | 'write' | 'none', side: 'ce' | 'pe'): string {
    if (type === 'none') return COLORS.dark;
    if (side === 'ce') return type === 'buy' ? COLORS.ceBuy : COLORS.ceWrite;
    return type === 'write' ? COLORS.peWrite : COLORS.peBuy;
  }

  function cellText(type: 'buy' | 'write' | 'none', side: 'ce' | 'pe'): string {
    if (type === 'none') return COLORS.zero;
    if (side === 'ce') return type === 'buy' ? COLORS.ceBuyText : COLORS.ceWriteText;
    return type === 'write' ? COLORS.peWriteText : COLORS.peBuyText;
  }

  function catStyle(cat: string) {
    const c = cat === 'OTM' ? COLORS.otm : cat === 'ATM' ? COLORS.atm : COLORS.itm;
    return { background: c.bg, color: c.fg };
  }

  function fmtVal(v: number): string {
    if (v === 0) return '—';
    return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  }

  // ═══════════════════════════════════════════
  // HISTORICAL BAR CHART (9:15 AM → 3:40 PM)
  // Merges backfilled 5-min historical data + live 30s data
  // ═══════════════════════════════════════════
  function HistoricalBarChart() {
    // Merge: historical backfill (5-min intervals) + live data (30s intervals)
    const allPoints = [
      ...historicalData.map(h => ({ time: h.time, netFlow: h.netFlow })),
      ...flowHistory.map(h => ({ time: h.time, netFlow: h.netFlow })),
    ];

    if (allPoints.length < 1) return null;
    const vals = allPoints.map(h => h.netFlow);
    const times = allPoints.map(h => h.time);
    const maxAbs = Math.max(...vals.map(Math.abs), 0.01);

    // Chart dimensions
    const chartH = 160;
    const labelH = 50;
    const padLeft = 45;
    const padRight = 10;
    const padTop = 8;
    const padBot = 0;
    const totalW = 1000;
    const plotW = totalW - padLeft - padRight;
    const plotH = chartH - padTop - padBot;
    const zeroY = padTop + plotH / 2;

    // Bar sizing
    const barGap = 1;
    const barW = Math.max(2, (plotW - barGap * vals.length) / vals.length);
    const actualTotalBarW = barW * vals.length + barGap * (vals.length - 1);
    const offsetX = padLeft + (plotW - actualTotalBarW) / 2;

    // Y-axis labels
    const yTicks = 5;
    const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => {
      const v = maxAbs - (2 * maxAbs * i) / yTicks;
      return Math.round(v * 100) / 100;
    });

    // Time labels — show every N bars to avoid crowding
    const maxLabels = Math.floor(plotW / 55);
    const labelEvery = Math.max(1, Math.ceil(vals.length / maxLabels));

    // Cumulative line data
    let cumVals: number[] = [];
    let cum = 0;
    for (const v of vals) { cum += v; cumVals.push(cum); }
    const cumMaxAbs = Math.max(...cumVals.map(Math.abs), 0.01);

    return (
      <div>
        <svg width="100%" viewBox={`0 0 ${totalW} ${chartH + labelH}`} style={{ background: COLORS.dark, borderRadius: '6px' }}>
          {/* Grid lines */}
          {yTickVals.map((v, i) => {
            const y = padTop + (plotH * i) / yTicks;
            return (
              <g key={`grid-${i}`}>
                <line x1={padLeft} y1={y} x2={totalW - padRight} y2={y} stroke="#222" strokeWidth="0.5" />
                <text x={padLeft - 4} y={y + 3} textAnchor="end" fill="#888" fontSize="7" fontFamily="monospace">
                  {v >= 0 ? '+' : ''}{v.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Zero line */}
          <line x1={padLeft} y1={zeroY} x2={totalW - padRight} y2={zeroY} stroke="#555" strokeWidth="1" />

          {/* Bars */}
          {vals.map((v, i) => {
            const x = offsetX + i * (barW + barGap);
            const barH = (Math.abs(v) / maxAbs) * (plotH / 2 - 2);
            const y = v >= 0 ? zeroY - barH : zeroY;
            const color = v >= 0 ? COLORS.netBull : COLORS.netBear;
            const opacity = 0.85;
            return (
              <rect key={`bar-${i}`} x={x} y={y} width={barW} height={barH} fill={color} opacity={opacity} rx="1">
                <title>{times[i]}: {v >= 0 ? '+' : ''}{v.toFixed(2)} Cr</title>
              </rect>
            );
          })}

          {/* Cumulative flow line */}
          {cumVals.length >= 2 && (
            <polyline
              points={cumVals.map((v, i) => {
                const x = offsetX + i * (barW + barGap) + barW / 2;
                const y = zeroY - (v / cumMaxAbs) * (plotH / 2 - 6);
                return `${x},${y}`;
              }).join(' ')}
              fill="none" stroke="#FFD700" strokeWidth="1" opacity="0.6"
              strokeLinejoin="round"
            />
          )}

          {/* X-axis time labels */}
          {times.map((t, i) => {
            if (i % labelEvery !== 0 && i !== vals.length - 1) return null;
            const x = offsetX + i * (barW + barGap) + barW / 2;
            const labelY = chartH + 12;
            // Show HH:MM format (drop seconds for readability)
            const shortTime = t.substring(0, 5);
            return (
              <text key={`time-${i}`} x={x} y={labelY} textAnchor="middle" fill="#888" fontSize="7" fontFamily="monospace">
                {shortTime}
              </text>
            );
          })}

          {/* Legend */}
          <rect x={padLeft + 5} y={chartH + 28} width="8" height="8" fill={COLORS.netBull} rx="1" />
          <text x={padLeft + 16} y={chartH + 35} fill="#aaa" fontSize="7" fontFamily="monospace">Bullish</text>
          <rect x={padLeft + 65} y={chartH + 28} width="8" height="8" fill={COLORS.netBear} rx="1" />
          <text x={padLeft + 76} y={chartH + 35} fill="#aaa" fontSize="7" fontFamily="monospace">Bearish</text>
          <line x1={padLeft + 130} y1={chartH + 32} x2={padLeft + 150} y2={chartH + 32} stroke="#FFD700" strokeWidth="1" opacity="0.6" />
          <text x={padLeft + 154} y={chartH + 35} fill="#aaa" fontSize="7" fontFamily="monospace">Cumulative</text>

          {/* Data points count */}
          <text x={totalW - padRight - 5} y={chartH + 35} textAnchor="end" fill="#555" fontSize="7" fontFamily="monospace">
            {vals.length} intervals
          </text>
        </svg>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // TOTALS STACKED BAR (matching your SF_TOTAL sheet)
  // ═══════════════════════════════════════════
  function TotalFlowBar() {
    const maxTotal = Math.max(Math.abs(totals.ceBuy), Math.abs(totals.ceWrite),
      Math.abs(totals.peWrite), Math.abs(totals.peBuy), 0.01);
    const barH = 20;

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground w-16">CE Buy</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: COLORS.dark }}>
            <div className="h-full rounded-sm transition-all duration-500" style={{
              width: `${Math.min(100, (totals.ceBuy / maxTotal) * 100)}%`,
              background: COLORS.ceBuy,
              minWidth: totals.ceBuy > 0 ? '2px' : '0',
            }} />
          </div>
          <span className="w-16 text-right font-mono" style={{ color: COLORS.ceBuy }}>{totals.ceBuy.toFixed(2)} Cr</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground w-16">CE Write</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: COLORS.dark }}>
            <div className="h-full rounded-sm transition-all duration-500" style={{
              width: `${Math.min(100, (totals.ceWrite / maxTotal) * 100)}%`,
              background: COLORS.ceWrite,
              minWidth: totals.ceWrite > 0 ? '2px' : '0',
            }} />
          </div>
          <span className="w-16 text-right font-mono" style={{ color: COLORS.ceWriteText }}>{totals.ceWrite.toFixed(2)} Cr</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground w-16">PE Write</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: COLORS.dark }}>
            <div className="h-full rounded-sm transition-all duration-500" style={{
              width: `${Math.min(100, (totals.peWrite / maxTotal) * 100)}%`,
              background: COLORS.peWrite,
              minWidth: totals.peWrite > 0 ? '2px' : '0',
            }} />
          </div>
          <span className="w-16 text-right font-mono" style={{ color: COLORS.peWriteText }}>{totals.peWrite.toFixed(2)} Cr</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground w-16">PE Buy</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: COLORS.dark }}>
            <div className="h-full rounded-sm transition-all duration-500" style={{
              width: `${Math.min(100, (totals.peBuy / maxTotal) * 100)}%`,
              background: COLORS.peBuy,
              minWidth: totals.peBuy > 0 ? '2px' : '0',
            }} />
          </div>
          <span className="w-16 text-right font-mono" style={{ color: COLORS.peBuyText }}>{totals.peBuy.toFixed(2)} Cr</span>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  return (
    <div className="space-y-3">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold" style={{ color: COLORS.accent }}>
            STRIKE FLOW MAP
          </h2>
          {isLive ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
              <Wifi className="mr-1 h-3 w-3" />Kite LIVE
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">
              <WifiOff className="mr-1 h-3 w-3" />Offline
            </Badge>
          )}
          {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
          {lastUpdate && (
            <span className="text-[10px] font-mono text-muted-foreground">Updated: {lastUpdate}</span>
          )}
        </div>

        {/* Symbol Selector — dropdown for 19 symbols */}
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={function(e) { setSymbol(e.target.value); setPrevSnapshot(null); setCurrSnapshot(null); setFlowHistory([]); }}
            className="bg-muted/50 border border-border/50 rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          >
            <optgroup label="Indices">
              {ALL_SYMBOLS.filter(function(s) { return s.type === 'index'; }).map(function(s) {
                return <option key={s.symbol} value={s.symbol}>{s.name}</option>;
              })}
            </optgroup>
            <optgroup label="Stocks">
              {ALL_SYMBOLS.filter(function(s) { return s.type === 'stock'; }).map(function(s) {
                return <option key={s.symbol} value={s.symbol}>{s.name}</option>;
              })}
            </optgroup>
          </select>
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-300">
            {ALL_SYMBOLS.find(function(s) { return s.symbol === symbol; }) ? 'INDEX/STOCK' : ''}
          </Badge>
        </div>
      </div>

      {error && (
        <div className="rounded-md p-3 text-xs" style={{ background: '#2e0a0a', color: '#ff6666', border: '1px solid #5a1a1a' }}>
          {error}
        </div>
      )}

      {/* Waiting for 2 snapshots */}
      {isLive && !error && flowCells.length === 0 && (
        <div className="rounded-md p-4 text-center text-xs text-muted-foreground" style={{ background: COLORS.dark }}>
          <Crosshair className="h-5 w-5 mx-auto mb-2 animate-pulse" style={{ color: COLORS.info }} />
          <p className="font-semibold" style={{ color: COLORS.info }}>Collecting snapshots...</p>
          <p className="mt-1">Need 2 consecutive data points to compute flow. Next poll in {REFRESH_INTERVAL / 1000}s.</p>
          {currSnapshot && (
            <p className="mt-1 font-mono">Snapshot 1 received: {currSnapshot.strikes.length} strikes, Spot: {currSnapshot.spotPrice.toFixed(0)}</p>
          )}
        </div>
      )}

      {/* Main Grid */}
      {flowCells.length > 0 && currSnapshot && (
        <div className="overflow-x-auto">
          {/* Spot + ATM Info */}
          <div className="flex items-center gap-3 mb-2 px-1">
            <span className="text-[10px] font-mono" style={{ color: COLORS.info }}>
              Spot: <b className="text-white">{currSnapshot.spotPrice >= 1000 ? currSnapshot.spotPrice.toFixed(0) : currSnapshot.spotPrice.toFixed(2)}</b>
            </span>
            <span className="text-[10px] font-mono" style={{ color: '#FFD700' }}>
              ATM: <b className="text-white">{currSnapshot.atmStrike}</b>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Lot: {currSnapshot.lotSize} | Step: {currSnapshot.strikeStep}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Expiry: {currSnapshot.expiry}
            </span>
          </div>

          {/* Strike Flow Grid */}
          <div className="rounded-lg overflow-hidden border" style={{ borderColor: '#333' }}>
            {/* Row 0: Section Headers */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(11, 1fr) 72px repeat(11, 1fr)',
            }}>
              {/* Time col */}
              <div className="p-1 text-[9px] font-bold text-center" style={{ background: COLORS.darkAlt, color: '#eee' }}>
                TIME
              </div>
              {/* CE Section */}
              <div className="col-span-11 p-1 text-[9px] font-bold text-center" style={{ background: '#0f3460', color: COLORS.info }}>
                ← CALL SIDE (CE) — Smart Money Flow per Strike
              </div>
              {/* NET FLOW */}
              <div className="p-1 text-[8px] font-bold text-center" style={{ background: '#0f3460', color: '#FFD700' }}>
                NET<br/>FLOW
              </div>
              {/* PE Section */}
              <div className="col-span-11 p-1 text-[9px] font-bold text-center" style={{ background: '#0f3460', color: COLORS.info }}>
                PUT SIDE (PE) — Smart Money Flow per Strike →
              </div>
            </div>

            {/* Row 1: OTM/ATM/ITM Labels */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(11, 1fr) 72px repeat(11, 1fr)',
            }}>
              <div style={{ background: COLORS.darkAlt }} />
              {CE_CATS.map((cat, i) => (
                <div key={`ce-cat-${i}`} className="p-0.5 text-[8px] font-bold text-center" style={catStyle(cat)}>
                  {cat}
                </div>
              ))}
              <div className="text-[7px] font-bold text-center" style={{ background: '#2C3E50', color: '#FFD700' }}>
                BULL|BEAR
              </div>
              {PE_CATS.map((cat, i) => (
                <div key={`pe-cat-${i}`} className="p-0.5 text-[8px] font-bold text-center" style={catStyle(cat)}>
                  {cat}
                </div>
              ))}
            </div>

            {/* Row 2: Strike Headers */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(11, 1fr) 72px repeat(11, 1fr)',
            }}>
              <div className="p-0.5 text-[7px] font-bold text-center" style={{ background: COLORS.darkAlt, color: '#aaa' }}>
                HH:MM:SS
              </div>
              {CE_OFFSETS.map((off, i) => {
                const strike = currSnapshot.atmStrike + off;
                const label = off === 0 ? `ATM ${strike}` : `ATM${off > 0 ? '+' : ''}${off}`;
                return (
                  <div key={`ce-hdr-${i}`} className="p-0.5 text-[8px] font-bold text-center"
                    style={{
                      background: off === 0 ? '#2C3E50' : COLORS.darkAlt,
                      color: '#fff',
                    }}>
                    {label}<br/><span className="text-[7px] font-normal" style={{ color: COLORS.info }}>CE</span>
                  </div>
                );
              })}
              <div className="p-0.5 text-[7px] font-bold text-center" style={{ background: '#2C3E50', color: '#fff' }}>
                NET (Cr)
              </div>
              {PE_OFFSETS.map((off, i) => {
                const strike = currSnapshot.atmStrike + off;
                const label = off === 0 ? `ATM ${strike}` : `ATM${off > 0 ? '+' : ''}${off}`;
                return (
                  <div key={`pe-hdr-${i}`} className="p-0.5 text-[8px] font-bold text-center"
                    style={{
                      background: off === 0 ? '#2C3E50' : COLORS.darkAlt,
                      color: '#fff',
                    }}>
                    {label}<br/><span className="text-[7px] font-normal" style={{ color: COLORS.info }}>PE</span>
                  </div>
                );
              })}
            </div>

            {/* Row 3: Color Legend */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(11, 1fr) 72px repeat(11, 1fr)',
            }}>
              <div className="p-0.5 text-[7px] font-bold" style={{ background: COLORS.dark, color: COLORS.accent }}>COLOR KEY</div>
              {[0,1,2,3,4,5,6,7,8,9,10].map(i => (
                <div key={`ce-legend-${i}`} className="p-0.5" style={{ background: COLORS.dark }} />
              ))}
              <div style={{ background: COLORS.dark }} />
              {[0,1,2,3,4,5,6,7,8,9,10].map(i => (
                <div key={`pe-legend-${i}`} className="p-0.5" style={{ background: COLORS.dark }} />
              ))}
            </div>

            {/* Legend row rendered separately for clarity */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(24, 1fr)',
            }}>
              <div style={{ background: COLORS.dark }} />
              <div className="p-0.5" style={{ background: COLORS.dark }} />
              <div className="p-1 text-[7px]" style={{ background: COLORS.dark, color: '#eee' }}>CE Wr</div>
              <div className="p-0.5" style={{ background: COLORS.dark }} />
              <div className="p-1 text-[7px]" style={{ background: COLORS.dark, color: '#eee' }}>CE Buy</div>
              <div className="p-0.5" style={{ background: COLORS.dark }} />
              <div className="p-1 text-[7px]" style={{ background: COLORS.dark, color: '#eee' }}>PE Wr</div>
              <div className="p-0.5" style={{ background: COLORS.dark }} />
              <div className="p-1 text-[7px]" style={{ background: COLORS.dark, color: '#eee' }}>PE Buy</div>
              <div className="col-span-17 p-0.5" style={{ background: COLORS.dark }} />
            </div>

            {/* DATA ROW: Flow values */}
            <div className="grid gap-0" style={{
              gridTemplateColumns: '56px repeat(11, 1fr) 72px repeat(11, 1fr)',
            }}>
              {/* Time column */}
              <div className="p-1 text-[9px] font-mono text-center flex items-center justify-center" style={{ background: COLORS.dark, color: COLORS.info }}>
                {lastUpdate}
              </div>

              {/* CE Cells */}
              {CE_OFFSETS.map((off, i) => {
                const cell = getCellByOffset(flowCells, off);
                const isMaxBet = maxBetSide === 'ce' && maxBetIdx === flowCells.indexOf(cell!);
                return (
                  <div
                    key={`ce-cell-${i}`}
                    className={`p-1 text-[9px] font-mono font-bold text-center flex items-center justify-center min-h-[32px] ${
                      isMaxBet ? 'ring-2 ring-black ring-offset-0' : ''
                    }`}
                    style={{
                      background: cellBg(cell?.ceType || 'none', 'ce'),
                      color: cellText(cell?.ceType || 'none', 'ce'),
                      border: isMaxBet ? '2px solid #000' : '0.5px solid #222',
                    }}
                    title={`Strike ${(currSnapshot.atmStrike + off)} CE\nCE Buy: ${cell?.ceBuy.toFixed(2) || 0}\nCE Write: ${cell?.ceWrite.toFixed(2) || 0}`}
                  >
                    {cell?.ceDisplay ? cell.ceDisplay.toFixed(2) : '—'}
                  </div>
                );
              })}

              {/* NET FLOW Column */}
              <div
                className="p-1 text-[10px] font-mono font-bold text-center flex items-center justify-center"
                style={{
                  background: totals.netFlow > 0 ? COLORS.netBull : totals.netFlow < 0 ? COLORS.netBear : COLORS.dark,
                  color: totals.netFlow === 0 ? COLORS.zero : COLORS.netText,
                  borderLeft: '2px solid #444',
                  borderRight: '2px solid #444',
                }}
              >
                {totals.netFlow >= 0 ? '+' : ''}{totals.netFlow.toFixed(2)}
              </div>

              {/* PE Cells */}
              {PE_OFFSETS.map((off, i) => {
                const cell = getCellByOffset(flowCells, off);
                const isMaxBet = maxBetSide === 'pe' && maxBetIdx === flowCells.indexOf(cell!);
                return (
                  <div
                    key={`pe-cell-${i}`}
                    className={`p-1 text-[9px] font-mono font-bold text-center flex items-center justify-center min-h-[32px] ${
                      isMaxBet ? 'ring-2 ring-black ring-offset-0' : ''
                    }`}
                    style={{
                      background: cellBg(cell?.peType || 'none', 'pe'),
                      color: cellText(cell?.peType || 'none', 'pe'),
                      border: isMaxBet ? '2px solid #000' : '0.5px solid #222',
                    }}
                    title={`Strike ${(currSnapshot.atmStrike + off)} PE\nPE Write: ${cell?.peWrite.toFixed(2) || 0}\nPE Buy: ${cell?.peBuy.toFixed(2) || 0}`}
                  >
                    {cell?.peDisplay ? cell.peDisplay.toFixed(2) : '—'}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Full-width Historical Bar Chart */}
      {(flowCells.length > 0 || historicalData.length > 0) && (
        <div className="rounded-lg p-3 border" style={{ borderColor: '#333', background: COLORS.dark }}>
          <h3 className="text-[10px] font-bold mb-2" style={{ color: COLORS.accent }}>
            NET FLOW HISTORY — Intraday 9:15 to 3:40
            {backfillLoading && <span className="ml-2 text-[9px] text-amber-300 animate-pulse">Loading morning data...</span>}
            {!backfillLoading && historicalData.length > 0 && <span className="ml-2 text-[9px]" style={{ color: '#00B050' }}>{historicalData.length} pts from 9:15</span>}
          </h3>
          {(historicalData.length > 0 || flowHistory.length >= 1) ? (
            <HistoricalBarChart />
          ) : (
            <div className="h-10 flex items-center justify-center text-[10px] text-muted-foreground">
              {backfillLoading ? 'Loading historical data from 9:15 AM...' : 'Collecting data points... (need 2 snapshots, 30s intervals)'}
            </div>
          )}
          <div className="flex justify-between items-center mt-2 pt-2 border-t" style={{ borderColor: '#333' }}>
            <span className="text-[9px]" style={{ color: COLORS.info }}>Net Flow (Latest)</span>
            <span className="text-[11px] font-mono font-bold" style={{
              color: totals.netFlow >= 0 ? COLORS.netBull : COLORS.netBear,
            }}>
              {totals.netFlow >= 0 ? '+' : ''}{totals.netFlow.toFixed(2)} Cr
            </span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-[9px]" style={{ color: COLORS.info }}>Intervals Tracked</span>
            <span className="text-[10px] font-mono text-muted-foreground">{historicalData.length + flowHistory.length} total</span>
          </div>
          {(historicalData.length > 0 || flowHistory.length > 0) && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-[9px]" style={{ color: '#FFD700' }}>Cumulative Flow (Day)</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: '#FFD700' }}>
                {(() => {
                  const histCum = historicalData.reduce((s, h) => s + h.netFlow, 0);
                  const liveCum = flowHistory.reduce((s, h) => s + h.netFlow, 0);
                  const cum = histCum + liveCum;
                  return (cum >= 0 ? '+' : '') + cum.toFixed(2) + ' Cr';
                })()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Bottom Section: Totals + Breakup */}
      {flowCells.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Totals */}
          <div className="rounded-lg p-3 border" style={{ borderColor: '#333', background: COLORS.dark }}>
            <h3 className="text-[10px] font-bold mb-2" style={{ color: COLORS.accent }}>
              TOTAL FLOW — All Strikes Combined (Cr)
            </h3>
            <TotalFlowBar />
            <div className="mt-2 pt-2 border-t" style={{ borderColor: '#333' }}>
              <div className="flex justify-between items-center">
                <span className="text-[9px]" style={{ color: COLORS.info }}>Bullish (CE Buy + PE Write)</span>
                <span className="text-[11px] font-mono font-bold" style={{ color: COLORS.ceBuy }}>
                  +{(totals.ceBuy + totals.peWrite).toFixed(2)} Cr
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[9px]" style={{ color: COLORS.info }}>Bearish (CE Write + PE Buy)</span>
                <span className="text-[11px] font-mono font-bold" style={{ color: COLORS.peBuy }}>
                  -{(totals.ceWrite + totals.peBuy).toFixed(2)} Cr
                </span>
              </div>
            </div>
          </div>

          {/* Summary Panel */}
          <div className="rounded-lg p-3 border" style={{ borderColor: '#333', background: COLORS.dark }}>
            <h3 className="text-[10px] font-bold mb-2" style={{ color: COLORS.accent }}>
              SIGNAL SUMMARY
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px]" style={{ color: COLORS.info }}>Max Single Bet</span>
                <span className="text-[10px] font-mono font-bold text-white">
                  {maxBetVal > 0 ? `${maxBetVal.toFixed(2)} Cr @ ${flowCells[maxBetIdx]?.strike}` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px]" style={{ color: COLORS.info }}>Max Bet Side</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: maxBetSide === 'ce' ? COLORS.ceBuy : COLORS.peBuy }}>
                  {maxBetSide ? (maxBetSide === 'ce' ? 'CE' : 'PE') : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px]" style={{ color: COLORS.info }}>CE Buy vs CE Write</span>
                <span className="text-[10px] font-mono">
                  <span style={{ color: COLORS.ceBuy }}>{totals.ceBuy.toFixed(2)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span style={{ color: COLORS.ceWriteText }}>{totals.ceWrite.toFixed(2)}</span>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px]" style={{ color: COLORS.info }}>PE Write vs PE Buy</span>
                <span className="text-[10px] font-mono">
                  <span style={{ color: COLORS.peWriteText }}>{totals.peWrite.toFixed(2)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span style={{ color: COLORS.peBuyText }}>{totals.peBuy.toFixed(2)}</span>
                </span>
              </div>
              <div className="pt-1 border-t" style={{ borderColor: '#333' }}>
                <div className="flex justify-between items-center">
                  <span className="text-[9px]" style={{ color: '#FFD700' }}>Net Signal</span>
                  <span className="text-[11px] font-mono font-bold" style={{
                    color: totals.netFlow >= 0 ? COLORS.netBull : COLORS.netBear,
                  }}>
                    {totals.netFlow >= 0 ? 'BULLISH' : 'BEARISH'} ({totals.netFlow >= 0 ? '+' : ''}{totals.netFlow.toFixed(2)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-Strike Detail Table (collapsed by default concept — shown always for now) */}
      {flowCells.length > 0 && currSnapshot && (
        <div className="rounded-lg overflow-hidden border" style={{ borderColor: '#333' }}>
          <div className="p-2 text-[10px] font-bold" style={{ background: COLORS.darkAlt, color: COLORS.accent }}>
            PER-STRIKE BREAKDOWN
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[9px] font-mono">
              <thead>
                <tr style={{ background: COLORS.darkAlt }}>
                  <th className="p-1 text-left" style={{ color: '#aaa' }}>Strike</th>
                  <th className="p-1 text-right" style={{ color: COLORS.ceBuy }}>CE Buy</th>
                  <th className="p-1 text-right" style={{ color: COLORS.ceWriteText }}>CE Write</th>
                  <th className="p-1 text-right" style={{ color: COLORS.peWriteText }}>PE Write</th>
                  <th className="p-1 text-right" style={{ color: COLORS.peBuyText }}>PE Buy</th>
                  <th className="p-1 text-right" style={{ color: '#aaa' }}>CE OI</th>
                  <th className="p-1 text-right" style={{ color: '#aaa' }}>PE OI</th>
                  <th className="p-1 text-right" style={{ color: '#aaa' }}>CE Vol</th>
                  <th className="p-1 text-right" style={{ color: '#aaa' }}>PE Vol</th>
                </tr>
              </thead>
              <tbody>
                {flowCells.map((cell, idx) => {
                  const strikeData = currSnapshot.strikes.find(s => s.strike === cell.strike);
                  return (
                    <tr key={cell.strike} style={{
                      background: cell.isATM ? '#2C3E50' : idx % 2 === 0 ? COLORS.dark : COLORS.darkAlt,
                    }}>
                      <td className="p-1 font-bold" style={{ color: cell.isATM ? '#FFD700' : '#fff' }}>
                        {cell.strike} {cell.isATM ? '(ATM)' : ''}
                      </td>
                      <td className="p-1 text-right" style={{ color: COLORS.ceBuy }}>{cell.ceBuy.toFixed(2)}</td>
                      <td className="p-1 text-right" style={{ color: COLORS.ceWriteText }}>{cell.ceWrite.toFixed(2)}</td>
                      <td className="p-1 text-right" style={{ color: COLORS.peWriteText }}>{cell.peWrite.toFixed(2)}</td>
                      <td className="p-1 text-right" style={{ color: COLORS.peBuyText }}>{cell.peBuy.toFixed(2)}</td>
                      <td className="p-1 text-right text-muted-foreground">
                        {strikeData?.ceOI?.toLocaleString() || '—'}
                      </td>
                      <td className="p-1 text-right text-muted-foreground">
                        {strikeData?.peOI?.toLocaleString() || '—'}
                      </td>
                      <td className="p-1 text-right text-muted-foreground">
                        {strikeData?.ceVol?.toLocaleString() || '—'}
                      </td>
                      <td className="p-1 text-right text-muted-foreground">
                        {strikeData?.peVol?.toLocaleString() || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}