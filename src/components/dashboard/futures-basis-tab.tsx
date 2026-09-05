'use client';

import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, ArrowUpDown, Minus, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import { TRACKED_SYMBOLS } from '@/lib/types';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

interface BasisData {
  symbol: string;
  spotPrice: number;
  futPrice: number;
  basis: number;          // futures - spot
  basisPct: number;        // (futures - spot) / spot * 100
  basisChange: number;     // change from previous poll
  futOI: number;
  futOIChange: number;
  spotChange: number;      // % change from previous close
}

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const REFRESH_INTERVAL = 30000;

// Sector mapping for grouping
const SECTORS: Record<string, string> = {
  RELIANCE: 'Oil & Energy',
  TCS: 'IT',
  INFY: 'IT',
  HDFCBANK: 'Banking',
  ICICIBANK: 'Banking',
  SBIN: 'Banking',
  KOTAKBANK: 'Banking',
  AXISBANK: 'Banking',
  BAJFINANCE: 'Financial Services',
  ITC: 'FMCG',
  BHARTIARTL: 'Telecom',
  LT: 'Infrastructure',
  'M&M': 'Auto',
  TITAN: 'Consumer',
  ETERNAL: 'Consumer',
};

const SECTOR_COLORS: Record<string, string> = {
  'Oil & Energy': 'text-blue-400 border-blue-500/30',
  'IT': 'text-purple-400 border-purple-500/30',
  'Banking': 'text-emerald-400 border-emerald-500/30',
  'Financial Services': 'text-amber-400 border-amber-500/30',
  'FMCG': 'text-pink-400 border-pink-500/30',
  'Telecom': 'text-cyan-400 border-cyan-500/30',
  'Infrastructure': 'text-orange-400 border-orange-500/30',
  'Auto': 'text-red-400 border-red-500/30',
  'Consumer': 'text-lime-400 border-lime-500/30',
  'Index': 'text-sky-400 border-sky-500/30',
};

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

