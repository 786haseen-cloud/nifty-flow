'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, Target, Activity, BarChart3, Wifi, WifiOff, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { INDEX_SPECS, STOCK_SPECS } from '@/lib/kite-api';
import type { StrikeFlowSnapshot, StrikeFlowData } from '@/lib/kite-api';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface OIWallsStrike {
  strike: number;
  isATM: boolean;
  ceOI: number;
  peOI: number;
  ceLTP: number;
  peLTP: number;
  pePct: number;   // % of max OI (for bar width)
  cePct: number;
}

interface ComputedMetrics {
  pcr: number;
  maxPain: number;
  maxPainDist: number;
  totalCEOI: number;
  totalPEOI: number;
  totalOI: number;
  ceOIChange: number;
  peOIChange: number;
}

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const REFRESH_INTERVAL = 30000;
const ALL_SYMBOLS = [
  ...INDEX_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'index' as const })),
  ...STOCK_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'stock' as const })),
];

// Demo base prices per symbol
const DEMO_BASE_PRICES: Record<string, number> = {
  NIFTY: 24350, BANKNIFTY: 52400, SENSEX: 80200, FINNIFTY: 23100,
  RELIANCE: 2950, TCS: 4120, HDFCBANK: 1720, INFY: 1910,
  ICICIBANK: 1285, HINDUNILVR: 2480, SBIN: 825, BHARTIARTL: 1620,
  ITC: 465, KOTAKBANK: 1790, LT: 3580, AXISBANK: 1145,
  BAJFINANCE: 7280, MARUTI: 12450, TATAMOTORS: 960,
};

const DEMO_STRIKE_STEPS: Record<string, number> = {
  NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50,
  RELIANCE: 20, TCS: 20, HDFCBANK: 10, INFY: 20,
  ICICIBANK: 10, HINDUNILVR: 20, SBIN: 5, BHARTIARTL: 10,
  ITC: 5, KOTAKBANK: 10, LT: 20, AXISBANK: 10,
  BAJFINANCE: 50, MARUTI: 50, TATAMOTORS: 10,
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function formatLakhs(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return (n / 100000).toFixed(2) + ' L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-IN');
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-IN');
}

// Compute Max Pain: strike where option buyers lose the most
function computeMaxPain(strikes: StrikeFlowData[]): number {
  if (strikes.length === 0) return 0;
  let minLoss = Infinity;
  let maxPainStrike = strikes[0].strike;

  for (const k of strikes) {
    let totalLoss = 0;
    for (const s of strikes) {
      // CE buyer loses if spot expires at K below the CE strike: CE worthless
      // Actually: CE buyer loss = max(0, K_expiry - S_strike) * CE_OI... no.
      // At expiry price K, CE with strike S > K is worthless → buyer loses premium paid.
      // But we only have OI, not premium. Standard Max Pain uses:
      // CE buyer loss at expiry K = Σ max(0, strike_i - K) * CE_OI_i
      // (CE is ITM and worth (strike - K), but buyer already paid more than intrinsic...)
      // Simplified: use intrinsic value approach
      totalLoss += Math.max(0, s.strike - k.strike) * s.ceOI;
      totalLoss += Math.max(0, k.strike - s.strike) * s.peOI;
    }
    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainStrike = k.strike;
    }
  }
  return maxPainStrike;
}

