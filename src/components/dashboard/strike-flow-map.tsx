'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { STRIKE_FLOW_SYMBOLS, type StrikeFlowSnapshot, type StrikeFlowStrike } from '@/lib/kite-api';
import { Badge } from '@/components/ui/badge';
import { Crosshair, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

// ═══ 4-COLOR FLOW LOGIC ═══
// OI change + Price change → Smart Money Classification

export type FlowType = 'CE_BUY' | 'CE_WRITE' | 'PE_BUY' | 'PE_WRITE' | 'NEUTRAL';

export interface StrikeFlowData {
  strike: number;
  isATM: boolean;
  offset: number;
  ceFlow: FlowType;
  peFlow: FlowType;
  ceFlowCr: number;  // delta-weighted flow in Cr
  peFlowCr: number;
  ceOI: number;
  peOI: number;
  ceVol: number;
  peVol: number;
  ceLTP: number;
  peLTP: number;
  ceOIChg: number;
  peOIChg: number;
  cePriceChg: number;
  pePriceChg: number;
  netFlowCr: number;
}

const FLOW_COLORS: Record<FlowType, { bg: string; text: string; label: string }> = {
  CE_BUY:   { bg: '#00B050', text: '#fff',    label: 'CE Buy' },
  CE_WRITE: { bg: '#FFCCCC', text: '#333',    label: 'CE Write' },
  PE_BUY:   { bg: '#BD2130', text: '#fff',    label: 'PE Buy' },
  PE_WRITE: { bg: '#C6EFCE', text: '#333',    label: 'PE Write' },
  NEUTRAL:  { bg: '#f0f0f0', text: '#666',    label: '-' },
};

/**
 * Compute 4-color strike flow between two snapshots
 * Ported from user's Google Apps Script
 */
function computeStrikeFlow(
  prev: StrikeFlowSnapshot,
  curr: StrikeFlowSnapshot,
): StrikeFlowData[] {
  const lotSize = curr.lotSize;
  const results: StrikeFlowData[] = [];

  for (const cs of curr.strikes) {
    // Find matching strike in previous snapshot
    const ps = prev.strikes.find(s => s.strike === cs.strike);
    if (!ps || !cs.ce || !cs.pe) {
      results.push({
        strike: cs.strike, isATM: cs.isATM, offset: 0,
        ceFlow: 'NEUTRAL', peFlow: 'NEUTRAL',
        ceFlowCr: 0, peFlowCr: 0,
        ceOI: cs.ce?.oi || 0, peOI: cs.pe?.oi || 0,
        ceVol: cs.ce?.volume || 0, peVol: cs.pe?.volume || 0,
        ceLTP: cs.ce?.lastPrice || 0, peLTP: cs.pe?.lastPrice || 0,
        ceOIChg: 0, peOIChg: 0, cePriceChg: 0, pePriceChg: 0,
        netFlowCr: 0,
      });
      continue;
    }

    const ceOIChg = (cs.ce?.oi || 0) - (ps.ce?.oi || 0);
    const peOIChg = (cs.pe?.oi || 0) - (ps.pe?.oi || 0);
    const cePriceChg = (cs.ce?.lastPrice || 0) - (ps.ce?.lastPrice || 0);
    const pePriceChg = (cs.pe?.lastPrice || 0) - (ps.pe?.lastPrice || 0);

    // Delta-weighted OI flow: (deltaOI * |delta| * lotSize) / 1Cr
    const ceAbsDelta = Math.abs(cs.ceDelta);
    const peAbsDelta = Math.abs(cs.peDelta);

    let ceFlow: FlowType = 'NEUTRAL';
    let peFlow: FlowType = 'NEUTRAL';
    let ceFlowCr = 0;
    let peFlowCr = 0;

    // CE Flow Logic (from Google Script)
    if (ceOIChg > 0 && cePriceChg >= 0) {
      ceFlow = 'CE_BUY';
      ceFlowCr = (ceOIChg * ceAbsDelta * lotSize) / 10000000;
    } else if (ceOIChg > 0 && cePriceChg < 0) {
      ceFlow = 'CE_WRITE';
      ceFlowCr = (ceOIChg * ceAbsDelta * lotSize) / 10000000;
    } else if (ceOIChg < 0 && cePriceChg < 0) {
      ceFlow = 'CE_WRITE';
      ceFlowCr = (Math.abs(ceOIChg) * ceAbsDelta * lotSize * 0.3) / 10000000;
    } else if (ceOIChg === 0) {
      // Volume fallback (from summary)
      const ceVol = cs.ce?.volume || 0;
      if (ceVol > 0) {
        if (cePriceChg >= 0) {
          ceFlow = 'CE_BUY';
        } else {
          ceFlow = 'CE_WRITE';
        }
        ceFlowCr = (ceVol * ceAbsDelta * lotSize * 0.4) / 10000000;
      }
    }

    // PE Flow Logic (from Google Script)
    if (peOIChg > 0 && pePriceChg >= 0) {
      peFlow = 'PE_WRITE';
      peFlowCr = (peOIChg * peAbsDelta * lotSize) / 10000000;
    } else if (peOIChg > 0 && pePriceChg < 0) {
      peFlow = 'PE_BUY';
      peFlowCr = (peOIChg * peAbsDelta * lotSize) / 10000000;
    } else if (peOIChg < 0 && pePriceChg < 0) {
      peFlow = 'PE_WRITE';
      peFlowCr = (Math.abs(peOIChg) * peAbsDelta * lotSize * 0.3) / 10000000;
    } else if (peOIChg === 0) {
      const peVol = cs.pe?.volume || 0;
      if (peVol > 0) {
        if (pePriceChg < 0) {
          peFlow = 'PE_BUY';
        } else {
          peFlow = 'PE_WRITE';
        }
        peFlowCr = (peVol * peAbsDelta * lotSize * 0.4) / 10000000;
      }
    }

    // Net flow: CE Buy (bullish) + PE Write (bullish) - CE Write (bearish) - PE Buy (bearish)
    const netFlowCr =
      (ceFlow === 'CE_BUY' ? ceFlowCr : -ceFlowCr) +
      (peFlow === 'PE_WRITE' ? peFlowCr : -peFlowCr);

    results.push({
      strike: cs.strike,
      isATM: cs.isATM,
      offset: cs.strike - curr.atmStrike,
      ceFlow, peFlow,
      ceFlowCr, peFlowCr,
      ceOI: cs.ce?.oi || 0,
      peOI: cs.pe?.oi || 0,
      ceVol: cs.ce?.volume || 0,
      peVol: cs.pe?.volume || 0,
      ceLTP: cs.ce?.lastPrice || 0,
      peLTP: cs.pe?.lastPrice || 0,
      ceOIChg, peOIChg,
      cePriceChg, pePriceChg,
      netFlowCr,
    });
  }

  // Compute offset from ATM
  for (const r of results) {
    r.offset = r.strike - curr.atmStrike;
  }

  return results;
}

// ═══ TOTAL FLOW BAR ═══
function TotalFlowBar({ data }: { data: StrikeFlowData[] }) {
  const totals = data.reduce(
    (acc, d) => ({
      ceBuy: acc.ceBuy + (d.ceFlow === 'CE_BUY' ? d.ceFlowCr : 0),
      ceWrite: acc.ceWrite + (d.ceFlow === 'CE_WRITE' ? d.ceFlowCr : 0),
      peWrite: acc.peWrite + (d.peFlow === 'PE_WRITE' ? d.peFlowCr : 0),
      peBuy: acc.peBuy + (d.peFlow === 'PE_BUY' ? d.peFlowCr : 0),
    }),
    { ceBuy: 0, ceWrite: 0, peWrite: 0, peBuy: 0 },
  );

  const maxVal = Math.max(totals.ceBuy, totals.ceWrite, totals.peWrite, totals.peBuy, 0.01);

  const bars = [
    { label: 'CE Buy', value: totals.ceBuy, color: '#00B050' },
    { label: 'CE Write', value: totals.ceWrite, color: '#FFCCCC' },
    { label: 'PE Write', value: totals.peWrite, color: '#C6EFCE' },
    { label: 'PE Buy', value: totals.peBuy, color: '#BD2130' },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-1.5">
          <span className="w-14 text-right text-muted-foreground font-medium">{b.label}</span>
          <div className="flex-1 h-3 bg-muted/30 rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-500"
              style={{
                width: `${Math.max((Math.abs(b.value) / maxVal) * 100, 1)}%`,
                backgroundColor: b.color,
              }}
            />
          </div>
          <span className="w-12 font-mono font-semibold" style={{ color: b.value >= 0 ? '#00B050' : '#BD2130' }}>
            {b.value >= 0 ? '+' : ''}{b.value.toFixed(2)} Cr
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══ NET FLOW MINI CHART ═══
function NetFlowMiniChart({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const w = 180, h = 36;
  const max = Math.max(...values.map(Math.abs), 0.01);
  const mid = h / 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = mid - (v / max) * (mid - 2);
    return `${x},${y}`;
  });

  const lastVal = values[values.length - 1];
  const color = lastVal >= 0 ? '#00B050' : '#BD2130';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9">
      {/* Zero line */}
      <line x1={0} y1={mid} x2={w} y2={mid} stroke="#444" strokeWidth={0.5} />
      {/* Area fill */}
      <polygon
        points={`0,${mid} ${points.join(' ')} ${w},${mid}`}
        fill={lastVal >= 0 ? 'rgba(0,176,80,0.15)' : 'rgba(189,33,48,0.15)'}
      />
      {/* Line */}
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

// ═══ OTM/ATM/ITM LABEL ═══
function MoneynessLabel({ offset, side }: { offset: number; side: 'CE' | 'PE' }) {
  if (side === 'CE') {
    if (offset > 0) return <span className="text-[8px] text-muted-foreground">OTM</span>;
    if (offset === 0) return <span className="text-[8px] text-amber-400 font-bold">ATM</span>;
    return <span className="text-[8px] text-muted-foreground">ITM</span>;
  } else {
    if (offset < 0) return <span className="text-[8px] text-muted-foreground">OTM</span>;
    if (offset === 0) return <span className="text-[8px] text-amber-400 font-bold">ATM</span>;
    return <span className="text-[8px] text-muted-foreground">ITM</span>;
  }
}

// ═══ MAIN COMPONENT ═══
export default function StrikeFlowMap() {
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY');
  const [snapshot, setSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [flowData, setFlowData] = useState<StrikeFlowData[]>([]);
  const [netFlowHistory, setNetFlowHistory] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/kite/strike-flow?symbol=${selectedSymbol}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      const newSnap: StrikeFlowSnapshot = data;
      setSnapshot(newSnap);

      // Compute flow if we have a previous snapshot
      if (prevSnapshot && prevSnapshot.symbol === newSnap.symbol) {
        const flow = computeStrikeFlow(prevSnapshot, newSnap);
        setFlowData(flow);

        // Track net flow history
        const netFlow = flow.reduce((sum, d) => sum + d.netFlowCr, 0);
        setNetFlowHistory(prev => [...prev.slice(-59), netFlow]);
      }

      // Store as previous for next poll
      setPrevSnapshot(newSnap);
    } catch (err: any) {
      setError(err.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, prevSnapshot]);

  // Auto-poll every 30 seconds
  useEffect(() => {
    fetchSnapshot();
    pollRef.current = setInterval(fetchSnapshot, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchSnapshot]);

  // Reset on symbol change
  const handleSymbolChange = (sym: string) => {
    setSelectedSymbol(sym);
    setPrevSnapshot(null);
    setFlowData([]);
    setNetFlowHistory([]);
    setSnapshot(null);
  };

  const currentSymInfo = STRIKE_FLOW_SYMBOLS.find(s => s.symbol === selectedSymbol);
  const isIndex = currentSymInfo?.type === 'index';
  const netFlow = flowData.reduce((sum, d) => sum + d.netFlowCr, 0);

  // Find max absolute flow for "max bet" highlight
  const maxBetStrike = flowData.reduce(
    (max, d) => (Math.abs(d.netFlowCr) > Math.abs(max.netFlowCr) ? d : max),
    { netFlowCr: 0, strike: 0 },
  );

  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-pink-400" />
          <h2 className="text-sm font-bold">Strike Flow Map</h2>
          <Badge variant="outline" className="text-[9px] border-pink-500/30 text-pink-300">
            {isIndex ? 'INDEX' : 'STOCK'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Symbol Selector */}
          <select
            value={selectedSymbol}
            onChange={e => handleSymbolChange(e.target.value)}
            className="bg-muted/50 border border-border/50 rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-pink-500/50"
          >
            <optgroup label="--- Indices ---">
              {STRIKE_FLOW_SYMBOLS.filter(s => s.type === 'index').map(s => (
                <option key={s.symbol} value={s.symbol}>{s.name}</option>
              ))}
            </optgroup>
            <optgroup label="--- Stocks ---">
              {STRIKE_FLOW_SYMBOLS.filter(s => s.type === 'stock').map(s => (
                <option key={s.symbol} value={s.symbol}>{s.name}</option>
              ))}
            </optgroup>
          </select>

          <button
            onClick={fetchSnapshot}
            disabled={loading}
            className="p-1 rounded-md border border-border/50 hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Spot Price + Meta */}
      {snapshot && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Spot:</span>
            <span className="font-mono font-bold text-foreground">{snapshot.spotPrice.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">ATM:</span>
            <span className="font-mono text-amber-400 font-semibold">{snapshot.atmStrike}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Lot:</span>
            <span className="font-mono">{snapshot.lotSize}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Step:</span>
            <span className="font-mono">{snapshot.strikeStep}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Expiry:</span>
            <span className="font-mono">{snapshot.expiry ? new Date(snapshot.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}</span>
          </div>
        </div>
      )}

      {/* Collecting message */}
      {!flowData.length && snapshot && !error && (
        <div className="text-center py-8 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
          Collecting snapshots... Flow will appear after 2 polls (~30s)
        </div>
      )}

      {/* Loading first snapshot */}
      {!snapshot && loading && !error && (
        <div className="text-center py-8 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
          Fetching option chain for {selectedSymbol}...
        </div>
      )}

      {/* ═══ COLOR GRID + NET FLOW ═══ */}
      {flowData.length > 0 && (
        <>
          {/* 11×2 Color Grid */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* CE Row Label */}
              <div className="flex items-center mb-1">
                <div className="w-20" /> {/* offset for strike labels */}
                <div className="w-16 text-center">
                  <span className="text-[9px] font-bold text-emerald-400">CE SIDE</span>
                </div>
                <div className="flex-1" />
                <div className="w-16 text-center">
                  <span className="text-[9px] font-bold text-red-400">PE SIDE</span>
                </div>
              </div>

              {flowData.map((d) => {
                const ceStyle = FLOW_COLORS[d.ceFlow];
                const peStyle = FLOW_COLORS[d.peFlow];
                const isMaxBet = d.strike === maxBetStrike.strike;

                return (
                  <div key={d.strike} className="flex items-center mb-1">
                    {/* Strike label + OTM/ATM/ITM */}
                    <div className="w-20 text-right pr-2">
                      <span className={`text-xs font-mono ${d.isATM ? 'text-amber-400 font-bold' : 'text-foreground/70'}`}>
                        {d.strike}
                      </span>
                    </div>

                    {/* CE Cell */}
                    <div className="w-16 h-10 flex flex-col items-center justify-center rounded-sm border-2"
                      style={{
                        backgroundColor: ceStyle.bg,
                        color: ceStyle.text,
                        borderColor: isMaxBet ? '#000' : 'transparent',
                        borderWidth: isMaxBet ? 2 : 0,
                      }}
                    >
                      <span className="text-[8px] font-bold leading-none">{ceStyle.label}</span>
                      {d.ceFlowCr !== 0 && (
                        <span className="text-[8px] font-mono leading-none mt-0.5">
                          {d.ceFlowCr >= 0 ? '+' : ''}{d.ceFlowCr.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* Moneyness labels in center gap */}
                    <div className="flex-1 flex items-center justify-center gap-1 px-1">
                      <MoneynessLabel offset={d.offset} side="CE" />
                      {d.isATM && (
                        <span className="text-[9px] text-amber-400 font-bold">&#9650;</span>
                      )}
                      <MoneynessLabel offset={d.offset} side="PE" />
                    </div>

                    {/* PE Cell */}
                    <div className="w-16 h-10 flex flex-col items-center justify-center rounded-sm border-2"
                      style={{
                        backgroundColor: peStyle.bg,
                        color: peStyle.text,
                        borderColor: isMaxBet ? '#000' : 'transparent',
                        borderWidth: isMaxBet ? 2 : 0,
                      }}
                    >
                      <span className="text-[8px] font-bold leading-none">{peStyle.label}</span>
                      {d.peFlowCr !== 0 && (
                        <span className="text-[8px] font-mono leading-none mt-0.5">
                          {d.peFlowCr >= 0 ? '+' : ''}{d.peFlowCr.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* NET FLOW Column */}
                    <div className="w-16 text-right pl-2">
                      <span
                        className={`text-[10px] font-mono font-bold ${
                          d.netFlowCr >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {d.netFlowCr >= 0 ? '+' : ''}{d.netFlowCr.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Row Labels: offset guide */}
              <div className="flex items-center mt-1">
                <div className="w-20 text-right pr-2">
                  <span className="text-[8px] text-muted-foreground">OTM &larr;</span>
                </div>
                <div className="w-16" />
                <div className="flex-1 text-center">
                  <span className="text-[8px] text-muted-foreground">ATM</span>
                </div>
                <div className="w-16" />
                <div className="w-16 text-right pl-2">
                  <span className="text-[8px] text-muted-foreground">&rarr; ITM</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legend + Net Flow Summary */}
          <div className="flex items-center justify-between flex-wrap gap-3 p-2 rounded-md bg-card/50 border border-border/30">
            {/* Legend */}
            <div className="flex items-center gap-3 text-[9px]">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#00B050' }} />
                <span className="text-muted-foreground">CE Buy</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#FFCCCC' }} />
                <span className="text-muted-foreground">CE Write</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#C6EFCE' }} />
                <span className="text-muted-foreground">PE Write</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#BD2130' }} />
                <span className="text-muted-foreground">PE Buy</span>
              </div>
            </div>

            {/* Net Flow */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">NET FLOW:</span>
              <span className={`text-sm font-mono font-bold ${netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {netFlow >= 0 ? '+' : ''}{netFlow.toFixed(2)} Cr
              </span>
              <span className={`text-[10px] ${netFlow >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                {netFlow >= 0 ? 'BULLISH' : 'BEARISH'}
              </span>
            </div>
          </div>

          {/* Total Flow Bars */}
          <div className="p-3 rounded-md bg-card/50 border border-border/30">
            <div className="text-[10px] font-bold text-muted-foreground mb-2">FLOW BREAKDOWN (Cr)</div>
            <TotalFlowBar data={flowData} />
          </div>

          {/* Net Flow Sparkline */}
          <div className="p-3 rounded-md bg-card/50 border border-border/30">
            <div className="text-[10px] font-bold text-muted-foreground mb-1">
              NET FLOW HISTORY (last {netFlowHistory.length} readings)
            </div>
            <NetFlowMiniChart values={netFlowHistory} />
          </div>

          {/* Breakdown Table Toggle */}
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-1"
          >
            {showBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showBreakdown ? 'Hide' : 'Show'} per-strike breakdown
          </button>

          {showBreakdown && (
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] font-mono">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/30">
                    <th className="text-right py-1 pr-2">Strike</th>
                    <th className="text-right py-1 px-1">CE OI</th>
                    <th className="text-right py-1 px-1">CE OI Chg</th>
                    <th className="text-right py-1 px-1">CE Vol</th>
                    <th className="text-right py-1 px-1">CE LTP</th>
                    <th className="text-right py-1 px-1">CE Delta</th>
                    <th className="text-center py-1 px-1">CE Flow</th>
                    <th className="text-center py-1 px-2 text-amber-400">NET</th>
                    <th className="text-center py-1 px-1">PE Flow</th>
                    <th className="text-right py-1 px-1">PE Delta</th>
                    <th className="text-right py-1 px-1">PE LTP</th>
                    <th className="text-right py-1 px-1">PE Vol</th>
                    <th className="text-right py-1 px-1">PE OI Chg</th>
                    <th className="text-right py-1 px-1">PE OI</th>
                  </tr>
                </thead>
                <tbody>
                  {flowData.map(d => {
                    const ceS = snapshot?.strikes.find(s => s.strike === d.strike);
                    return (
                      <tr key={d.strike} className={`border-b border-border/10 ${d.isATM ? 'bg-amber-500/5' : ''}`}>
                        <td className={`text-right py-1 pr-2 ${d.isATM ? 'text-amber-400 font-bold' : ''}`}>{d.strike}</td>
                        <td className="text-right py-1 px-1">{d.ceOI.toLocaleString()}</td>
                        <td className={`text-right py-1 px-1 ${d.ceOIChg > 0 ? 'text-emerald-400' : d.ceOIChg < 0 ? 'text-red-400' : ''}`}>{d.ceOIChg > 0 ? '+' : ''}{d.ceOIChg.toLocaleString()}</td>
                        <td className="text-right py-1 px-1">{d.ceVol.toLocaleString()}</td>
                        <td className="text-right py-1 px-1">{d.ceLTP.toFixed(2)}</td>
                        <td className="text-right py-1 px-1">{ceS?.ceDelta.toFixed(3) || '-'}</td>
                        <td className="text-center py-1 px-1" style={{ color: FLOW_COLORS[d.ceFlow].bg === '#f0f0f0' ? '#666' : FLOW_COLORS[d.ceFlow].bg === '#FFCCCC' || FLOW_COLORS[d.ceFlow].bg === '#BD2130' ? '#BD2130' : '#00B050' }}>{FLOW_COLORS[d.ceFlow].label}</td>
                        <td className={`text-center py-1 px-2 font-bold ${d.netFlowCr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{d.netFlowCr >= 0 ? '+' : ''}{d.netFlowCr.toFixed(2)}</td>
                        <td className="text-center py-1 px-1" style={{ color: FLOW_COLORS[d.peFlow].bg === '#f0f0f0' ? '#666' : FLOW_COLORS[d.peFlow].bg === '#C6EFCE' || FLOW_COLORS[d.peFlow].bg === '#00B050' ? '#00B050' : '#BD2130' }}>{FLOW_COLORS[d.peFlow].label}</td>
                        <td className="text-right py-1 px-1">{ceS?.peDelta.toFixed(3) || '-'}</td>
                        <td className="text-right py-1 px-1">{d.peLTP.toFixed(2)}</td>
                        <td className="text-right py-1 px-1">{d.peVol.toLocaleString()}</td>
                        <td className={`text-right py-1 px-1 ${d.peOIChg > 0 ? 'text-emerald-400' : d.peOIChg < 0 ? 'text-red-400' : ''}`}>{d.peOIChg > 0 ? '+' : ''}{d.peOIChg.toLocaleString()}</td>
                        <td className="text-right py-1 px-1">{d.peOI.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}