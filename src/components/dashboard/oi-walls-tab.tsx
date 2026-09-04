'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { withCreds } from '@/lib/kite-creds';
import { Target, Activity, BarChart3, Wifi, WifiOff, RefreshCw, TrendingUp, TrendingDown, Gauge } from 'lucide-react';
import { INDEX_SPECS, STOCK_SPECS, getInstrumentSpec } from '@/lib/kite-api';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import type { StrikeFlowSnapshot, StrikeFlowData } from '@/lib/kite-api';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

/**
 * 4-Color OI classification (matches Strike Flow Map convention):
 *
 *  CE  Buy   = ΔOI>0 & ΔLTP≥0  → bright green  #00B050
 *  CE  Write = ΔOI>0 & ΔLTP<0  → light red     #FFCCCC (dark red border)
 *  CE  Close = ΔOI<0           → grey          #6b7280
 *  PE  Write = ΔOI>0 & ΔLTP≥0  → light green   #C6EFCE (dark green border)
 *  PE  Buy   = ΔOI>0 & ΔLTP<0  → bright red    #BD2130
 *  PE  Close = ΔOI<0           → grey          #6b7280
 */
type OIColor = {
  bg: string;        // inline background color
  border?: string;   // inline border color (for Write classes)
  text: string;      // tailwind text class for the OI label
  label?: string;    // short label: "Buy", "Write", "Close"
};

function getOIColor(oiChange: number, ltpChange: number, isPE: boolean): OIColor {
  // No previous data — neutral
  if (oiChange === 0 && ltpChange === 0) {
    return { bg: '#3f3f46', text: 'text-zinc-400/80' };
  }
  // Unwinding / short covering (ΔOI < 0)
  if (oiChange < 0) {
    return { bg: '#6b7280', text: 'text-zinc-400', label: 'Close' };
  }
  // oiChange >= 0 — new positions opened (or no change)
  if (isPE) {
    // PE: Write = bullish (price up/stable + OI up), Buy = bearish (price down + OI up)
    if (ltpChange >= 0) return { bg: '#C6EFCE', border: '#16a34a', text: 'text-emerald-700', label: 'Write' };
    if (ltpChange < 0)  return { bg: '#BD2130', text: 'text-red-100', label: 'Buy' };
  } else {
    // CE: Buy = bullish (price up/stable + OI up), Write = bearish (price down + OI up)
    if (ltpChange >= 0) return { bg: '#00B050', text: 'text-green-100', label: 'Buy' };
    if (ltpChange < 0)  return { bg: '#FFCCCC', border: '#dc2626', text: 'text-red-700', label: 'Write' };
  }
  // Fallback (shouldn't reach here)
  return { bg: '#3f3f46', text: 'text-zinc-400/80' };
}