// Generate demo data for 11 strikes
function generateDemoData(symbol: string): StrikeFlowSnapshot {
  const spot = DEMO_BASE_PRICES[symbol] || 24350;
  const step = DEMO_STRIKE_STEPS[symbol] || 50;
  const atmStrike = Math.round(spot / step) * step;
  const strikes: StrikeFlowData[] = [];

  for (let i = -5; i <= 5; i++) {
    const strike = atmStrike + i * step;
    const dist = Math.abs(i);
    // Heavier OI near ATM, with some randomness
    const baseFactor = Math.max(0.15, 1 - dist * 0.15);
    const noise = 0.6 + Math.random() * 0.8;
    const ceOI = Math.round(800000 * baseFactor * noise * (0.8 + Math.random() * 0.4));
    const peOI = Math.round(700000 * baseFactor * noise * (0.8 + Math.random() * 0.4));
    const moneyness = (spot - strike) / spot;
    const iv = 0.12 + Math.abs(moneyness) * 0.3;
    const ceITM = spot > strike;
    const peITM = spot < strike;

    strikes.push({
      strike,
      isATM: i === 0,
      ceLTP: ceITM ? (spot - strike) + iv * spot * 0.1 : iv * spot * 0.05 * (1 - dist * 0.1),
      peLTP: peITM ? (strike - spot) + iv * spot * 0.1 : iv * spot * 0.05 * (1 - dist * 0.1),
      ceOI,
      peOI,
      ceVol: Math.round(ceOI * (0.02 + Math.random() * 0.08)),
      peVol: Math.round(peOI * (0.02 + Math.random() * 0.08)),
      ceDelta: 0.5 + (i === 0 ? 0 : (spot > strike ? 0.15 : -0.15)),
      peDelta: 0.5 + (i === 0 ? 0 : (spot < strike ? 0.15 : -0.15)),
      ceToken: 100 + i,
      peToken: 200 + i,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    symbol,
    spotPrice: spot + Math.round((Math.random() - 0.5) * step),
    atmStrike,
    lotSize: symbol === 'BANKNIFTY' ? 30 : symbol === 'NIFTY' ? 75 : 1,
    strikeStep: step,
    expiry: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
    strikes,
  };
}

// ═══════════════════════════════════════════
// PCR HISTORY (localStorage)
// ═══════════════════════════════════════════

function getPCRHistoryKey(symbol: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `oi-walls-pcr-history-${today}-${symbol}`;
}

function loadPCRHistory(symbol: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPCRHistoryKey(symbol));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePCRHistory(symbol: string, history: number[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getPCRHistoryKey(symbol), JSON.stringify(history.slice(-60)));
  } catch {
    // localStorage full or unavailable
  }
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

export default function OIWallsTab() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [snapshot, setSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [pcrHistory, setPcrHistory] = useState<number[]>([]);
  const [demoData, setDemoData] = useState<StrikeFlowSnapshot | null>(null);

  const prevSnapshotRef = useRef<StrikeFlowSnapshot | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load PCR history on mount / symbol change
  useEffect(() => {
    setPcrHistory(loadPCRHistory(symbol));
  }, [symbol]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kite/strike-flow?symbol=${symbol}`);
      const data = await res.json();

      if (data.mode !== 'live') {
        // Generate demo data
        setIsLive(false);
        const demo = generateDemoData(symbol);
        setDemoData(demo);
        setLastUpdate(new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }));
        setLoading(false);
        return;
      }

      setIsLive(true);
      setDemoData(null);
      setLastUpdate(new Date(data.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }));

      // Compute OI change before updating ref
      const prev = prevSnapshotRef.current;
      if (prev && prev.symbol === data.symbol) {
        // OI change is computed in metrics; we just need to store prev for diff
      }
      prevSnapshotRef.current = data;
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Initial fetch + polling
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  // Compute OI change using ref to prev snapshot
  const oiChange = (() => {
    const prev = prevSnapshotRef.current;
    const curr = snapshot;
    if (!prev || !curr || prev.symbol !== curr.symbol) {
      // Check demo data diff
      if (demoData) return { ce: 0, pe: 0 };
      return { ce: 0, pe: 0 };
    }
    let ceChange = 0, peChange = 0;
    const prevMap = new Map(prev.strikes.map(s => [s.strike, s]));
    for (const s of curr.strikes) {
      const p = prevMap.get(s.strike);
      if (p) {
        ceChange += s.ceOI - p.ceOI;
        peChange += s.peOI - p.peOI;
      }
    }
    return { ce: ceChange, pe: peChange };
  })();

  // Use demo or live data
  const data = isLive ? snapshot : demoData;

  // Compute walls and metrics
  const { walls, metrics } = (() => {
    if (!data || !data.strikes?.length) {
      return { walls: [] as OIWallsStrike[], metrics: null as ComputedMetrics | null };
    }

    const maxOI = Math.max(
      ...data.strikes.map(s => Math.max(s.ceOI, s.peOI)),
      1
    );

    const walls: OIWallsStrike[] = data.strikes.map(s => ({
      strike: s.strike,
      isATM: s.isATM,
      ceOI: s.ceOI,
      peOI: s.peOI,
      ceLTP: s.ceLTP,
      peLTP: s.peLTP,
      pePct: (s.peOI / maxOI) * 100,
      cePct: (s.ceOI / maxOI) * 100,
    }));

    const totalCEOI = data.strikes.reduce((sum, s) => sum + s.ceOI, 0);
    const totalPEOI = data.strikes.reduce((sum, s) => sum + s.peOI, 0);
    const pcr = totalCEOI > 0 ? totalPEOI / totalCEOI : 0;
    const maxPain = computeMaxPain(data.strikes);
    const maxPainDist = data.spotPrice - maxPain;

    const m: ComputedMetrics = {
      pcr,
      maxPain,
      maxPainDist,
      totalCEOI,
      totalPEOI,
      totalOI: totalCEOI + totalPEOI,
      ceOIChange: oiChange.ce,
      peOIChange: oiChange.pe,
    };

    return { walls, metrics: m };
  })();

  // Append PCR to history when metrics change
  useEffect(() => {
    if (!metrics) return;
    setPcrHistory(prev => {
      const updated = [...prev, metrics.pcr];
      const trimmed = updated.slice(-60);
      savePCRHistory(symbol, trimmed);
      return trimmed;
    });
  }, [isLive ? snapshot?.timestamp : demoData?.timestamp, metrics?.pcr, symbol]);

  // PCR label
  function getPCRLabel(pcr: number): { text: string; color: string } {
    if (pcr >= 1.5) return { text: 'Extreme Bearish', color: 'text-emerald-400' };
    if (pcr >= 1.1) return { text: 'Bearish', color: 'text-emerald-300' };
    if (pcr >= 0.9) return { text: 'Neutral', color: 'text-zinc-400' };
    if (pcr >= 0.6) return { text: 'Bullish', color: 'text-red-400' };
    return { text: 'Extreme Bullish', color: 'text-red-500' };
  }

  // Spot price position (0-100%) within strike range for the dashed line
  const spotPosition = (() => {
    if (!data || walls.length < 2) return 50;
    const minStrike = walls[0].strike;
    const maxStrike = walls[walls.length - 1].strike;
    const range = maxStrike - minStrike;
    if (range === 0) return 50;
    return Math.max(0, Math.min(100, ((data.spotPrice - minStrike) / range) * 100));
  })();

  // ═══════════════════════════════════════════
  // PCR SPARKLINE (SVG)
  // ═══════════════════════════════════════════
  function PCRSparkline() {
    if (pcrHistory.length < 2) {
      return (
        <div className="flex items-center justify-center h-10 text-zinc-600 text-[10px]">
          Waiting for data points...
        </div>
      );
    }

    const w = 280, h = 36;
    const vals = pcrHistory;
    const minV = Math.min(...vals) * 0.95;
    const maxV = Math.max(...vals) * 1.05;
    const rangeV = maxV - minV || 1;
    const step = w / (vals.length - 1);

    const points = vals.map((v, i) => {
      const x = i * step;
      const y = h - 2 - ((v - minV) / rangeV) * (h - 4);
      return `${x},${y}`;
    }).join(' ');

    // PCR = 1 reference line
    const pcr1Y = h - 2 - ((1 - minV) / rangeV) * (h - 4);
    const lastVal = vals[vals.length - 1];
    const lastX = (vals.length - 1) * step;
    const lastY = h - 2 - ((lastVal - minV) / rangeV) * (h - 4);
    const lineColor = lastVal >= 1 ? '#34d399' : '#f87171';

    return (
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        {/* PCR = 1 line */}
        {pcr1Y > 0 && pcr1Y < h && (
          <line x1="0" y1={pcr1Y} x2={w} y2={pcr1Y}
            stroke="#525252" strokeWidth="0.5" strokeDasharray="3,3" />
        )}
        {/* Area fill */}
        <polygon
          points={`0,${h} ${points} ${lastX},${h}`}
          fill={lastVal >= 1 ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)'}
        />
        {/* Line */}
        <polyline points={points} fill="none" stroke={lineColor} strokeWidth="1.5" />
        {/* End dot */}
        <circle cx={lastX} cy={lastY} r="2.5" fill={lineColor} />
      </svg>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* ─── Symbol Selector ─── */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_SYMBOLS.map(s => (
          <button
            key={s.symbol}
            onClick={() => {
              setSymbol(s.symbol);
              setSnapshot(null);
              setDemoData(null);
              prevSnapshotRef.current = null;
            }}
            className={
              `text-[10px] px-2 py-1 rounded border transition-all duration-150 cursor-pointer whitespace-nowrap ` +
              (symbol === s.symbol
                ? 'bg-primary/20 border-primary/50 text-primary-foreground font-semibold'
                : 'bg-card border-border/30 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300')
            }
          >
            {s.symbol}
          </button>
        ))}
      </div>

      {/* ─── Status Bar ─── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLive ? (
            <Badge variant="outline" className="gap-1 text-emerald-400 border-emerald-500/30 bg-emerald-500/5">
              <Wifi className="w-3 h-3" /> LIVE
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-zinc-500 border-zinc-700 bg-zinc-800/50">
              <WifiOff className="w-3 h-3" /> DEMO
            </Badge>
          )}
          {data && (
            <span className="text-[10px] text-zinc-500">
              Expiry: {data.expiry} · Lot: {data.lotSize} · Step: {data.strikeStep}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-zinc-400">
              Spot: <span className="text-foreground font-semibold">{formatNumber(data.spotPrice)}</span>
            </span>
          )}
          {lastUpdate && (
            <span className="text-[10px] text-zinc-600">{lastUpdate}</span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* ─── OI Walls Chart ─── */}
      {data && walls.length > 0 ? (
        <div className="bg-card border border-border/30 rounded-lg p-4">
          {/* Chart header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] text-zinc-500">PE OI (Support)</span>
                <div className="w-3 h-2 rounded-sm bg-emerald-500/40" />
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[10px] text-zinc-500">CE OI (Resistance)</span>
                <div className="w-3 h-2 rounded-sm bg-red-500/40" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] text-zinc-500">Max Pain</span>
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center text-[10px] text-zinc-600 mb-1">
            <div className="w-[60px] text-right pr-2">PE OI</div>
            <div className="w-[60px] text-center">Strike</div>
            <div className="flex-1" />
            <div className="w-[60px] text-left pl-2">CE OI</div>
          </div>

          {/* Strike rows */}
          <div className="relative space-y-px">
            {/* Spot price dashed line overlay */}
            <div
              className="absolute top-0 bottom-0 w-px bg-foreground/30 pointer-events-none z-10"
              style={{ left: `calc(50% + ${((spotPosition - 50) / 100) * 100}%)` }}
            >
              <div className="absolute -top-4 -left-[30px] text-[9px] text-foreground/50 whitespace-nowrap font-medium">
                ▼ {formatNumber(data.spotPrice)}
              </div>
            </div>

            {walls.map(w => {
              const isMaxPain = metrics && w.strike === metrics.maxPain;
              let rowClass = 'rounded px-1 py-1';
              if (isMaxPain) rowClass += ' bg-amber-500/10 border border-amber-500/20';
              else if (w.isATM) rowClass += ' bg-blue-500/10';
              else rowClass += ' hover:bg-zinc-800/40';

              return (
                <div key={w.strike} className={`flex items-center ${rowClass}`}>
                  {/* PE OI bar (extends left) */}
                  <div className="w-[60px] flex justify-end pr-2 items-center">
                    <span className="text-[10px] text-emerald-400/80 relative z-10 mr-1">
                      {w.peOI > 0 ? formatLakhs(w.peOI) : ''}
                    </span>
                    <div
                      className="h-5 bg-emerald-500/40 rounded-r-sm relative"
                      style={{ width: `${Math.max(w.pePct, 0)}%` }}
                    />
                  </div>

                  {/* Strike label */}
                  <div className="w-[60px] text-center shrink-0">
                    <span className={`text-xs font-mono ${w.isATM ? 'text-blue-400 font-bold' : isMaxPain ? 'text-amber-400 font-bold' : 'text-zinc-300'}`}>
                      {w.strike}
                    </span>
                    {w.isATM && (
                      <div className="text-[9px] text-blue-400/60 font-medium">ATM</div>
                    )}
                    {isMaxPain && !w.isATM && (
                      <div className="text-[9px] text-amber-400/60 font-medium">MP</div>
                    )}
                  </div>

                  {/* CE OI bar (extends right) */}
                  <div className="flex-1 flex items-center">
                    <div
                      className="h-5 bg-red-500/40 rounded-l-sm"
                      style={{ width: `${Math.max(w.cePct, 0)}%` }}
                    />
                    <span className="text-[10px] text-red-400/80 relative z-10 ml-1">
                      {w.ceOI > 0 ? formatLakhs(w.ceOI) : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border/30 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            {loading ? (
              <>
                <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin mx-auto mb-2" />
                <p className="text-xs text-zinc-500">Loading OI data...</p>
              </>
            ) : (
              <>
                <BarChart3 className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No data available</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Info Cards ─── */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* PCR Card */}
          <div className="bg-card border border-border/30 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Activity className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">PCR (Put-Call Ratio)</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg font-bold ${metrics.pcr >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                {metrics.pcr.toFixed(3)}
              </span>
              <span className={`text-[10px] ${getPCRLabel(metrics.pcr).color}`}>
                {getPCRLabel(metrics.pcr).text}
              </span>
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-zinc-600">
              <span>PE: {formatLakhs(metrics.totalPEOI)}</span>
              <span>CE: {formatLakhs(metrics.totalCEOI)}</span>
            </div>
          </div>

          {/* Max Pain Card */}
          <div className="bg-card border border-border/30 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Target className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Max Pain</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-amber-400">
                {formatNumber(metrics.maxPain)}
              </span>
              {metrics.maxPainDist !== 0 && (
                <span className={`text-[10px] flex items-center gap-0.5 ${metrics.maxPainDist > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.maxPainDist > 0 ? (
                    <><TrendingUp className="w-3 h-3" />+{Math.abs(metrics.maxPainDist)} pts above</>
                  ) : (
                    <><TrendingDown className="w-3 h-3" />{Math.abs(metrics.maxPainDist)} pts below</>
                  )}
                </span>
              )}
            </div>
            <div className="mt-2 text-[10px] text-zinc-600">
              Spot: {formatNumber(data?.spotPrice || 0)}
            </div>
          </div>

          {/* OI Change Card */}
          <div className="bg-card border border-border/30 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">OI Change</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-red-400">CE Δ</span>
                <span className={`text-xs font-semibold ${metrics.ceOIChange >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {metrics.ceOIChange >= 0 ? '+' : ''}{formatLakhs(metrics.ceOIChange)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-emerald-400">PE Δ</span>
                <span className={`text-xs font-semibold ${metrics.peOIChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.peOIChange >= 0 ? '+' : ''}{formatLakhs(metrics.peOIChange)}
                </span>
              </div>
              <div className="border-t border-border/20 pt-1 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500">Net Δ</span>
                <span className={`text-xs font-bold ${metrics.peOIChange - metrics.ceOIChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.peOIChange - metrics.ceOIChange >= 0 ? '+' : ''}{formatLakhs(metrics.peOIChange - metrics.ceOIChange)}
                </span>
              </div>
            </div>
          </div>

          {/* Total OI Card */}
          <div className="bg-card border border-border/30 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldAlert className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Total OI</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-foreground">
                {formatLakhs(metrics.totalOI)}
              </span>
              <span className="text-[10px] text-zinc-600">Lakhs</span>
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-zinc-600">
              <span className="text-red-400/70">CE: {formatLakhs(metrics.totalCEOI)}</span>
              <span className="text-emerald-400/70">PE: {formatLakhs(metrics.totalPEOI)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── PCR History Sparkline ─── */}
      <div className="bg-card border border-border/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">PCR History (Today)</span>
          </div>
          {pcrHistory.length > 0 && (
            <span className={`text-xs font-semibold ${pcrHistory[pcrHistory.length - 1] >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pcrHistory[pcrHistory.length - 1].toFixed(3)}
            </span>
          )}
        </div>
        <PCRSparkline />
        <div className="flex justify-between mt-1 text-[9px] text-zinc-600">
          <span>PCR &lt; 1 = Bullish</span>
          <span>PCR = 1.0 (dashed)</span>
          <span>PCR &gt; 1 = Bearish</span>
        </div>
      </div>
    </div>
  );
}
