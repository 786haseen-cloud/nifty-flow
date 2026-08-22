'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Activity, TrendingUp, TrendingDown, Info, Zap,
  ShieldAlert, Thermometer, Wifi, WifiOff,
} from 'lucide-react';
import type { InstrumentData, VIXData, OptionStrike } from '@/lib/types';
import { formatNum } from '@/lib/demo-data';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import LiveAlignmentIndicator from './live-alignment';

const INDEX_NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50', SENSEX: 'Sensex', BANKNIFTY: 'Bank Nifty', FINNIFTY: 'Fin Nifty',
};

// Compute max pain from OI data
function computeMaxPain(strikes: { strike: number; ceOI: number; peOI: number }[]): number {
  if (strikes.length === 0) return 0;
  let minPain = Infinity;
  let maxPainStrike = strikes[0].strike;
  for (const s of strikes) {
    let pain = 0;
    for (const t of strikes) {
      if (t.ceOI > 0 && s.strike > t.strike) pain += t.ceOI * (s.strike - t.strike);
      if (t.peOI > 0 && s.strike < t.strike) pain += t.peOI * (t.strike - s.strike);
    }
    if (pain < minPain) { minPain = pain; maxPainStrike = s.strike; }
  }
  return maxPainStrike;
}

// Transform Kite snapshot into InstrumentData for the LIVE tab
function transformToInstrument(sym: ReturnType<typeof useKiteSnapshot>['curr'] extends null ? never : NonNullable<ReturnType<typeof useKiteSnapshot>['curr']>['symbols'][0]): InstrumentData | null {
  if (!sym || sym.strikes.length === 0) return null;
  const spotPrice = sym.spotPrice;
  const atmStrike = sym.strikes.find(s => s.isATM)?.strike || Math.round(spotPrice / sym.strikeStep) * sym.strikeStep;
  const totalCallOI = sym.strikes.reduce((s, t) => s + t.ceOI, 0);
  const totalPutOI = sym.strikes.reduce((s, t) => s + t.peOI, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
  const maxPain = computeMaxPain(sym.strikes);

  const optionStrikes: OptionStrike[] = sym.strikes.map(s => ({
    strike: s.strike,
    callLTP: s.ceLTP,
    callOI: s.ceOI,
    callOIChg: 0, // Need prev snapshot for this
    callVolume: s.ceVol,
    callIV: 0, // Not directly available from Kite quote
    callDelta: s.ceDelta,
    callGamma: 0,
    callTheta: 0,
    callVega: 0,
    callChg: 0,
    putLTP: s.peLTP,
    putOI: s.peOI,
    putOIChg: 0,
    putVolume: s.peVol,
    putIV: 0,
    putDelta: s.peDelta,
    putGamma: 0,
    putTheta: 0,
    putVega: 0,
    putChg: 0,
    isATM: s.isATM,
    builtUp: 'none' as const,
    callITM: s.strike < spotPrice,
    putITM: s.strike > spotPrice,
  }));

  return {
    symbol: sym.symbol,
    name: sym.name || INDEX_NAMES[sym.symbol] || sym.symbol,
    type: sym.type === 'index' ? 'index' : 'stock',
    cashLTP: spotPrice,
    cashChange: sym.spotChange,
    cashChangePercent: sym.spotChange,
    futureLTP: sym.futPrice,
    futureBasis: sym.futPrice > 0 ? Math.round((sym.futPrice - spotPrice) * 100) / 100 : 0,
    atmStrike,
    strikes: optionStrikes,
    totalCallOI,
    totalPutOI,
    pcr: Math.round(pcr * 100) / 100,
    chgOiPCR: 0,
    volumePCR: 0,
    maxPainStrike: maxPain,
  };
}

export default function LiveMonitor() {
  const { curr, prev } = useKiteSnapshot(15000);

  // Build instrument data from real Kite snapshot
  const indices = useMemo(() => {
    if (!curr || curr.mode === 'demo') return [];
    return ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY']
      .map(sym => curr.symbols.find(s => s.symbol === sym))
      .filter(Boolean)
      .map(s => transformToInstrument(s!))
      .filter(Boolean) as InstrumentData[];
  }, [curr]);

  // VIX from shared snapshot
  const vix: VIXData | null = useMemo(() => {
    if (!curr?.vix) return null;
    const v = curr.vix;
    return {
      value: v.value,
      change: v.change,
      changePercent: v.changePercent,
      dayHigh: v.dayHigh,
      dayLow: v.dayLow,
      dayOpen: v.dayOpen,
      trend: v.change > 0.5 ? 'rising' : v.change < -0.5 ? 'falling' : 'stable',
      percentile: Math.min(100, Math.max(0, (v.value / 30) * 100)),
      panicLevel: v.value > 22 ? 'panic' : v.value > 18 ? 'elevated' : v.value > 13 ? 'normal' : 'calm',
    };
  }, [curr?.vix]);

  const [selectedIdx, setSelectedIdx] = useState<string>('NIFTY');
  const selected = indices.find(i => i.symbol === selectedIdx) || indices[0];

  // Compute OI changes from prev snapshot for selected index
  const selectedSym = curr?.symbols.find(s => s.symbol === selectedIdx);
  const prevSym = prev?.symbols.find(s => s.symbol === selectedIdx);
  useEffect(() => {
    if (!selected || !selectedSym || !prevSym) return;
    // Update OI changes on the instrument
    const prevMap = new Map(prevSym.strikes.map(s => [s.strike, s]));
    for (const strike of selected.strikes) {
      const ps = prevMap.get(strike.strike);
      if (ps) {
        strike.callOIChg = strike.callOI - ps.ceOI;
        strike.putOIChg = strike.putOI - ps.peOI;
      }
    }
  }, [curr, prev, selectedIdx]);

  const panicLevelColor = (level: string) => {
    switch (level) {
      case 'calm': return 'text-emerald-400';
      case 'normal': return 'text-yellow-400';
      case 'elevated': return 'text-orange-400';
      case 'panic': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };
  const panicBarColor = (level: string) => {
    switch (level) {
      case 'calm': return 'bg-emerald-500';
      case 'normal': return 'bg-yellow-500';
      case 'elevated': return 'bg-orange-500';
      case 'panic': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };
  const panicPercent = vix ? (vix.value / 30) * 100 : 50;

  // No live data yet
  if (!curr || curr.symbols.length === 0) {
    return (
      <div className="space-y-4">
        <LiveAlignmentIndicator />
        <div className="flex items-center justify-center py-20 text-muted-foreground">
        <WifiOff className="mr-2 h-5 w-5" />
          Waiting for live data... {curr?.mode === 'demo' ? 'Showing demo' : 'Connect API key in Settings'}
        </div>
      </div>
    );
  }

  // Compute ATM theta (approximate) from option prices
  const callMelting = selected ? Math.max(1, Math.abs(selected.strikes.find(s => s.isATM)?.callLTP || 5) / 5).toFixed(0) : '0';
  const putMelting = selected ? Math.max(1, Math.abs(selected.strikes.find(s => s.isATM)?.putLTP || 5) / 5).toFixed(0) : '0';

  return (
    <div className="space-y-4">
      <LiveAlignmentIndicator />

      {/* VIX + Panic Meter + Theta */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-red-400" />
              India VIX
              <Badge variant="outline" className={`ml-auto text-[10px] ${curr.mode === 'live' ? 'border-emerald-500/40 text-emerald-300' : 'border-orange-500/40 text-orange-300'}`}>
                {curr.mode === 'live' ? <><Wifi className="mr-1 h-3 w-3" />LIVE</> : <><WifiOff className="mr-1 h-3 w-3" />DEMO</>}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vix ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-mono font-bold">{vix.value.toFixed(2)}</span>
                  <span className={`text-sm font-mono ${vix.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {vix.changePercent >= 0 ? '+' : ''}{vix.changePercent.toFixed(2)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>Open: <span className="font-mono text-foreground">{vix.dayOpen.toFixed(2)}</span></div>
                  <div>High: <span className="font-mono text-foreground">{vix.dayHigh.toFixed(2)}</span></div>
                  <div>Low: <span className="font-mono text-foreground">{vix.dayLow.toFixed(2)}</span></div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Trend: <span className={`font-medium ${vix.trend === 'rising' ? 'text-red-400' : vix.trend === 'falling' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {vix.trend.toUpperCase()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4">VIX data not available</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Panic Meter
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vix && (
              <div className="space-y-3">
                <div className={`text-2xl font-bold ${panicLevelColor(vix.panicLevel)}`}>
                  {vix.panicLevel.toUpperCase()}
                </div>
                <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                  <div className="absolute inset-y-0 left-0 w-1/4 bg-emerald-500/30 rounded-l-full" />
                  <div className="absolute inset-y-0 left-1/4 w-1/6 bg-yellow-500/30" />
                  <div className="absolute inset-y-0 left-[41%] w-1/6 bg-orange-500/30" />
                  <div className="absolute inset-y-0 left-[58%] w-[42%] bg-red-500/30 rounded-r-full" />
                  <div className={`absolute inset-y-0 ${panicBarColor(vix.panicLevel)} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, panicPercent)}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Calm</span><span>Normal</span><span>Elevated</span><span>Panic</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-cyan-400" />
              ATM Option Premiums
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground">CE ATM</span>
                  <div className="text-lg font-mono font-bold text-emerald-400">
                    {selected?.strikes.find(s => s.isATM)?.callLTP.toFixed(1) || '—'}
                  </div>
                </div>
                <div className="text-muted-foreground">vs</div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">PE ATM</span>
                  <div className="text-lg font-mono font-bold text-red-400">
                    {selected?.strikes.find(s => s.isATM)?.putLTP.toFixed(1) || '—'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                ATM option prices from {selected?.symbol || '—'} at strike {selected?.atmStrike || '—'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 Index Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {indices.map((inst) => (
          <Card key={inst.symbol}
            className={`cursor-pointer transition-all border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/40 ${
              selectedIdx === inst.symbol ? 'border-primary/60 ring-1 ring-primary/20' : ''
            }`}
            onClick={() => setSelectedIdx(inst.symbol)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{inst.name}</span>
                <span className={`text-xs ${inst.cashChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {inst.cashChange >= 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                </span>
              </div>
              <div className="text-xl font-mono font-bold">{inst.cashLTP.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
              <div className={`text-xs font-mono ${inst.cashChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {inst.cashChangePercent >= 0 ? '+' : ''}{inst.cashChangePercent.toFixed(2)}%
              </div>
              <div className="grid grid-cols-2 gap-1 mt-2 text-[10px] text-muted-foreground">
                <div>Fut: <span className="font-mono text-foreground">{inst.futureLTP > 0 ? inst.futureLTP.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'}</span></div>
                <div>Basis: <span className={`font-mono ${inst.futureBasis >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{inst.futureBasis >= 0 ? '+' : ''}{inst.futureBasis.toFixed(1)}</span></div>
                <div>PCR: <span className="font-mono text-foreground">{inst.pcr.toFixed(2)}</span></div>
                <div>MaxPain: <span className="font-mono text-foreground">{inst.maxPainStrike.toLocaleString()}</span></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Option Chain */}
      {selected && (
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-yellow-400" />
              {selected.name} Option Chain
              <Badge variant="outline" className="ml-2 text-xs">ATM: {selected.atmStrike.toLocaleString()}</Badge>
              <Badge variant="outline" className={`ml-auto text-[10px] ${curr.mode === 'live' ? 'border-emerald-500/40 text-emerald-300' : 'border-orange-500/40 text-orange-300'}`}>
                {curr.mode === 'live' ? <><Wifi className="mr-1 h-3 w-3" />LIVE</> : <><WifiOff className="mr-1 h-3 w-3" />DEMO</>}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th colSpan={5} className="py-1.5 text-center text-emerald-400/70 font-medium bg-emerald-500/5">CALLS</th>
                    <th className="py-1.5 text-center font-medium bg-primary/10">Strike</th>
                    <th colSpan={5} className="py-1.5 text-center text-red-400/70 font-medium bg-red-500/5">PUTS</th>
                  </tr>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">OI</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Chg</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Vol</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">LTP</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Delta</th>
                    <th className="py-1 text-center bg-primary/10">Price</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Delta</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">LTP</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Vol</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Chg</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">OI</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.strikes.map((s: OptionStrike) => (
                    <tr key={s.strike} className={`border-b border-border/15 ${s.isATM ? 'bg-primary/10 font-medium' : 'hover:bg-muted/20'}`}>
                      <td className={`py-1 pr-1 text-right font-mono text-muted-foreground`}>{formatNum(s.callOI)}</td>
                      <td className={`py-1 pr-1 text-right font-mono ${s.callOIChg > 0 ? 'text-emerald-400' : s.callOIChg < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {s.callOIChg !== 0 ? <>{s.callOIChg > 0 ? '+' : ''}{formatNum(s.callOIChg)}</> : '—'}
                      </td>
                      <td className="py-1 pr-1 text-right font-mono text-muted-foreground">{formatNum(s.callVolume)}</td>
                      <td className="py-1 pr-1 text-right font-mono font-medium">{s.callLTP.toFixed(1)}</td>
                      <td className="py-1 pr-1 text-right font-mono text-muted-foreground">{s.callDelta.toFixed(2)}</td>
                      <td className={`py-1 text-center font-mono font-bold ${s.isATM ? 'text-yellow-400' : s.callITM ? 'text-emerald-400' : s.putITM ? 'text-red-400' : 'text-foreground'}`}>
                        {s.strike.toLocaleString()}
                      </td>
                      <td className="py-1 pl-1 text-left font-mono text-muted-foreground">{s.putDelta.toFixed(2)}</td>
                      <td className="py-1 pl-1 text-left font-mono font-medium">{s.putLTP.toFixed(1)}</td>
                      <td className="py-1 pl-1 text-left font-mono text-muted-foreground">{formatNum(s.putVolume)}</td>
                      <td className={`py-1 pl-1 text-left font-mono ${s.putOIChg > 0 ? 'text-emerald-400' : s.putOIChg < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {s.putOIChg !== 0 ? <>{s.putOIChg > 0 ? '+' : ''}{formatNum(s.putOIChg)}</> : '—'}
                      </td>
                      <td className={`py-1 pl-1 text-left font-mono ${s.putOIChg > 0 ? 'text-emerald-400' : s.putOIChg < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{formatNum(s.putOI)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Real-time Stocks Table (from Kite) */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            F&O Stocks — Real-time Prices
            <Badge variant="outline" className="ml-auto text-[10px] border-blue-500/40 text-blue-300">
              {curr.mode === 'live' ? 'LIVE' : 'DEMO'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/40 text-muted-foreground">
                <th className="py-1.5 pr-2 text-left font-medium">Stock</th>
                <th className="py-1.5 pr-2 text-right font-medium">Spot Price</th>
                <th className="py-1.5 pr-2 text-right font-medium">Change %</th>
                <th className="py-1.5 pr-2 text-right font-medium">Fut Price</th>
                <th className="py-1.5 pr-2 text-right font-medium">Basis</th>
                <th className="py-1.5 pr-2 text-right font-medium">Fut OI</th>
              </tr>
            </thead>
            <tbody>
              {curr.symbols.filter(s => s.type === 'stock').map(s => (
                <tr key={s.symbol} className="border-b border-border/15 hover:bg-muted/20">
                  <td className="py-1.5 pr-2 font-medium">{s.name || s.symbol}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{s.spotPrice.toFixed(1)}</td>
                  <td className={`py-1.5 pr-2 text-right font-mono ${s.spotChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.spotChange >= 0 ? '+' : ''}{s.spotChange.toFixed(2)}%
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono">{s.futPrice > 0 ? s.futPrice.toFixed(1) : '—'}</td>
                  <td className={`py-1.5 pr-2 text-right font-mono ${(s.futPrice - s.spotPrice) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.futPrice > 0 ? <>{(s.futPrice - s.spotPrice) >= 0 ? '+' : ''}{(s.futPrice - s.spotPrice).toFixed(1)}</> : '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">{s.futOI > 0 ? ((s.futOI / 1000000).toFixed(2) + 'M') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