interface OIWallsStrike {
  strike: number;
  isATM: boolean;
  isCeITM: boolean;  // strike < ATM → CE is in-the-money
  isPeITM: boolean;  // strike > ATM → PE is in-the-money
  ceOI: number;
  peOI: number;
  ceLTP: number;
  peLTP: number;
  cePct: number;     // % of max OI (for bar width)
  pePct: number;
  ceOiChange: number; // per-strike ΔOI for badge
  peOiChange: number;
  ceColor: OIColor;  // 4-color classification
  peColor: OIColor;
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

interface MaxPainScanItem {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spot: number;
  maxPain: number;
  dist: number;
  distPct: number;
  totalCEOI: number;
  totalPEOI: number;
}

interface GravitySignal {
  indicesAbove: number;
  indicesBelow: number;
  indicesTotal: number;
  stocksAbove: number;
  stocksBelow: number;
  stocksTotal: number;
  avgIndexDistPct: number;
  avgStockDistPct: number;
  direction: 'down' | 'up' | 'mixed'; // gravity pulls DOWN (spot above MP) or UP (spot below MP)
  strength: 'strong' | 'moderate' | 'weak' | 'divergent';
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

// Compute Max Pain: strike K where total SELLER payout is minimum (= buyers hurt the most)
// Seller payout at expiry K:
//   CE: seller pays max(0, K - S) × CE_OI  (CE ITM when K > strike)
//   PE: seller pays max(0, S - K) × PE_OI  (PE ITM when K < strike)
function computeMaxPain(strikes: StrikeFlowData[]): number {
  if (strikes.length === 0) return 0;
  let minPayout = Infinity;
  let maxPainStrike = strikes[0].strike;

  for (const k of strikes) {
    let totalPayout = 0;
    for (const s of strikes) {
      // CE seller pays when expiry K > strike S
      totalPayout += Math.max(0, k.strike - s.strike) * s.ceOI;
      // PE seller pays when expiry K < strike S
      totalPayout += Math.max(0, s.strike - k.strike) * s.peOI;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      maxPainStrike = k.strike;
    }
  }
  return maxPainStrike;
}

// Generate demo data for 9 strikes
function generateDemoData(symbol: string, prev?: StrikeFlowSnapshot | null): StrikeFlowSnapshot {
  const spot = DEMO_BASE_PRICES[symbol] || 24350;
  const step = DEMO_STRIKE_STEPS[symbol] || 50;
  const atmStrike = Math.round(spot / step) * step;

  // If we have a previous snapshot, apply small perturbations to it.
  // This produces realistic per-strike ΔOI and ΔLTP values that
  // feed into the 4-color OI coding (Buy/Write/Close).
  if (prev && prev.strikes.length === 9) {
    const spotJitter = Math.round((Math.random() - 0.5) * step * 0.3);
    const newSpot = prev.spotPrice + spotJitter;
    const newAtm = Math.round(newSpot / step) * step;

    const strikes: StrikeFlowData[] = prev.strikes.map((s, idx) => {
      // OI change: random walk — some strikes gain, some lose
      const oiDelta = Math.round((Math.random() - 0.45) * s.ceOI * 0.04);
      const peOiDelta = Math.round((Math.random() - 0.45) * s.peOI * 0.04);

      // LTP change based on spot movement + moneyness
      const ceMoneyness = (newSpot - s.strike) / newSpot;
      const peMoneyness = (s.strike - newSpot) / newSpot;
      const iv = 0.12 + Math.abs(ceMoneyness) * 0.3;
      const ceLTPDelta = spotJitter > 0
        ? iv * Math.abs(spotJitter) * (0.3 + Math.random() * 0.3)
        : -iv * Math.abs(spotJitter) * (0.2 + Math.random() * 0.3);
      const peLTPDelta = -ceLTPDelta * 0.8;

      const ceITM = newSpot > s.strike;
      const peITM = newSpot < s.strike;

      return {
        ...s,
        ceLTP: Math.max(0.5, s.ceLTP + ceLTPDelta),
        peLTP: Math.max(0.5, s.peLTP + peLTPDelta),
        ceOI: Math.max(1000, s.ceOI + oiDelta),
        peOI: Math.max(1000, s.peOI + peOiDelta),
        isATM: s.strike === newAtm,
        ceVol: Math.round(Math.abs(oiDelta) * (1 + Math.random())),
        peVol: Math.round(Math.abs(peOiDelta) * (1 + Math.random())),
      };
    });

    return {
      timestamp: new Date().toISOString(),
      symbol,
      spotPrice: newSpot,
      atmStrike: newAtm,
      lotSize: prev.lotSize,
      strikeStep: step,
      expiry: prev.expiry,
      strikes,
    };
  }

  // First call (no prev) — generate from scratch with random initial values
  const strikes: StrikeFlowData[] = [];

  for (let i = -4; i <= 4; i++) {
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
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [pcrHistory, setPcrHistory] = useState<number[]>([]);
  const [demoData, setDemoData] = useState<StrikeFlowSnapshot | null>(null);
  const [scanData, setScanData] = useState<MaxPainScanItem[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [gravitySignal, setGravitySignal] = useState<GravitySignal | null>(null);
  // Pre-computed per-strike deltas (computed in fetchData, read during render)
  // Pre-computed per-strike deltas — 30s realtime
  const [strikeDeltas, setStrikeDeltas] = useState<Map<number, { ceOi: number; peOi: number; ceLtp: number; peLtp: number }>>(new Map());
  // Pre-computed per-strike deltas — cumulative since open (first poll baseline)
  const [cumulativeDeltas, setCumulativeDeltas] = useState<Map<number, { ceOi: number; peOi: number; ceLtp: number; peLtp: number }>>(new Map());
  // View mode: 'sinceOpen' (cumulative from first poll) or 'realtime' (30s delta)
  const [deltaMode, setDeltaMode] = useState<'sinceOpen' | 'realtime'>('sinceOpen');

  const prevSnapshotRef = useRef<StrikeFlowSnapshot | null>(null);
  const openingSnapshotRef = useRef<Map<string, StrikeFlowSnapshot>>(new Map());

  // Load PCR history on mount / symbol change
  useEffect(() => {
    setPcrHistory(loadPCRHistory(symbol));
  }, [symbol]);

  // Helper: compute deltas between two snapshots
  function computeDeltas(newData: StrikeFlowSnapshot, baseData: StrikeFlowSnapshot): Map<number, { ceOi: number; peOi: number; ceLtp: number; peLtp: number }> {
    const baseMap = new Map(baseData.strikes.map(s => [s.strike, s]));
    const d = new Map<number, { ceOi: number; peOi: number; ceLtp: number; peLtp: number }>();
    for (const s of newData.strikes) {
      const b = baseMap.get(s.strike);
      if (b) d.set(s.strike, { ceOi: s.ceOI - b.ceOI, peOi: s.peOI - b.peOI, ceLtp: s.ceLTP - b.ceLTP, peLtp: s.peLTP - b.peLTP });
    }
    return d;
  }

  // Use singleton for per-strike data (eliminates /api/kite/strike-flow duplicate)
  const { curr: singletonCurr, prev: singletonPrev } = useKiteSnapshot(30000);


  // Extract StrikeFlowSnapshot for selected symbol from singleton
  useEffect(() => {
    if (!singletonCurr) return;

    if (singletonCurr.mode === 'demo' || singletonCurr.mode === 'error') {
      const prev = prevSnapshotRef.current;
      const demo = generateDemoData(symbol, prev);
      if (prev && prev.strikes) {
        setStrikeDeltas(computeDeltas(demo, prev));
      } else {
        setStrikeDeltas(new Map());
      }
      const openings = openingSnapshotRef.current;
      if (!openings.has(symbol)) openings.set(symbol, demo);
      setCumulativeDeltas(computeDeltas(demo, openings.get(symbol)!));
      prevSnapshotRef.current = demo;
      setIsLive(false);
      setDemoData(demo);
      setSnapshot(null);
      setLastUpdate(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
      return;
    }

    const symData = singletonCurr.symbols.find(s => s.symbol === symbol);
    if (!symData || symData.strikes.length === 0) return;

    const spec = getInstrumentSpec(symbol);
    const atmStrike = Math.round(symData.spotPrice / symData.strikeStep) * symData.strikeStep;

    const data: StrikeFlowSnapshot = {
      timestamp: singletonCurr.timestamp,
      symbol: symData.symbol,
      spotPrice: symData.spotPrice,
      atmStrike,
      lotSize: symData.lotSize,
      strikeStep: symData.strikeStep,
      expiry: '',  // not in singleton, but not used for core logic
      strikes: symData.strikes.map(s => ({
        strike: s.strike,
        isATM: s.strike === atmStrike,
        ceLTP: s.ceLTP,
        peLTP: s.peLTP,
        ceOI: s.ceOI,
        peOI: s.peOI,
        ceVol: s.ceVol,
        peVol: s.peVol,
        ceDelta: s.ceDelta,
        peDelta: s.peDelta,
        ceToken: s.ceToken,
        peToken: s.peToken,
      })),
    };

    setIsLive(true);
    setDemoData(null);
    setSnapshot(data);
    setLastUpdate(new Date(data.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));

    const prev = prevSnapshotRef.current;
    if (prev && prev.symbol === data.symbol && prev.strikes) {
      setStrikeDeltas(computeDeltas(data, prev));
    } else {
      setStrikeDeltas(new Map());
    }
    const openings = openingSnapshotRef.current;
    if (!openings.has(symbol)) openings.set(symbol, data);
    setCumulativeDeltas(computeDeltas(data, openings.get(symbol)!));
    prevSnapshotRef.current = data;
  }, [singletonCurr?.timestamp, symbol]);

  // Fetch max pain scan for all symbols (longer interval — 120s)
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fetchScan = useCallback(async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await fetch(withCreds('/api/kite/max-pain-scan'));
      const json = await res.json();

      if (json.mode === 'live' && json.symbols?.length > 0) {
        const items: MaxPainScanItem[] = json.symbols;
        setScanData(items);

        // Compute gravity signal — works BOTH directions
        const indices = items.filter(s => s.type === 'index');
        const stocks = items.filter(s => s.type === 'stock');
        const indicesAbove = indices.filter(s => s.dist > 0).length;
        const indicesBelow = indices.filter(s => s.dist < 0).length;
        const stocksAbove = stocks.filter(s => s.dist > 0).length;
        const stocksBelow = stocks.filter(s => s.dist < 0).length;
        const avgIdxDist = indices.length > 0 ? indices.reduce((s, i) => s + i.distPct, 0) / indices.length : 0;
        const avgStkDist = stocks.length > 0 ? stocks.reduce((s, i) => s + i.distPct, 0) / stocks.length : 0;

        // Determine direction: which side has more index alignment?
        let direction: GravitySignal['direction'] = 'mixed';
        if (indicesAbove > indicesBelow) direction = 'down';   // spot above MP → gravity pulls DOWN
        else if (indicesBelow > indicesAbove) direction = 'up'; // spot below MP → gravity pulls UP

        // Determine aligned count (whichever direction is dominant)
        const alignedIndices = Math.max(indicesAbove, indicesBelow);
        const alignedStocks = direction === 'down' ? stocksAbove : stocksBelow;
        const stockAvgConfirms = direction === 'down' ? avgStkDist > 0.1 : avgStkDist < -0.1;

        let strength: GravitySignal['strength'] = 'divergent';
        if (alignedIndices === 4 && stockAvgConfirms) {
          strength = 'strong';
        } else if (alignedIndices >= 3 && stockAvgConfirms) {
          strength = 'moderate';
        } else if (alignedIndices >= 2 && direction !== 'mixed') {
          strength = 'weak';
        }

        setGravitySignal({
          indicesAbove,
          indicesBelow,
          indicesTotal: indices.length,
          stocksAbove,
          stocksBelow,
          stocksTotal: stocks.length,
          avgIndexDistPct: avgIdxDist,
          avgStockDistPct: avgStkDist,
          direction,
          strength,
        });
      } else if (json.mode === 'demo') {
        setScanData([]);
        setGravitySignal(null);
      } else if (json.error) {
        setScanError(json.error);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScan();
    scanIntervalRef.current = setInterval(fetchScan, 120000); // every 2 min
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, [fetchScan]);

  // Use demo or live data
  const data = isLive ? snapshot : demoData;

  // Compute OI change totals — supports both realtime and cumulative modes
  const getOIChangeTotals = (mode: 'sinceOpen' | 'realtime') => {
    if (!data || !data.strikes) return { ce: 0, pe: 0 };
    const activeDeltas = mode === 'sinceOpen' ? cumulativeDeltas : strikeDeltas;
    let ceChange = 0, peChange = 0;
    for (const [_, d] of activeDeltas) {
      ceChange += d.ceOi;
      peChange += d.peOi;
    }
    return { ce: ceChange, pe: peChange };
  };
  const oiChange = getOIChangeTotals(deltaMode);

  // Compute walls and metrics
  const { walls, metrics } = (() => {
    if (!data || !data.strikes?.length) {
      return { walls: [] as OIWallsStrike[], metrics: null as ComputedMetrics | null };
    }

    const maxOI = Math.max(
      ...data.strikes.map(s => Math.max(s.ceOI, s.peOI)),
      1
    );

    // Find ATM strike for ITM determination
    const atmStrike = data.atmStrike || data.strikes.find(s => s.isATM)?.strike || 0;

    const walls: OIWallsStrike[] = data.strikes.map(s => {
      // Choose delta source based on mode
      const activeDeltas = deltaMode === 'sinceOpen' ? cumulativeDeltas : strikeDeltas;
      let ceOiChg = 0, peOiChg = 0, ceLtpChg = 0, peLtpChg = 0;
      const d = activeDeltas.get(s.strike);
      if (d) {
        ceOiChg = d.ceOi;
        peOiChg = d.peOi;
        ceLtpChg = d.ceLtp;
        peLtpChg = d.peLtp;
      } else {
        // FIRST-POLL HEURISTIC: No deltas yet (first load).
        // Infer activity from OI concentration patterns.
        const avgCeOI = data.strikes.reduce((sum, x) => sum + x.ceOI, 0) / data.strikes.length;
        const avgPeOI = data.strikes.reduce((sum, x) => sum + x.peOI, 0) / data.strikes.length;
        const ceRatio = s.ceOI / avgCeOI;
        ceOiChg = ceRatio > 1.1 ? Math.round(s.ceOI * 0.02)
                   : ceRatio < 0.7 ? -Math.round(s.ceOI * 0.01)
                   : Math.round(s.ceOI * 0.005);
        const peRatio = s.peOI / avgPeOI;
        peOiChg = peRatio > 1.1 ? Math.round(s.peOI * 0.02)
                   : peRatio < 0.7 ? -Math.round(s.peOI * 0.01)
                   : Math.round(s.peOI * 0.005);
        ceLtpChg = s.ceLTP * 0.002 * (Math.random() - 0.3);
        peLtpChg = s.peLTP * 0.002 * (Math.random() - 0.7);
      }

      return {
        strike: s.strike,
        isATM: s.isATM,
        isCeITM: !s.isATM && s.strike < atmStrike,
        isPeITM: !s.isATM && s.strike > atmStrike,
        ceOI: s.ceOI,
        peOI: s.peOI,
        ceLTP: s.ceLTP,
        peLTP: s.peLTP,
        cePct: (s.ceOI / maxOI) * 100,
        pePct: (s.peOI / maxOI) * 100,
        ceOiChange: ceOiChg,
        peOiChange: peOiChg,
        ceColor: getOIColor(ceOiChg, ceLtpChg, false),
        peColor: getOIColor(peOiChg, peLtpChg, true),
      };
    });

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
            onClick={() => window.location.reload()}
            className="p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* ─── OI Walls Chart ─── */}
      {data && walls.length > 0 ? (
        <div className="bg-card border border-border/30 rounded-lg p-4">
          {/* Chart header — 4-color legend + mode toggle */}
          <div className="flex items-center justify-between mb-2 flex-wrap gap-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-zinc-500 font-medium">CE OI (LEFT)</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#00B050' }} />
                <span className="text-[9px] text-zinc-500">Buy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#FFCCCC', borderRight: '2px solid #dc2626' }} />
                <span className="text-[9px] text-zinc-500">Write</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#6b7280' }} />
                <span className="text-[9px] text-zinc-500">Close</span>
              </div>
              <span className="text-zinc-700">|</span>
              <span className="text-[10px] text-zinc-500 font-medium">PE OI (RIGHT)</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#C6EFCE', borderLeft: '2px solid #16a34a' }} />
                <span className="text-[9px] text-zinc-500">Write</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#BD2130' }} />
                <span className="text-[9px] text-zinc-500">Buy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: '#6b7280' }} />
                <span className="text-[9px] text-zinc-500">Close</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Delta mode toggle */}
              <div className="flex items-center bg-zinc-900/80 border border-border/30 rounded-md p-0.5">
                <button
                  onClick={() => setDeltaMode('sinceOpen')}
                  className={[
                    'text-[9px] px-2 py-0.5 rounded-sm transition-all cursor-pointer',
                    deltaMode === 'sinceOpen'
                      ? 'bg-primary/20 text-primary-foreground font-semibold'
                      : 'text-zinc-500 hover:text-zinc-300'
                  ].join(' ')}
                >
                  Since Open
                </button>
                <button
                  onClick={() => setDeltaMode('realtime')}
                  className={[
                    'text-[9px] px-2 py-0.5 rounded-sm transition-all cursor-pointer',
                    deltaMode === 'realtime'
                      ? 'bg-primary/20 text-primary-foreground font-semibold'
                      : 'text-zinc-500 hover:text-zinc-300'
                  ].join(' ')}
                >
                  Real-time 30s
                </button>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500/[0.06] border border-emerald-500/20" />
                <span className="text-[9px] text-zinc-600">ITM</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Target className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-zinc-500">Max Pain</span>
              </div>
            </div>
          </div>

          {/* Column headers — CE LEFT, Strike CENTER, PE RIGHT */}
          <div className="flex items-center text-[10px] text-zinc-600 mb-1">
            <div className="flex-1 text-right pr-2">CE OI</div>
            <div className="w-[70px] text-center">Strike</div>
            <div className="flex-1 text-left pl-2">PE OI</div>
          </div>

          {/* Strike rows — CE extends LEFT, PE extends RIGHT, strike CENTER */}
          <div className="relative space-y-px">
            {/* Spot price dashed line overlay — positioned at 50% (center) */}
            <div
              className="absolute top-0 bottom-0 w-px bg-foreground/30 pointer-events-none z-10"
              style={{ left: '50%' }}
            >
              <div className="absolute -top-4 -left-[30px] text-[9px] text-foreground/50 whitespace-nowrap font-medium">
                ▼ {formatNumber(data.spotPrice)}
              </div>
            </div>

            {walls.map(w => {
              const isMaxPain = metrics && w.strike === metrics.maxPain;

              return (
                <div key={w.strike} className="flex items-center rounded px-1 py-1 relative">
                  {/* ITM background tints — split left/right */}
                  {w.isCeITM && (
                    <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-emerald-500/[0.05] rounded-l pointer-events-none" />
                  )}
                  {w.isPeITM && (
                    <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-red-500/[0.05] rounded-r pointer-events-none" />
                  )}
                  {w.isATM && (
                    <div className="absolute inset-0 bg-blue-500/10 pointer-events-none rounded" />
                  )}
                  {isMaxPain && !w.isATM && (
                    <div className="absolute inset-0 bg-amber-500/10 border border-amber-500/20 pointer-events-none rounded" />
                  )}

                  {/* CE OI bar (extends LEFT from center) — 4-color */}
                  <div className="flex-1 flex justify-end items-center pr-2 relative z-[1]">
                    <span className={`text-[10px] relative z-10 mr-1.5 ${w.ceColor.text}`} title={w.ceColor.label}>
                      {w.ceOI > 0 ? formatLakhs(w.ceOI) : ''}
                    </span>
                    <div
                      className="h-5 rounded-r-sm relative overflow-hidden"
                      style={{
                        width: `${Math.max(w.cePct, 0)}%`,
                        backgroundColor: w.ceColor.bg,
                        borderRight: w.ceColor.border ? `2px solid ${w.ceColor.border}` : undefined,
                      }}
                      title={w.ceColor.label}
                    >
                      {w.cePct > 12 && w.ceOiChange !== 0 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold pointer-events-none"
                          style={{ color: w.ceColor.border || w.ceColor.bg }}>
                          {w.ceOiChange > 0 ? '+' : ''}{formatLakhs(w.ceOiChange)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Strike label (CENTER) */}
                  <div className="w-[70px] text-center shrink-0 relative z-[1]">
                    <span className={`text-xs font-mono ${w.isATM ? 'text-blue-400 font-bold' : isMaxPain ? 'text-amber-400 font-bold' : 'text-zinc-300'}`}>
                      {w.strike}
                    </span>
                    {w.isATM && (
                      <div className="text-[9px] text-blue-400/60 font-medium">ATM</div>
                    )}
                    {isMaxPain && !w.isATM && (
                      <div className="text-[9px] text-amber-400/60 font-medium">MP</div>
                    )}
                    {/* ITM labels */}
                    {w.isCeITM && !w.isATM && (
                      <div className="text-[8px] text-emerald-500/40 leading-none">ITM</div>
                    )}
                    {w.isPeITM && !w.isATM && (
                      <div className="text-[8px] text-red-500/40 leading-none">ITM</div>
                    )}
                  </div>

                  {/* PE OI bar (extends RIGHT from center) — 4-color */}
                  <div className="flex-1 flex items-center pl-2 relative z-[1]">
                    <div
                      className="h-5 rounded-l-sm relative overflow-hidden"
                      style={{
                        width: `${Math.max(w.pePct, 0)}%`,
                        backgroundColor: w.peColor.bg,
                        borderLeft: w.peColor.border ? `2px solid ${w.peColor.border}` : undefined,
                      }}
                      title={w.peColor.label}
                    >
                      {w.pePct > 12 && w.peOiChange !== 0 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold pointer-events-none"
                          style={{ color: w.peColor.border || w.peColor.bg }}>
                          {w.peOiChange > 0 ? '+' : ''}{formatLakhs(w.peOiChange)}
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] relative z-10 ml-1.5 ${w.peColor.text}`} title={w.peColor.label}>
                      {w.peOI > 0 ? formatLakhs(w.peOI) : ''}
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
            <>
                <BarChart3 className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No data available</p>
            </>
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
              <span className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-border/20">
                {deltaMode === 'sinceOpen' ? 'SINCE OPEN' : '30s DELTA'}
              </span>
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
              <Activity className="w-3.5 h-3.5 text-zinc-500" />
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

      {/* ─── Max Pain Gravity Meter ─── */}
      <div className="bg-card border border-border/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Max Pain Gravity Meter</span>
          </div>
          <div className="flex items-center gap-2">
            {scanLoading && <RefreshCw className="w-3 h-3 text-zinc-600 animate-spin" />}
            <button
              onClick={fetchScan}
              disabled={scanLoading}
              className="p-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 text-zinc-500 ${scanLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {scanError && (
          <div className="text-[10px] text-red-400/80 mb-2">Scan error: {scanError}</div>
        )}

        {gravitySignal ? (
          <>
            {/* Gauge visualization */}
            <div className="flex items-center gap-4 mb-4">
              {/* Strength + Direction indicator */}
              <div className="flex-shrink-0 w-16 h-16 rounded-full border-2 flex items-center justify-center relative"
                style={{
                  borderColor: gravitySignal.strength === 'strong' ? '#22c55e'
                    : gravitySignal.strength === 'moderate' ? '#eab308'
                    : gravitySignal.strength === 'weak' ? '#f97316'
                    : '#ef4444',
                }}
              >
                <div className="text-center">
                  <div className="text-[9px] text-zinc-500 leading-none">Signal</div>
                  <div className={`text-xs font-bold mt-0.5 ${
                    gravitySignal.strength === 'strong' ? 'text-emerald-400'
                    : gravitySignal.strength === 'moderate' ? 'text-yellow-400'
                    : gravitySignal.strength === 'weak' ? 'text-orange-400'
                    : 'text-red-400'
                  }`}>
                    {gravitySignal.strength === 'strong' ? 'STRONG' : gravitySignal.strength.toUpperCase().slice(0, 4)}
                  </div>
                  <div className={`text-[8px] mt-0.5 ${gravitySignal.direction === 'down' ? 'text-red-400' : gravitySignal.direction === 'up' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {gravitySignal.direction === 'down' ? '▼ PULL DN' : gravitySignal.direction === 'up' ? '▲ PULL UP' : '— MIXED'}
                  </div>
                </div>
              </div>

              {/* Index + Stock summary — direction-aware */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">
                    Indices {gravitySignal.direction === 'down' ? 'above' : gravitySignal.direction === 'up' ? 'below' : 'above'} MP
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {gravitySignal.direction === 'up' ? gravitySignal.indicesBelow : gravitySignal.indicesAbove}<span className="text-zinc-600 font-normal">/{gravitySignal.indicesTotal}</span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${((gravitySignal.direction === 'up' ? gravitySignal.indicesBelow : gravitySignal.indicesAbove) / gravitySignal.indicesTotal) * 100}%`,
                      backgroundColor: gravitySignal.strength === 'strong' ? '#22c55e'
                        : gravitySignal.strength === 'moderate' ? '#eab308'
                        : gravitySignal.strength === 'weak' ? '#f97316' : '#ef4444',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">
                    Stocks {gravitySignal.direction === 'down' ? 'above' : gravitySignal.direction === 'up' ? 'below' : 'above'} MP
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {gravitySignal.direction === 'up' ? gravitySignal.stocksBelow : gravitySignal.stocksAbove}<span className="text-zinc-600 font-normal">/{gravitySignal.stocksTotal}</span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${gravitySignal.stocksTotal > 0 ? ((gravitySignal.direction === 'up' ? gravitySignal.stocksBelow : gravitySignal.stocksAbove) / gravitySignal.stocksTotal) * 100 : 0}%`,
                      backgroundColor: gravitySignal.strength === 'strong' ? '#22c55e'
                        : gravitySignal.strength === 'moderate' ? '#eab308'
                        : gravitySignal.strength === 'weak' ? '#f97316' : '#ef4444',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Thesis callout — direction-aware */}
            {gravitySignal.strength === 'strong' && (
              <div className={`rounded-md px-3 py-2 mb-3 ${
                gravitySignal.direction === 'down'
                  ? 'bg-red-500/10 border border-red-500/20'
                  : 'bg-emerald-500/10 border border-emerald-500/20'
              }`}>
                <div className="flex items-start gap-1.5">
                  {gravitySignal.direction === 'down' ? (
                    <TrendingDown className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <TrendingUp className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                  )}
                  <p className={`text-[10px] leading-relaxed ${
                    gravitySignal.direction === 'down' ? 'text-red-300/90' : 'text-emerald-300/90'
                  }`}>
                    <span className="font-semibold">
                      {gravitySignal.direction === 'down' ? 'Gravity Pull DOWN' : 'Gravity Pull UP'}
                    </span> — All {gravitySignal.indicesTotal} indices {gravitySignal.direction === 'down' ? 'above' : 'below'} max pain + stock avg confirms.
                    Big money may pull market <span className="font-semibold">
                      {gravitySignal.direction === 'down' ? 'down toward' : 'up toward'} average max pain
                    </span> of all indices.
                    Watch for Mean Reversion after 2 PM on expiry day.
                  </p>
                </div>
              </div>
            )}

            {/* Breakdown Table */}
            <div className="border border-border/20 rounded-md overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_72px_72px_60px_48px] gap-0 bg-zinc-900/50 px-3 py-1.5 text-[9px] text-zinc-500 uppercase tracking-wider">
                <span>Symbol</span>
                <span className="text-right">Spot</span>
                <span className="text-right">Max Pain</span>
                <span className="text-right">Diff</span>
                <span className="text-right">PCR</span>
              </div>

              {/* Index rows */}
              {scanData.filter(s => s.type === 'index').map(s => (
                <div key={s.symbol} className="grid grid-cols-[1fr_72px_72px_60px_48px] gap-0 px-3 py-1.5 border-t border-border/10 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                      backgroundColor: s.dist > 0 ? '#22c55e' : '#ef4444',
                    }} />
                    <span className="text-[11px] font-semibold text-foreground truncate">{s.symbol}</span>
                  </div>
                  <span className="text-[10px] text-zinc-300 text-right font-mono">{formatNumber(Math.round(s.spot))}</span>
                  <span className="text-[10px] text-amber-400 text-right font-mono">{formatNumber(s.maxPain)}</span>
                  <span className={`text-[10px] text-right font-mono font-semibold ${s.dist > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.dist > 0 ? '+' : ''}{Math.round(s.dist)}
                  </span>
                  <span className="text-[10px] text-zinc-400 text-right font-mono">
                    {s.totalCEOI > 0 ? (s.totalPEOI / s.totalCEOI).toFixed(1) : '—'}
                  </span>
                </div>
              ))}

              {/* Separator between indices and stocks */}
              {scanData.some(s => s.type === 'index') && scanData.some(s => s.type === 'stock') && (
                <div className="border-t border-border/20 px-3 py-1 bg-zinc-900/30">
                  <span className="text-[9px] text-zinc-600 uppercase tracking-wider">F&O Stocks</span>
                </div>
              )}

              {/* Stock rows */}
              {scanData.filter(s => s.type === 'stock').map(s => (
                <div key={s.symbol} className="grid grid-cols-[1fr_72px_72px_60px_48px] gap-0 px-3 py-1.5 border-t border-border/10 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                      backgroundColor: s.dist > 0 ? '#22c55e' : '#ef4444',
                    }} />
                    <span className="text-[10px] text-zinc-300 truncate">{s.symbol}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 text-right font-mono">{formatNumber(Math.round(s.spot))}</span>
                  <span className="text-[10px] text-amber-400/70 text-right font-mono">{formatNumber(s.maxPain)}</span>
                  <span className={`text-[10px] text-right font-mono ${s.dist > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                    {s.dist > 0 ? '+' : ''}{Math.round(s.dist)}
                  </span>
                  <span className="text-[10px] text-zinc-500 text-right font-mono">
                    {s.totalCEOI > 0 ? (s.totalPEOI / s.totalCEOI).toFixed(1) : '—'}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <div className="mt-2 text-[9px] text-zinc-600 leading-relaxed">
              Spot above Max Pain = option writers (sellers) in profit → gravitational pull toward MP at expiry.
              Refreshes every 2 min. Best signal on monthly expiry after 2 PM in low volatility.
            </div>
          </>
        ) : !scanError && scanData.length === 0 && !scanLoading ? (
          <div className="text-center py-4">
            <Gauge className="w-5 h-5 text-zinc-600 mx-auto mb-1.5" />
            <p className="text-[10px] text-zinc-500">Connect Kite API to see Max Pain Gravity Meter</p>
          </div>
        ) : scanLoading && scanData.length === 0 ? (
          <div className="text-center py-4">
            <RefreshCw className="w-5 h-5 text-zinc-600 animate-spin mx-auto mb-1.5" />
            <p className="text-[10px] text-zinc-500">Scanning all {INDEX_SPECS.length + STOCK_SPECS.length} symbols...</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
