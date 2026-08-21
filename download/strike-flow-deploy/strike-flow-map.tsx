'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, RefreshCw, Crosshair } from 'lucide-react';
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
const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'];

export default function StrikeFlowMap() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [prevSnapshot, setPrevSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [currSnapshot, setCurrSnapshot] = useState<StrikeFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [flowHistory, setFlowHistory] = useState<FlowTotals[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kite/strike-flow?symbol=${symbol}`);
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
            const updated = [...h, { ...totals, netFlow: totals.netFlow }];
            return updated.slice(-60); // keep last 60 intervals
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

  // CE offsets: ATM+250, +200, +150, +100, +50, 0, -50, -100, -150, -200, -250
  const CE_OFFSETS = [250, 200, 150, 100, 50, 0, -50, -100, -150, -200, -250];
  const PE_OFFSETS = [-250, -200, -150, -100, -50, 0, 50, 100, 150, 200, 250];
  const CE_CATS = ['OTM','OTM','OTM','OTM','OTM','ATM','ITM','ITM','ITM','ITM','ITM'];
  const PE_CATS = ['ITM','ITM','ITM','ITM','ITM','ATM','OTM','OTM','OTM','OTM','OTM'];

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
  // NET FLOW MINI CHART (last 60 intervals)
  // ═══════════════════════════════════════════
  function NetFlowMiniChart() {
    if (flowHistory.length < 2) return null;
    const vals = flowHistory.map(h => h.netFlow);
    const maxAbs = Math.max(...vals.map(Math.abs), 0.01);
    const w = 300, h = 40;
    const step = w / (vals.length - 1);

    const points = vals.map((v, i) => `${i * step},${h / 2 - (v / maxAbs) * (h / 2 - 2)}`).join(' ');
    const zeroLine = `M0,${h / 2} L${w},${h / 2}`;

    // Fill area
    const areaPoints = `0,${h / 2} ${points} ${w},${h / 2}`;
    const lastVal = vals[vals.length - 1];
    const fill = lastVal >= 0 ? 'rgba(0,176,80,0.15)' : 'rgba(189,33,48,0.15)';
    const stroke = lastVal >= 0 ? '#00B050' : '#BD2130';

    return (
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="#333" strokeWidth="0.5" />
        <polygon points={areaPoints} fill={fill} />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" />
        {/* Current value dot */}
        <circle cx={(vals.length - 1) * step} cy={h / 2 - (lastVal / maxAbs) * (h / 2 - 2)} r="2.5" fill={stroke} />
      </svg>
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

        {/* Symbol Selector */}
        <div className="flex gap-1">
          {SYMBOLS.map(s => (
            <button
              key={s}
              onClick={() => { setSymbol(s); setPrevSnapshot(null); setCurrSnapshot(null); setFlowHistory([]); }}
              className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                symbol === s
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'bg-muted/50 text-muted-foreground border border-transparent hover:border-border'
              }`}
            >
              {s}
            </button>
          ))}
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
              Spot: <b className="text-white">{currSnapshot.spotPrice.toFixed(0)}</b>
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

      {/* Bottom Section: Totals + Mini Chart */}
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

          {/* Net Flow Trend */}
          <div className="rounded-lg p-3 border" style={{ borderColor: '#333', background: COLORS.dark }}>
            <h3 className="text-[10px] font-bold mb-2" style={{ color: COLORS.accent }}>
              NET FLOW TREND
            </h3>
            {flowHistory.length >= 2 ? (
              <NetFlowMiniChart />
            ) : (
              <div className="h-10 flex items-center justify-center text-[10px] text-muted-foreground">
                Collecting data points...
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
              <span className="text-[10px] font-mono text-muted-foreground">{flowHistory.length}</span>
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