'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, RefreshCw, Trophy, ArrowUpDown, TrendingUp, TrendingDown, Clock, Zap, Layers } from 'lucide-react';
import { useKiteSnapshot, type KiteSnapshot } from '@/hooks/use-kite-snapshot';
import { toIST } from '@/lib/ist';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface SymbolBetData {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spotPrice: number;
  spotVolume: number;
  spotChange: number;
  futOI: number;
  futPrice: number;
  futLotSize: number;
  lotSize: number;
  strikeStep: number;
  strikes: StrikeFlowData[];
}

interface BatchSnapshot {
  timestamp: string;
  mode: string;
  symbols: SymbolBetData[];
}

interface BetRecord {
  value: number;       // in Crores
  time: string;        // HH:MM:SS
  strike?: number;     // which strike (for options)
  intervalFlow?: number; // total flow in that interval
}

interface SymbolDayHighest {
  cash: BetRecord;
  future: BetRecord;
  ceBuy: BetRecord;
  ceWrite: BetRecord;
  peBuy: BetRecord;
  peWrite: BetRecord;
  // Derivatives
  netFlow: number;
  peakTime: string;
  peakStrike: number;
  peakType: string;
}

interface IntervalFlow {
  symbol: string;
  cash: number;        // per-interval turnover in Cr
  future: number;      // per-interval OI change in Cr
  ceBuy: number;
  ceWrite: number;
  peBuy: number;
  peWrite: number;
  netFlow: number;
  maxStrike: { type: string; strike: number; value: number } | null;
}

// ═══════════════════════════════════════════
// 4-COLOR FLOW ENGINE (same as strike-flow-map)
// ═══════════════════════════════════════════

const DIVISOR = 10000000; // Convert to Crores