export default function FuturesBasisTab() {
  const [data, setData] = useState<BasisData[]>([]);
  const [mode, setMode] = useState<string>('');
  const { curr, pollCount } = useKiteSnapshot(30000);
  const [sortKey, setSortKey] = useState<'symbol' | 'basisPct' | 'futOI'>('basisPct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const prevBasisRef = useRef<Map<string, number>>(new Map());
  const prevOIRef = useRef<Map<string, number>>(new Map());

  // Process snapshot into basis data
  useEffect(() => {
    if (!curr) return;
    setMode(curr.mode);

    if (curr.mode === 'demo' || !curr.symbols?.length) {
      setData(generateDemoBasis());
      return;
    }

    const prevBasis = prevBasisRef.current;
    const prevOI = prevOIRef.current;
    const newBasis = new Map<string, number>();
    const newOI = new Map<string, number>();

    const basisData: BasisData[] = curr.symbols
      .filter(s => s.futPrice > 0 && s.spotPrice > 0)
      .map(s => {
        const basis = s.futPrice - s.spotPrice;
        const basisPct = (basis / s.spotPrice) * 100;
        const prevB = prevBasis.get(s.symbol);
        const prevO = prevOI.get(s.symbol);
        const bd: BasisData = {
          symbol: s.symbol,
          spotPrice: s.spotPrice,
          futPrice: s.futPrice,
          basis: Math.round(basis * 100) / 100,
          basisPct: Math.round(basisPct * 10000) / 10000,
          basisChange: prevB !== undefined ? Math.round((basisPct - prevB) * 10000) / 10000 : 0,
          futOI: s.futOI,
          futOIChange: prevO !== undefined ? s.futOI - prevO : 0,
          spotChange: s.spotChange,
        };
        newBasis.set(s.symbol, basisPct);
        newOI.set(s.symbol, s.futOI);
        return bd;
      });

    prevBasisRef.current = newBasis;
    prevOIRef.current = newOI;
    setData(basisData);
  }, [curr?.timestamp]);

  // Sort
  const sorted = [...data].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'symbol') return mul * a.symbol.localeCompare(b.symbol);
    return mul * (a[sortKey] - b[sortKey]);
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Sector flow aggregation
  const sectorFlow = new Map<string, { totalBasis: number; count: number; netSpotChange: number }>();
  for (const d of data) {
    const sector = SECTORS[d.symbol] || 'Index';
    const existing = sectorFlow.get(sector) || { totalBasis: 0, count: 0, netSpotChange: 0 };
    existing.totalBasis += d.basisPct;
    existing.count += 1;
    existing.netSpotChange += d.spotChange;
    sectorFlow.set(sector, existing);
  }
  const sectorList = [...sectorFlow.entries()]
    .map(([sector, v]) => ({ sector, avgBasis: v.totalBasis / v.count, count: v.count, avgSpotChange: v.netSpotChange / v.count }))
    .sort((a, b) => b.avgBasis - a.avgBasis);

  const basisColor = (v: number) => v > 0.01 ? 'text-emerald-400' : v < -0.01 ? 'text-red-400' : 'text-muted-foreground';
  const basisIcon = (v: number) => v > 0.01 ? <ArrowUpRight className="w-3 h-3" /> : v < -0.01 ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />;

  const SortIcon = ({ col }: { col: typeof sortKey }) => (
    <ArrowUpDown className={`w-2.5 h-2.5 inline ml-0.5 ${sortKey === col ? 'text-foreground' : 'text-muted-foreground/30'}`} />
  );

  return (
    <div className="space-y-3">
      {/* Summary Bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {mode && (
          <Badge variant="outline" className={mode === 'live' ? 'border-emerald-500/30 text-emerald-400' : 'border-orange-500/30 text-orange-400'}>
            {mode === 'live' ? <><Wifi className="mr-1 h-3 w-3" />LIVE</> : <><WifiOff className="mr-1 h-3 w-3" />DEMO</>}
          </Badge>
        )}
        <Badge variant="outline" className="bg-sky-600/20 text-sky-400 border-sky-500/30">
          {data.length} symbols
        </Badge>
        <button onClick={() => window.location.reload()} className="ml-auto text-muted-foreground hover:text-foreground transition">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sector Flow Rotation Panel */}
      <div className="bg-card/60 border border-border/40 rounded-lg p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 mb-2">
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          Sector Flow Rotation (avg basis % by sector)
        </div>
        <div className="flex flex-wrap gap-2">
          {sectorList.map(({ sector, avgBasis, count, avgSpotChange }) => {
            const color = SECTOR_COLORS[sector] || 'text-muted-foreground border-border/30';
            return (
              <div key={sector} className={`px-2.5 py-1.5 rounded-md border bg-card/80 ${color} text-xs`}
                title={`${count} stocks, avg spot change: ${avgSpotChange >= 0 ? '+' : ''}${avgSpotChange.toFixed(2)}%`}>
                <div className="font-medium">{sector}</div>
                <div className={`font-mono text-[11px] ${basisColor(avgBasis)}`}>
                  {avgBasis >= 0 ? '+' : ''}{avgBasis.toFixed(3)}%
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">
          Premium = bullish sentiment (institutions buying futures). Discount = bearish pressure. Extreme values signal reversal zones.
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-card/60 border border-border/40 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/30">
                <th className="text-left px-2 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort('symbol')}>
                  Symbol <SortIcon col="symbol" />
                </th>
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">Sector</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Spot</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Future</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort('basisPct')}>
                  Basis % <SortIcon col="basisPct" />
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Basis pts</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Change</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort('futOI')}>
                  Fut OI <SortIcon col="futOI" />
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">OI Chg</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Spot %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/15">
              {sorted.map(d => {
                const sector = SECTORS[d.symbol] || 'Index';
                const sectorColor = SECTOR_COLORS[sector] || '';
                return (
                  <tr key={d.symbol} className="hover:bg-muted/10 transition">
                    <td className="px-2 py-1.5 font-medium">{d.symbol}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sectorColor}`}>{sector}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{d.spotPrice.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{d.futPrice.toFixed(1)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-medium ${basisColor(d.basisPct)}`}>
                      {basisIcon(d.basisPct)} {d.basisPct >= 0 ? '+' : ''}{d.basisPct.toFixed(3)}%
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono ${basisColor(d.basis)}`}>
                      {d.basis >= 0 ? '+' : ''}{d.basis.toFixed(1)}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono text-[11px] ${d.basisChange > 0 ? 'text-emerald-400' : d.basisChange < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {d.basisChange !== 0 ? <>{d.basisChange > 0 ? '+' : ''}{d.basisChange.toFixed(3)}%</> : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{(d.futOI / 1000000).toFixed(2)}M</td>
                    <td className={`px-2 py-1.5 text-right font-mono text-[11px] ${d.futOIChange > 0 ? 'text-emerald-400' : d.futOIChange < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {d.futOIChange !== 0 ? <>{d.futOIChange > 0 ? '+' : ''}{(d.futOIChange / 1000).toFixed(0)}K</> : '—'}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono text-[11px] ${d.spotChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {d.spotChange >= 0 ? '+' : ''}{d.spotChange.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={10} className="px-2 py-8 text-center text-muted-foreground">No data yet...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* How to Interpret */}
      <div className="bg-card/40 border border-border/20 rounded-lg p-3 text-[11px] text-muted-foreground space-y-1">
        <p><span className="text-foreground font-medium">Premium (green)</span>: Futures trading above spot = bullish. Institutions are willing to pay extra for future delivery.</p>
        <p><span className="text-foreground font-medium">Discount (red)</span>: Futures below spot = bearish. Selling pressure or cost-of-carry turning negative.</p>
        <p><span className="text-foreground font-medium">Basis Expansion</span>: Increasing premium = strengthening bullish momentum. Watch for reversal when it peaks.</p>
        <p><span className="text-foreground font-medium">Basis Contraction</span>: Premium shrinking toward zero = momentum fading. Often precedes direction change.</p>
        <p><span className="text-foreground font-medium">OI + Basis Combo</span>: Rising OI + expanding premium = strong bullish buildup. Rising OI + shrinking premium = short buildup.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// DEMO DATA
// ═══════════════════════════════════════════

function generateDemoBasis(): BasisData[] {
  const symbols = TRACKED_SYMBOLS;
  const basePrices: Record<string, number> = {
    NIFTY: 24350, BANKNIFTY: 51200, SENSEX: 80450, FINNIFTY: 23100,
    RELIANCE: 2950, TCS: 3850, HDFCBANK: 1680, INFY: 1860,
    ICICIBANK: 1245, SBIN: 815, BHARTIARTL: 1620,
    ITC: 465, KOTAKBANK: 1780, LT: 3540, AXISBANK: 1145,
    BAJFINANCE: 7150, 'M&M': 2940, ETERNAL: 710, TITAN: 3560,
  };

  return symbols.map(sym => {
    const spot = (basePrices[sym] || 1000) * (1 + (Math.random() - 0.5) * 0.01);
    const basisPct = (Math.random() - 0.4) * 0.15; // slight bullish bias
    const futPrice = spot * (1 + basisPct / 100);
    return {
      symbol: sym,
      spotPrice: Math.round(spot * 100) / 100,
      futPrice: Math.round(futPrice * 100) / 100,
      basis: Math.round((futPrice - spot) * 100) / 100,
      basisPct: Math.round(basisPct * 10000) / 10000,
      basisChange: 0,
      futOI: Math.floor(Math.random() * 20000000 + 500000),
      futOIChange: 0,
      spotChange: Math.round((Math.random() - 0.5) * 300) / 100,
    };
  });
}
