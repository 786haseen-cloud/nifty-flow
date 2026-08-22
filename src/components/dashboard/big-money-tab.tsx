'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  BarChart3, Activity, Radio, Layers,
} from 'lucide-react';
import { useKiteSnapshot, type SnapshotSymbol } from '@/hooks/use-kite-snapshot';
import { formatNum } from '@/lib/demo-data';

const INDEX_KEYS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'] as const;
const INDEX_NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50', SENSEX: 'Sensex', BANKNIFTY: 'Bank Nifty', FINNIFTY: 'Fin Nifty',
};

// ─── Helpers ───

function fmtPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPts(n: number, decimals = 2) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

function pcrColor(pcr: number) {
  if (pcr > 1.2) return 'text-emerald-400';
  if (pcr < 0.8) return 'text-red-400';
  return 'text-amber-400';
}

function changeColor(v: number) {
  return v >= 0 ? 'text-emerald-400' : 'text-red-400';
}

// ─── Main Component ───

export default function BigMoneyTab() {
  const { curr, prev } = useKiteSnapshot(15000);
  const [selectedIdx, setSelectedIdx] = useState<string>('NIFTY');

  const mode = curr?.mode || 'demo';
  const isLive = mode === 'live';
  const symbols = curr?.symbols || [];
  const prevSymbols = prev?.symbols || [];
  const vix = curr?.vix;
  const timestamp = curr?.timestamp;

  // Build prev symbol lookup for diffing
  const prevMap = useMemo(() => {
    const m = new Map<string, SnapshotSymbol>();
    for (const s of prevSymbols) m.set(s.symbol, s);
    return m;
  }, [prevSymbols]);

  // ─── Index Summary (4 indices) ───
  const indexSummary = useMemo(() => {
    return INDEX_KEYS.map(key => {
      const sym = symbols.find(s => s.symbol === key);
      const psym = prevMap.get(key);
      if (!sym) return null;

      const totalCallOI = sym.strikes.reduce((s, t) => s + t.ceOI, 0);
      const totalPutOI = sym.strikes.reduce((s, t) => s + t.peOI, 0);
      const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
      const basis = sym.futPrice > 0 ? sym.futPrice - sym.spotPrice : 0;

      // Futures OI change
      const futOIChg = psym ? sym.futOI - psym.futOI : 0;
      // Basis change
      const prevBasis = psym?.futPrice && psym?.spotPrice ? psym.futPrice - psym.spotPrice : 0;
      const basisChg = basis - prevBasis;

      return {
        symbol: key,
        name: INDEX_NAMES[key] || key,
        spotPrice: sym.spotPrice,
        spotChange: sym.spotChange,
        futPrice: sym.futPrice,
        futOI: sym.futOI,
        futOIChg,
        basis,
        basisChg,
        pcr: Math.round(pcr * 100) / 100,
        totalCallOI,
        totalPutOI,
        lotSize: sym.lotSize,
      };
    }).filter(Boolean) as NonNullable<ReturnType<typeof indexSummary>[number]>[];
  }, [symbols, prevMap]);

  // ─── Futures Flow (all 19 symbols, sorted by |OI change|) ───
  const futuresFlow = useMemo(() => {
    return symbols
      .map(sym => {
        const psym = prevMap.get(sym.symbol);
        const futOIChg = psym ? sym.futOI - psym.futOI : 0;
        const basis = sym.futPrice > 0 ? sym.futPrice - sym.spotPrice : 0;
        const prevBasis = psym?.futPrice && psym?.spotPrice ? psym.futPrice - psym.spotPrice : 0;
        const basisChg = basis - prevBasis;
        return {
          symbol: sym.symbol,
          name: sym.name || sym.symbol,
          type: sym.type,
          spotPrice: sym.spotPrice,
          spotChange: sym.spotChange,
          futPrice: sym.futPrice,
          futOI: sym.futOI,
          futOIChg,
          basis,
          basisChg,
        };
      })
      .sort((a, b) => Math.abs(b.futOIChg) - Math.abs(a.futOIChg));
  }, [symbols, prevMap]);

  // ─── ATM+ITM Focus (selected index) ───
  const selectedSym = symbols.find(s => s.symbol === selectedIdx);
  const prevSym = prevMap.get(selectedIdx);

  const atmItmData = useMemo(() => {
    if (!selectedSym || selectedSym.strikes.length === 0) return [];

    const spotPrice = selectedSym.spotPrice;
    const strikeStep = selectedSym.strikeStep;

    // Build prev strike lookup
    const prevStrikeMap = new Map<number, { ceOI: number; peOI: number; ceVol: number; peVol: number }>();
    if (prevSym) {
      for (const s of prevSym.strikes) {
        prevStrikeMap.set(s.strike, { ceOI: s.ceOI, peOI: s.peOI, ceVol: s.ceVol, peVol: s.peVol });
      }
    }

    // Get ATM strike
    const atmStrike = selectedSym.strikes.find(s => s.isATM)?.strike ||
      Math.round(spotPrice / strikeStep) * strikeStep;

    // Filter to ATM ± 2 strikes (5 strikes total: ITM-2, ITM-1, ATM, OTM+1, OTM+2)
    const maxDiff = strikeStep * 2;

    return selectedSym.strikes
      .filter(s => Math.abs(s.strike - atmStrike) <= maxDiff)
      .map(s => {
        const diff = s.strike - atmStrike;
        let strikeType = 'ATM';
        if (diff < 0) strikeType = diff === -strikeStep ? 'ITM-1' : 'ITM-2';
        if (diff > 0) strikeType = diff === strikeStep ? 'OTM+1' : 'OTM+2';

        const ps = prevStrikeMap.get(s.strike);
        const ceOIChg = ps ? s.ceOI - ps.ceOI : 0;
        const peOIChg = ps ? s.peOI - ps.peOI : 0;
        const ceVolChg = ps ? s.ceVol - ps.ceVol : 0;
        const peVolChg = ps ? s.peVol - ps.peVol : 0;

        // Smart money signal
        const smartMoneySignal = ceOIChg > 50000 && peOIChg < 0 ? 'Call OI Build (Bullish)' :
          peOIChg > 50000 && ceOIChg < 0 ? 'Put OI Build (Bearish)' :
          ceOIChg > 20000 && peOIChg > 20000 ? 'Both Sides Building' :
          ceOIChg < -20000 && peOIChg < -20000 ? 'Long Unwinding' :
          ceOIChg > 20000 ? 'Call OI Buildup' :
          peOIChg > 20000 ? 'Put OI Buildup' :
          ceOIChg < -20000 ? 'Call OI Decay' :
          peOIChg < -20000 ? 'Put OI Decay' : '—';

        return {
          strike: s.strike,
          isATM: s.isATM,
          strikeType,
          ceOI: s.ceOI,
          peOI: s.peOI,
          ceOIChg,
          peOIChg,
          ceVol: s.ceVol,
          peVol: s.peVol,
          ceVolChg,
          peVolChg,
          ceLTP: s.ceLTP,
          peLTP: s.peLTP,
          ceDelta: s.ceDelta,
          peDelta: s.peDelta,
          smartMoneySignal,
        };
      })
      .sort((a, b) => a.strike - b.strike);
  }, [selectedSym, prevSym]);

  // ─── Empty state ───
  if (!curr || symbols.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        <div className="text-center">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <div className="text-sm">Waiting for market data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ═══ HEADER: Mode Badge + VIX + Timestamp ═══ */}
      <Card className={`border-border/50 backdrop-blur-sm ${
        isLive ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-amber-500/5 border-amber-500/30'
      }`}>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={`text-[10px] font-bold ${
              isLive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}>
              <Radio className="h-3 w-3 mr-1" />
              {isLive ? 'LIVE' : 'DEMO'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {isLive ? 'Real Kite API data' : 'Demo data — connect Kite for live'}
            </span>
            {vix && (
              <div className="ml-auto flex items-center gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">VIX: </span>
                  <span className={`font-mono font-bold ${changeColor(vix.change)}`}>{vix.value.toFixed(2)}</span>
                  <span className={`font-mono ${changeColor(vix.change)}`}> ({fmtPct(vix.changePercent)})</span>
                </div>
              </div>
            )}
            {timestamp && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECTION 1: Index Summary ═══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            Index Summary
            <Badge variant="outline" className="ml-auto text-[10px]">4 Indices — Spot · Future · Basis · PCR</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {indexSummary.map(idx => (
              <div
                key={idx.symbol}
                className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedIdx === idx.symbol
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/40 bg-muted/20 hover:bg-muted/40'
                }`}
                onClick={() => setSelectedIdx(idx.symbol)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm">{idx.name}</span>
                  <span className={`font-mono text-xs ${changeColor(idx.spotChange)}`}>
                    {fmtPct(idx.spotChange)}
                  </span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Spot</span>
                    <span className="font-mono font-bold">{idx.spotPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  {idx.futPrice > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Future</span>
                      <span className="font-mono">{idx.futPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Basis</span>
                    <span className={`font-mono ${changeColor(idx.basis)}`}>{fmtPts(idx.basis)}</span>
                  </div>
                  {idx.basisChg !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Basis Δ</span>
                      <span className={`font-mono ${idx.basisChg > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {idx.basisChg > 0 ? '↑' : '↓'} {fmtPts(Math.abs(idx.basisChg))}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fut OI</span>
                    <span className="font-mono">{formatNum(idx.futOI)}</span>
                  </div>
                  {idx.futOIChg !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">OI Δ</span>
                      <span className={`font-mono font-bold ${changeColor(idx.futOIChg)}`}>
                        {idx.futOIChg > 0 ? '+' : ''}{formatNum(idx.futOIChg)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PCR</span>
                    <span className={`font-mono font-bold ${pcrColor(idx.pcr)}`}>{idx.pcr.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-muted-foreground">
            Click an index card to view its ATM+ITM option chain below.
            <span className="text-emerald-400">PCR &gt; 1.2</span> = bullish put writing,
            <span className="text-red-400">PCR &lt; 0.8</span> = bearish call writing.
            <span className="text-amber-400">Basis expansion</span> = bullish positioning.
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECTION 2: Futures Flow (Real-time) ═══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-cyan-400" />
            Futures Flow (Real-time)
            <Badge variant="outline" className="ml-auto text-[10px]">Sorted by |OI Change|</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground sticky top-0 bg-card z-10">
                  <th className="py-2 pr-2 text-left font-medium">Symbol</th>
                  <th className="py-2 pr-2 text-left font-medium">Type</th>
                  <th className="py-2 pr-2 text-right font-medium">Spot</th>
                  <th className="py-2 pr-2 text-right font-medium">Chg%</th>
                  <th className="py-2 pr-2 text-right font-medium">Fut Price</th>
                  <th className="py-2 pr-2 text-right font-medium">Basis</th>
                  <th className="py-2 pr-2 text-right font-medium">Basis Δ</th>
                  <th className="py-2 pr-2 text-right font-medium">Fut OI</th>
                  <th className="py-2 text-right font-medium">OI Change</th>
                </tr>
              </thead>
              <tbody>
                {futuresFlow.map(row => (
                  <tr
                    key={row.symbol}
                    className={`border-b border-border/15 hover:bg-muted/20 transition-colors ${
                      row.type === 'index' ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-2 font-bold">{row.name || row.symbol}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className={`text-[9px] ${
                        row.type === 'index'
                          ? 'border-blue-500/30 text-blue-300'
                          : 'border-gray-500/30 text-gray-400'
                      }`}>
                        {row.type === 'index' ? 'IDX' : 'STK'}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {row.spotPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`py-1.5 pr-2 text-right font-mono ${changeColor(row.spotChange)}`}>
                      {fmtPct(row.spotChange)}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {row.futPrice > 0 ? row.futPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className={`py-1.5 pr-2 text-right font-mono ${changeColor(row.basis)}`}>
                      {row.futPrice > 0 ? fmtPts(row.basis) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {row.basisChg !== 0 ? (
                        <span className={`font-mono text-[10px] ${
                          row.basisChg > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {row.basisChg > 0 ? <ArrowUpRight className="inline h-2.5 w-2.5" /> : <ArrowDownRight className="inline h-2.5 w-2.5" />}
                          {' '}{fmtPts(Math.abs(row.basisChg))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">
                      {formatNum(row.futOI)}
                    </td>
                    <td className={`py-1.5 text-right font-mono font-bold ${changeColor(row.futOIChg)}`}>
                      {row.futOIChg !== 0
                        ? `${row.futOIChg > 0 ? '+' : ''}${formatNum(row.futOIChg)}`
                        : '—'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <div className="mt-2 text-[10px] text-muted-foreground">
            <strong>Futures OI Change</strong> shows real-time build-up/unwinding across all 19 symbols.
            <span className="text-emerald-400">OI ↑ + Basis ↑</span> = strong bullish positioning.
            <span className="text-red-400">OI ↑ + Basis ↓</span> = short buildup (bearish).
            Sorted by absolute OI change to surface the biggest moves.
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECTION 3: ATM + ITM Focus ═══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-emerald-400" />
            ATM + ITM Focus — {selectedSym ? (INDEX_NAMES[selectedIdx] || selectedIdx) : 'Nifty 50'}
            <Badge variant="outline" className="ml-2 text-[10px]">{atmItmData.length} strikes</Badge>
            {selectedSym && (
              <span className={`ml-auto font-mono text-sm font-bold ${changeColor(selectedSym.spotChange)}`}>
                {selectedSym.spotPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ({fmtPct(selectedSym.spotChange)})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {atmItmData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="py-1.5 pr-2 text-left font-medium">Strike</th>
                    <th className="py-1.5 pr-2 text-center font-medium">Type</th>
                    <th className="py-1.5 pr-2 text-right font-medium">CE OI</th>
                    <th className="py-1.5 pr-2 text-right font-medium">CE OI Δ</th>
                    <th className="py-1.5 pr-2 text-right font-medium">PE OI</th>
                    <th className="py-1.5 pr-2 text-right font-medium">PE OI Δ</th>
                    <th className="py-1.5 pr-2 text-right font-medium">CE Vol</th>
                    <th className="py-1.5 pr-2 text-right font-medium">PE Vol</th>
                    <th className="py-1.5 text-right font-medium">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {atmItmData.map(s => (
                    <tr key={s.strike} className={`border-b border-border/15 ${s.isATM ? 'bg-primary/10' : ''}`}>
                      <td className={`py-1.5 pr-2 font-mono font-bold ${s.isATM ? 'text-yellow-400' : 'text-foreground'}`}>
                        {s.strike.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-2 text-center">
                        <Badge variant="outline" className={`text-[10px] ${
                          s.isATM
                            ? 'border-yellow-500/40 text-yellow-300'
                            : s.strikeType.startsWith('ITM')
                              ? 'border-emerald-500/30 text-emerald-300'
                              : 'border-border/40'
                        }`}>
                          {s.strikeType}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.ceOI)}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${changeColor(s.ceOIChg)}`}>
                        {s.ceOIChg !== 0 ? `${s.ceOIChg > 0 ? '+' : ''}${formatNum(s.ceOIChg)}` : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.peOI)}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${changeColor(s.peOIChg)}`}>
                        {s.peOIChg !== 0 ? `${s.peOIChg > 0 ? '+' : ''}${formatNum(s.peOIChg)}` : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.ceVol)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.peVol)}</td>
                      <td className={`py-1.5 text-right text-[10px] ${
                        s.smartMoneySignal.includes('Bullish') ? 'text-emerald-400' :
                        s.smartMoneySignal.includes('Bearish') ? 'text-red-400' :
                        s.smartMoneySignal.includes('Unwinding') ? 'text-purple-400' :
                        s.smartMoneySignal.includes('Building') ? 'text-amber-400' :
                        'text-muted-foreground'
                      }`}>
                        {s.smartMoneySignal}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {selectedSym ? 'No strike data available for this index' : 'Select an index above'}
            </div>
          )}
          <div className="mt-2 text-[10px] text-muted-foreground">
            Shows ATM ± 2 strikes with real-time OI changes from Kite API.
            <span className="text-emerald-400">OI Build</span> = new positions being created.
            <span className="text-purple-400">Long Unwinding</span> = profitable positions closing.
            Click an index card above to switch.
          </div>
        </CardContent>
      </Card>

      {/* ═══ FOOTER ═══ */}
      <div className="text-center text-[10px] text-muted-foreground py-2">
        All data from {isLive ? 'Zerodha Kite API' : 'demo generator'} · FII/DII data not available via real-time API (published after 6 PM by NSE) · Futures OI + Basis = real-time institutional footprint
      </div>
    </div>
  );
}