function computeStrikeFlow(
  prev: StrikeFlowData,
  curr: StrikeFlowData,
  lotSize: number,
): { ceBuy: number; ceWrite: number; peBuy: number; peWrite: number } {
  const dceOI = curr.ceOI - prev.ceOI;
  const dceP = curr.ceLTP - prev.ceLTP;
  let ceBuy = 0, ceWrite = 0;

  if (dceOI > 0 && dceP >= 0) {
    ceBuy = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI > 0 && dceP < 0) {
    ceWrite = (dceOI * curr.ceDelta * lotSize) / DIVISOR;
  } else if (dceOI < 0 && dceP < 0) {
    ceWrite = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  } else if (dceOI < 0 && dceP >= 0) {
    ceBuy = (Math.abs(dceOI) * curr.ceDelta * lotSize * 0.3) / DIVISOR;
  }
  // Volume fallback when OI unchanged
  if (dceOI === 0 && (curr.ceVol - prev.ceVol) > 0) {
    ceBuy = (curr.ceVol * curr.ceDelta * lotSize * 0.4) / DIVISOR;
  }

  const dpeOI = curr.peOI - prev.peOI;
  const dpeP = curr.peLTP - prev.peLTP;
  let peBuy = 0, peWrite = 0;

  if (dpeOI > 0 && dpeP <= 0) {
    peBuy = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI > 0 && dpeP > 0) {
    peWrite = (dpeOI * curr.peDelta * lotSize) / DIVISOR;
  } else if (dpeOI < 0 && dpeP > 0) {
    peWrite = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  } else if (dpeOI < 0 && dpeP <= 0) {
    peBuy = (Math.abs(dpeOI) * curr.peDelta * lotSize * 0.3) / DIVISOR;
  }
  if (dpeOI === 0 && (curr.peVol - prev.peVol) > 0) {
    peBuy = (curr.peVol * curr.peDelta * lotSize * 0.4) / DIVISOR;
  }

  return { ceBuy, ceWrite, peBuy, peWrite };
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function emptyBetRecord(): BetRecord {
  return { value: 0, time: '--:--:--' };
}

function emptyDayHighest(): SymbolDayHighest {
  return {
    cash: emptyBetRecord(),
    future: emptyBetRecord(),
    ceBuy: emptyBetRecord(),
    ceWrite: emptyBetRecord(),
    peBuy: emptyBetRecord(),
    peWrite: emptyBetRecord(),
    netFlow: 0,
    peakTime: '--:--:--',
    peakStrike: 0,
    peakType: '-',
  };
}

function computeIntervalFlows(
  prev: BatchSnapshot,
  curr: BatchSnapshot,
): IntervalFlow[] {
  const results: IntervalFlow[] = [];

  for (const cSym of curr.symbols) {
    const pSym = prev.symbols.find(s => s.symbol === cSym.symbol);
    if (!pSym || pSym.strikes.length === 0) continue;

    // Cash turnover delta: (curr cumulative vol - prev cumulative vol) × curr price
    const cashDeltaVol = Math.max(0, cSym.spotVolume - pSym.spotVolume);
    const cashTurnover = (cashDeltaVol * cSym.spotPrice) / DIVISOR;

    // Future OI change × lotSize × price
    const futOIDelta = cSym.futOI - pSym.futOI;
    const futFlow = (Math.abs(futOIDelta) * cSym.futLotSize * cSym.futPrice) / DIVISOR;
    const futFlowSigned = futOIDelta > 0 ? futFlow : -futFlow;

    // Options: 4-color flow per strike, find max per type
    let maxCeBuy = 0, maxCeWrite = 0, maxPeBuy = 0, maxPeWrite = 0;
    let ceBuyStrike = 0, ceWriteStrike = 0, peBuyStrike = 0, peWriteStrike = 0;
    let totalCeBuy = 0, totalCeWrite = 0, totalPeBuy = 0, totalPeWrite = 0;
    let maxSingleStrike = 0, maxSingleType = '', maxSingleStrikeVal = 0;

    for (const cStrike of cSym.strikes) {
      const pStrike = pSym.strikes.find(s => s.strike === cStrike.strike);
      if (!pStrike) continue;

      const flow = computeStrikeFlow(pStrike, cStrike, cSym.lotSize);
      totalCeBuy += flow.ceBuy;
      totalCeWrite += flow.ceWrite;
      totalPeBuy += flow.peBuy;
      totalPeWrite += flow.peWrite;

      if (flow.ceBuy > maxCeBuy) { maxCeBuy = flow.ceBuy; ceBuyStrike = cStrike.strike; }
      if (flow.ceWrite > maxCeWrite) { maxCeWrite = flow.ceWrite; ceWriteStrike = cStrike.strike; }
      if (flow.peBuy > maxPeBuy) { maxPeBuy = flow.peBuy; peBuyStrike = cStrike.strike; }
      if (flow.peWrite > maxPeWrite) { maxPeWrite = flow.peWrite; peWriteStrike = cStrike.strike; }

      // Track absolute max single-strike flow
      const absMax = Math.max(flow.ceBuy, flow.ceWrite, flow.peBuy, flow.peWrite);
      if (absMax > maxSingleStrike) {
        maxSingleStrike = absMax;
        maxSingleStrikeVal = absMax;
        if (absMax === flow.ceBuy) { maxSingleType = 'CE Buy'; maxSingleStrikeVal = flow.ceBuy; }
        else if (absMax === flow.ceWrite) { maxSingleType = 'CE Write'; maxSingleStrikeVal = flow.ceWrite; }
        else if (absMax === flow.peBuy) { maxSingleType = 'PE Buy'; maxSingleStrikeVal = flow.peBuy; }
        else { maxSingleType = 'PE Write'; maxSingleStrikeVal = flow.peWrite; }
      }
    }

    const netFlow = (totalCeBuy + totalPeWrite) - (totalPeBuy + totalCeWrite);

    // Find the absolute peak across all 6 categories
    const allValues = [
      { type: 'Cash', value: cashTurnover },
      { type: 'Future', value: Math.abs(futFlowSigned) },
      { type: 'CE Buy', value: maxCeBuy },
      { type: 'CE Write', value: maxCeWrite },
      { type: 'PE Buy', value: maxPeBuy },
      { type: 'PE Write', value: maxPeWrite },
    ];
    const peak = allValues.reduce((a, b) => a.value > b.value ? a : b, allValues[0]);

    results.push({
      symbol: cSym.symbol,
      cash: cashTurnover,
      future: futFlowSigned,
      ceBuy: maxCeBuy,
      ceWrite: maxCeWrite,
      peBuy: maxPeBuy,
      peWrite: maxPeWrite,
      netFlow,
      maxStrike: maxSingleStrike > 0.01 ? { type: maxSingleType, strike: maxSingleStrikeVal > 0 ? (ceBuyStrike || peBuyStrike || ceWriteStrike || peWriteStrike || 0) : 0, value: maxSingleStrike } : null,
    });
  }

  return results;
}

// ═══════════════════════════════════════════
// LOCALSTORAGE PERSISTENCE
// ═══════════════════════════════════════════

const LS_KEY = 'highest-bet-day';

function getTodayKey(): string {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

function loadFromLS(): Record<string, SymbolDayHighest> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.date === getTodayKey()) return parsed.data;
    return null;
  } catch { return null; }
}

function saveToLS(data: Record<string, SymbolDayHighest>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ date: getTodayKey(), data }));
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════
// SORT COLUMNS
// ═══════════════════════════════════════════

type SortKey = 'symbol' | 'cash' | 'future' | 'ceBuy' | 'ceWrite' | 'peBuy' | 'peWrite' | 'netFlow';
const SORT_LABELS: Record<string, string> = {
  symbol: 'Symbol', cash: 'Cash', future: 'Future',
  ceBuy: 'CE Buy', ceWrite: 'CE Write', peBuy: 'PE Buy',
  peWrite: 'PE Write', netFlow: 'Net',
};

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

export default function HighestBetTracker() {
  const { curr, prev, pollCount } = useKiteSnapshot(30000);
  const [mode, setMode] = useState<string>('demo');
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');
  const [intervalCount, setIntervalCount] = useState(0);

  // Snapshots for diffing (driven by singleton)
  const prevSnapRef = useRef<BatchSnapshot | null>(null);
  const currSnapRef = useRef<BatchSnapshot | null>(null);

  // Day's highest per symbol
  const [dayHighest, setDayHighest] = useState<Record<string, SymbolDayHighest>>(() => {
    return loadFromLS() || {};
  });

  // Current interval flows (for display)
  const [currentFlows, setCurrentFlows] = useState<IntervalFlow[]>([]);

  // Current spot prices (for display in table)
  const [spotPrices, setSpotPrices] = useState<Record<string, { price: number; change: number }>>({});

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('netFlow');
  const [sortAsc, setSortAsc] = useState(false);

  // Convert KiteSnapshot → BatchSnapshot for flow computation
  const toBatch = useCallback((snap: KiteSnapshot): BatchSnapshot => ({
    timestamp: snap.timestamp,
    mode: snap.mode,
    symbols: snap.symbols,
  }), []);

  // Process new snapshot data from singleton
  useEffect(() => {
    if (!curr) return;

    if (curr.mode === 'error') {
      setError('Snapshot error');
      return;
    }

    setMode(curr.mode);
    setError('');
    setLastUpdate(toIST(curr.timestamp));

    const snapshot: BatchSnapshot = toBatch(curr);

    // Update spot prices
    const sp: Record<string, { price: number; change: number }> = {};
    for (const s of curr.symbols) {
      sp[s.symbol] = { price: s.spotPrice, change: s.spotChange };
    }
    setSpotPrices(sp);

    // Seed dayHighest with all symbols on first load
    if (Object.keys(dayHighest).length === 0 && curr.symbols.length > 0) {
      const seed: Record<string, SymbolDayHighest> = {};
      for (const s of curr.symbols) {
        seed[s.symbol] = emptyDayHighest();
      }
      setDayHighest(seed);
    }

    // Compute flows if we have a previous snapshot
    const prevSnap = prevSnapRef.current;
    if (prevSnap && prevSnap.symbols.length > 0) {
      const flows = computeIntervalFlows(prevSnap, snapshot);
      setCurrentFlows(flows);

      // Update day's highest
      const istTime = toIST(curr.timestamp);
      setDayHighest(prevDH => {
        const next = { ...prevDH };
        let changed = false;

        for (const flow of flows) {
          const existing = next[flow.symbol] || emptyDayHighest();
          const updated = { ...existing };

          if (flow.cash > existing.cash.value) { updated.cash = { value: flow.cash, time: istTime }; changed = true; }
          if (Math.abs(flow.future) > Math.abs(existing.future.value)) { updated.future = { value: flow.future, time: istTime }; changed = true; }
          if (flow.ceBuy > existing.ceBuy.value) { updated.ceBuy = { value: flow.ceBuy, time: istTime, strike: 0 }; changed = true; }
          if (flow.ceWrite > existing.ceWrite.value) { updated.ceWrite = { value: flow.ceWrite, time: istTime, strike: 0 }; changed = true; }
          if (flow.peBuy > existing.peBuy.value) { updated.peBuy = { value: flow.peBuy, time: istTime, strike: 0 }; changed = true; }
          if (flow.peWrite > existing.peWrite.value) { updated.peWrite = { value: flow.peWrite, time: istTime, strike: 0 }; changed = true; }
          if (Math.abs(flow.netFlow) > Math.abs(existing.netFlow)) { updated.netFlow = flow.netFlow; }

          const cats = [
            { type: 'CE Buy', val: updated.ceBuy.value, strike: updated.ceBuy.strike },
            { type: 'CE Write', val: updated.ceWrite.value, strike: updated.ceWrite.strike },
            { type: 'PE Buy', val: updated.peBuy.value, strike: updated.peBuy.strike },
            { type: 'PE Write', val: updated.peWrite.value, strike: updated.peWrite.strike },
            { type: 'Cash', val: updated.cash.value },
            { type: 'Future', val: Math.abs(updated.future.value) },
          ];
          const peakCat = cats.reduce((a, b) => a.val > b.val ? a : b, cats[0]);
          updated.peakType = peakCat.type;
          updated.peakTime = peakCat.strike !== undefined ? (cats.find(c => c.type === peakCat.type)?.time || istTime) : istTime;

          next[flow.symbol] = updated;
        }

        if (changed) saveToLS(next);
        return next;
      });
    }

    // Shift snapshots
    prevSnapRef.current = snapshot;
  }, [curr?.timestamp, toBatch, dayHighest]);

  // Sort logic
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortedSymbols = Object.entries(dayHighest)
    .map(([symbol, h]) => {
      const sp = spotPrices[symbol];
      const currentFlow = currentFlows.find(f => f.symbol === symbol);
      return { symbol, h, spotPrice: sp?.price || 0, spotChange: sp?.change || 0, currentFlow };
    })
    .sort((a, b) => {
      let va = 0, vb = 0;
      switch (sortKey) {
        case 'symbol': return sortAsc ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
        case 'cash': va = a.h.cash.value; vb = b.h.cash.value; break;
        case 'future': va = Math.abs(a.h.future.value); vb = Math.abs(b.h.future.value); break;
        case 'ceBuy': va = a.h.ceBuy.value; vb = b.h.ceBuy.value; break;
        case 'ceWrite': va = a.h.ceWrite.value; vb = b.h.ceWrite.value; break;
        case 'peBuy': va = a.h.peBuy.value; vb = b.h.peBuy.value; break;
        case 'peWrite': va = a.h.peWrite.value; vb = b.h.peWrite.value; break;
        case 'netFlow': va = Math.abs(a.h.netFlow); vb = Math.abs(b.h.netFlow); break;
      }
      return sortAsc ? va - vb : vb - va;
    });

  // Find overall biggest bet of the day
  const biggestBet = sortedSymbols.reduce((best, row) => {
    const cats = [
      { val: row.h.ceBuy.value, type: 'CE Buy', time: row.h.ceBuy.time, sym: row.symbol },
      { val: row.h.ceWrite.value, type: 'CE Write', time: row.h.ceWrite.time, sym: row.symbol },
      { val: row.h.peBuy.value, type: 'PE Buy', time: row.h.peBuy.time, sym: row.symbol },
      { val: row.h.peWrite.value, type: 'PE Write', time: row.h.peWrite.time, sym: row.symbol },
      { val: row.h.cash.value, type: 'Cash', time: row.h.cash.time, sym: row.symbol },
      { val: Math.abs(row.h.future.value), type: 'Future', time: row.h.future.time, sym: row.symbol },
    ];
    const peak = cats.reduce((a, b) => a.val > b.val ? a : b, cats[0]);
    if (peak.val > (best?.val || 0)) return { val: peak.val, type: peak.type, time: peak.time, sym: peak.sym };
    return best;
  }, null as { val: number; type: string; time: string; sym: string } | null);

  // ═══ SECTOR FLOW ROTATION ═══
  const SECTORS: Record<string, string[]> = {
    'Banking': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK'],
    'IT': ['TCS', 'INFY'],
    'FMCG': ['ITC'],
    'Energy': ['RELIANCE'],
    'Auto': ['M&M'],
    'Finance': ['BAJFINANCE'],
    'Infra': ['LT'],
    'Telecom': ['BHARTIARTL'],
    'Consumer': ['TITAN', 'ETERNAL'],
  };

  const sectorFlow = Object.entries(SECTORS).map(([sector, stocks]) => {
    const stocksData = currentFlows.filter(f => stocks.includes(f.symbol));
    const netSum = stocksData.reduce((s, f) => s + f.netFlow, 0);
    const dayHighSum = stocks.reduce((s, sym) => {
      const h = dayHighest[sym];
      if (!h) return s;
      return s + Math.abs(h.ceBuy.value) + Math.abs(h.peBuy.value) + Math.abs(h.ceWrite.value) + Math.abs(h.peWrite.value);
    }, 0);
    return { sector, netFlow: netSum, activity: dayHighSum, stockCount: stocks.length };
  }).sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));

  const maxSectorActivity = Math.max(...sectorFlow.map(s => s.activity), 1);

  // ═══ RENDER ═══

  const fmtCr = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `${(abs / 1000).toFixed(1)}K Cr`;
    if (abs >= 1) return `${abs.toFixed(1)} Cr`;
    if (abs >= 0.01) return `${(abs * 100).toFixed(0)}L`;
    return `${(abs * 10000).toFixed(0)}K`;
  };

  const cellColor = (value: number, isBullish?: boolean) => {
    if (value <= 0) return 'text-muted-foreground/50';
    if (isBullish === true) return 'text-emerald-400';
    if (isBullish === false) return 'text-red-400';
    return 'text-amber-400';
  };

  return (
    <div className="space-y-3">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={
            mode === 'live' ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'
          }>
            {mode === 'live' ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
            {mode === 'live' ? 'LIVE' : 'DEMO'}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {intervalCount > 0 ? `${intervalCount} intervals tracked` : 'Waiting for 2nd snapshot...'}
          </span>
          {lastUpdate && (
            <span className="text-[10px] text-muted-foreground font-mono">Last: {lastUpdate}</span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className="text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted/50 transition-colors flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> Reset
        </button>
      </div>

      {/* Biggest Bet of the Day - Summary Card */}
      {biggestBet && biggestBet.val > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-300">BIGGEST BET OF THE DAY</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-lg font-bold text-foreground">{biggestBet.sym}</span>
              <span className="text-xs text-muted-foreground ml-2">{biggestBet.type}</span>
            </div>
            <div className="text-xl font-bold text-amber-400">{fmtCr(biggestBet.val)}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {biggestBet.time}
            </div>
          </div>
        </div>
      )}

      {/* Sector Flow Rotation */}
      {currentFlows.length > 0 && (
        <div className="rounded-lg border border-border/30 bg-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-xs font-bold text-purple-300">SECTOR FLOW ROTATION</span>
            <span className="text-[9px] text-muted-foreground">current interval net flow by sector</span>
          </div>
          <div className="space-y-1.5">
            {sectorFlow.map(s => (
              <div key={s.sector} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 text-right text-muted-foreground font-medium">{s.sector}</span>
                <div className="flex-1 h-4 bg-muted/20 rounded overflow-hidden relative">
                  {s.netFlow !== 0 && (
                    <div
                      className={`h-full rounded ${s.netFlow > 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                      style={{ width: `${Math.min(100, (Math.abs(s.netFlow) / (maxSectorActivity || 1)) * 100)}%` }}
                    />
                  )}
                  <span className="absolute inset-0 flex items-center px-1.5 font-mono text-[10px]">
                    {s.netFlow !== 0 ? `${s.netFlow > 0 ? '+' : ''}${fmtCr(s.netFlow)}` : '--'}
                  </span>
                </div>
                <span className="w-6 text-right text-muted-foreground">{s.stockCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {sortedSymbols.length === 0 && (
        <div className="rounded-lg border border-border/30 bg-card p-6 text-center text-muted-foreground text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading 19 symbols... (need 2 snapshots for flow data)
        </div>
      )}

      {/* No data yet state */}
      {!curr && sortedSymbols.length === 0 && (
        <div className="rounded-lg border border-border/30 bg-card p-6 text-center text-muted-foreground text-sm">
          <Zap className="h-5 w-5 mx-auto mb-2 opacity-40" />
          Waiting for first data snapshot...<br />
          <span className="text-xs">Flow data appears after 2 consecutive polls (~30s)</span>
        </div>
      )}


      {/* Main Table */}
      {sortedSymbols.length > 0 && (
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border/30">
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                  <th
                    className="px-2 py-2 text-left font-medium cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('symbol')}
                  >
                    <div className="flex items-center gap-1">Symbol <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="px-2 py-2 text-right font-medium text-muted-foreground">Spot</th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('cash')}
                  >
                    <div className="flex items-center justify-end gap-1">Cash <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('future')}
                  >
                    <div className="flex items-center justify-end gap-1">Future <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-emerald-400/80 transition-colors"
                    onClick={() => toggleSort('ceBuy')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-emerald-500">CE Buy</span> <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-red-400/80 transition-colors"
                    onClick={() => toggleSort('ceWrite')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-red-400">CE Write</span> <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-red-400/80 transition-colors"
                    onClick={() => toggleSort('peBuy')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-red-500">PE Buy</span> <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-emerald-400/80 transition-colors"
                    onClick={() => toggleSort('peWrite')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-emerald-400">PE Write</span> <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-2 text-right font-medium cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('netFlow')}
                  >
                    <div className="flex items-center justify-end gap-1">Net <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="px-2 py-2 text-right font-medium text-muted-foreground">Peak</th>
                </tr>
              </thead>
              <tbody>
                {sortedSymbols.map((row, idx) => {
                  const { h, symbol, spotPrice, spotChange, currentFlow } = row;
                  const isBiggest = biggestBet?.sym === symbol;

                  return (
                    <tr
                      key={symbol}
                      className={`border-b border-border/20 hover:bg-muted/20 transition-colors ${
                        isBiggest ? 'bg-amber-500/5 border-amber-500/20' : ''
                      }`}
                    >
                      {/* Rank */}
                      <td className="px-2 py-1.5 text-muted-foreground font-mono">{idx + 1}</td>

                      {/* Symbol + Change */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          {isBiggest && <Trophy className="h-3 w-3 text-amber-400 flex-shrink-0" />}
                          <span className="font-bold text-foreground">{symbol}</span>
                          {spotPrice > 0 && (
                            <span className={`text-[10px] font-mono ${spotChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {spotPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                              <span className="ml-0.5">{spotChange >= 0 ? '+' : ''}{spotChange.toFixed(1)}%</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cash - Highest turnover delta */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={cellColor(h.cash.value)}>
                          <div className="font-mono font-bold">{fmtCr(h.cash.value)}</div>
                          {h.cash.value > 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.cash.time}</div>}
                        </div>
                        {/* Current interval indicator */}
                        {currentFlow && currentFlow.cash > 0 && (
                          <div className="text-[9px] text-amber-400/60 font-mono">now: {fmtCr(currentFlow.cash)}</div>
                        )}
                      </td>

                      {/* Future - Highest OI change */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={h.future.value > 0 ? 'text-emerald-400' : h.future.value < 0 ? 'text-red-400' : 'text-muted-foreground/50'}>
                          <div className="font-mono font-bold">
                            {h.future.value !== 0 ? `${h.future.value > 0 ? '+' : ''}${fmtCr(h.future.value)}` : '--'}
                          </div>
                          {h.future.value !== 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.future.time}</div>}
                        </div>
                        {currentFlow && currentFlow.future !== 0 && (
                          <div className={`text-[9px] font-mono ${currentFlow.future > 0 ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                            now: {currentFlow.future > 0 ? '+' : ''}{fmtCr(currentFlow.future)}
                          </div>
                        )}
                      </td>

                      {/* CE Buy - bright green */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={cellColor(h.ceBuy.value, true)}>
                          <div className="font-mono font-bold">{h.ceBuy.value > 0 ? fmtCr(h.ceBuy.value) : '--'}</div>
                          {h.ceBuy.value > 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.ceBuy.time}</div>}
                        </div>
                        {currentFlow && currentFlow.ceBuy > 0 && (
                          <div className="text-[9px] text-emerald-400/60 font-mono">now: {fmtCr(currentFlow.ceBuy)}</div>
                        )}
                      </td>

                      {/* CE Write - light red */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={cellColor(h.ceWrite.value, false)}>
                          <div className="font-mono font-bold">{h.ceWrite.value > 0 ? fmtCr(h.ceWrite.value) : '--'}</div>
                          {h.ceWrite.value > 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.ceWrite.time}</div>}
                        </div>
                        {currentFlow && currentFlow.ceWrite > 0 && (
                          <div className="text-[9px] text-red-400/60 font-mono">now: {fmtCr(currentFlow.ceWrite)}</div>
                        )}
                      </td>

                      {/* PE Buy - bright red */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={cellColor(h.peBuy.value, false)}>
                          <div className="font-mono font-bold">{h.peBuy.value > 0 ? fmtCr(h.peBuy.value) : '--'}</div>
                          {h.peBuy.value > 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.peBuy.time}</div>}
                        </div>
                        {currentFlow && currentFlow.peBuy > 0 && (
                          <div className="text-[9px] text-red-400/60 font-mono">now: {fmtCr(currentFlow.peBuy)}</div>
                        )}
                      </td>

                      {/* PE Write - light green */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={cellColor(h.peWrite.value, true)}>
                          <div className="font-mono font-bold">{h.peWrite.value > 0 ? fmtCr(h.peWrite.value) : '--'}</div>
                          {h.peWrite.value > 0 && <div className="text-[9px] text-muted-foreground/70 font-mono">{h.peWrite.time}</div>}
                        </div>
                        {currentFlow && currentFlow.peWrite > 0 && (
                          <div className="text-[9px] text-emerald-400/60 font-mono">now: {fmtCr(currentFlow.peWrite)}</div>
                        )}
                      </td>

                      {/* Net Flow */}
                      <td className="px-2 py-1.5 text-right">
                        <div className={`font-mono font-bold ${h.netFlow > 0 ? 'text-emerald-400' : h.netFlow < 0 ? 'text-red-400' : 'text-muted-foreground/50'}`}>
                          {h.netFlow !== 0 ? `${h.netFlow > 0 ? '+' : ''}${fmtCr(h.netFlow)}` : '--'}
                        </div>
                      </td>

                      {/* Peak Time + Type */}
                      <td className="px-2 py-1.5 text-right">
                        <div className="text-[10px] font-mono text-muted-foreground">{h.peakTime}</div>
                        {h.peakType !== '-' && (
                          <Badge variant="outline" className={`text-[8px] px-1 py-0 border-amber-500/20 text-amber-300 ${
                            h.peakType.includes('Buy') && h.peakType.includes('CE') ? 'border-emerald-500/30 text-emerald-300' :
                            h.peakType.includes('Buy') && h.peakType.includes('PE') ? 'border-red-500/30 text-red-300' :
                            h.peakType.includes('Write') && h.peakType.includes('CE') ? 'border-red-400/30 text-red-300' :
                            h.peakType.includes('Write') && h.peakType.includes('PE') ? 'border-emerald-400/30 text-emerald-300' :
                            'border-amber-500/20 text-amber-300'
                          }`}>
                            {h.peakType}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend / Footer */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-400" /> Big = Day&apos;s highest single-strike bet</span>
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-400" /> Green = Bullish (CE Buy / PE Write)</span>
        <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3 text-red-400" /> Red = Bearish (PE Buy / CE Write)</span>
        <span>now: = current interval | 30s refresh | persisted in browser</span>
      </div>
    </div>
  );
}
