'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity, TrendingUp, TrendingDown, Info, Zap,
  ShieldAlert, Thermometer,
} from 'lucide-react';
import type { InstrumentData, VIXData, OptionStrike } from '@/lib/types';
import {
  generateDemoInstrument,
  generateDemoVIX,
  generateDemoStocks,
  formatNum,
  getMarketStatus,
} from '@/lib/demo-data';
import type { StockQuickView } from '@/lib/demo-data';

export default function LiveMonitor() {
  const [vix, setVix] = useState<VIXData | null>(null);
  const [nifty, setNifty] = useState<InstrumentData | null>(null);
  const [sensex, setSensex] = useState<InstrumentData | null>(null);
  const [bankNifty, setBankNifty] = useState<InstrumentData | null>(null);
  const [finNifty, setFinNifty] = useState<InstrumentData | null>(null);
  const [stocks, setStocks] = useState<StockQuickView[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<string>('NIFTY');
  const [callMelting, setCallMelting] = useState(17.3);
  const [putMelting, setPutMelting] = useState(6.1);

  useEffect(() => {
    function refresh() {
      setVix(generateDemoVIX());
      setNifty(generateDemoInstrument('NIFTY', 'Nifty 50', 'index', 24350));
      setSensex(generateDemoInstrument('SENSEX', 'Sensex', 'index', 80100));
      setBankNifty(generateDemoInstrument('BANKNIFTY', 'Bank Nifty', 'index', 51800));
      setFinNifty(generateDemoInstrument('FINNIFTY', 'Fin Nifty', 'index', 23200));
      setStocks(generateDemoStocks());
      setCallMelting(parseFloat((Math.random() * 20 + 5).toFixed(1)));
      setPutMelting(parseFloat((Math.random() * 15 + 3).toFixed(1)));
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  const instruments = [nifty, sensex, bankNifty, finNifty].filter(Boolean) as InstrumentData[];
  const selected = instruments.find(i => i.symbol === selectedIdx) || nifty;

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

  return (
    <div className="space-y-4">
      {/* VIX + Panic Meter + Theta Melting */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* VIX Card */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-red-400" />
              India VIX
              <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />Indicator Only
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vix && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-mono font-bold">{vix.value.toFixed(2)}</span>
                  <span className={`text-sm font-mono ${vix.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {vix.change >= 0 ? '+' : ''}{vix.change.toFixed(2)} ({vix.changePercent >= 0 ? '+' : ''}{vix.changePercent.toFixed(2)}%)
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
                  {' '}| Percentile: <span className="font-mono">{vix.percentile.toFixed(0)}th</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panic Meter */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Panic Meter
              <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />Info Only
              </Badge>
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
                  <div
                    className={`absolute inset-y-0 ${panicBarColor(vix.panicLevel)} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, panicPercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Calm</span><span>Normal</span><span>Elevated</span><span>Panic</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Theta Melting */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-cyan-400" />
              Theta Melting Speed
              <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />Info Only
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground">Call Side</span>
                  <div className="text-lg font-mono font-bold text-emerald-400">
                    ₹{callMelting}/day
                    {callMelting > putMelting * 1.5 && <span className="text-orange-400 ml-1 text-xs">(FAST)</span>}
                  </div>
                </div>
                <div className="text-muted-foreground">← →</div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">Put Side</span>
                  <div className="text-lg font-mono font-bold text-red-400">
                    ₹{putMelting}/day
                    {putMelting > callMelting * 1.5 && <span className="text-orange-400 ml-1 text-xs">(FAST)</span>}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {callMelting > putMelting ? 'Call side melting faster → Put writers more confident' :
                 putMelting > callMelting ? 'Put side melting faster → Call writers more confident' :
                 'Both sides melting equally'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 Index Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {instruments.map((inst) => (
          <Card
            key={inst.symbol}
            className={`cursor-pointer transition-all border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/40 ${
              selectedIdx === inst.symbol ? 'border-primary/60 ring-1 ring-primary/20' : ''
            }`}
            onClick={() => setSelectedIdx(inst.symbol)}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{inst.name}</span>
                <span className={`text-xs ${inst.cashChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {inst.cashChange >= 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                </span>
              </div>
              <div className="text-xl font-mono font-bold">{inst.cashLTP.toLocaleString()}</div>
              <div className={`text-xs font-mono ${inst.cashChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {inst.cashChange >= 0 ? '+' : ''}{inst.cashChange.toFixed(2)} ({inst.cashChangePercent >= 0 ? '+' : ''}{inst.cashChangePercent.toFixed(2)}%)
              </div>
              <div className="grid grid-cols-2 gap-1 mt-2 text-[10px] text-muted-foreground">
                <div>Fut: <span className="font-mono text-foreground">{inst.futureLTP.toLocaleString()}</span></div>
                <div>Basis: <span className={`font-mono ${inst.futureBasis >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{inst.futureBasis >= 0 ? '+' : ''}{inst.futureBasis.toFixed(0)}</span></div>
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
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th colSpan={6} className="py-1.5 text-center text-emerald-400/70 font-medium bg-emerald-500/5">CALLS</th>
                    <th className="py-1.5 text-center font-medium bg-primary/10">Strike</th>
                    <th colSpan={6} className="py-1.5 text-center text-red-400/70 font-medium bg-red-500/5">PUTS</th>
                  </tr>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">OI</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Chg</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Vol</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">IV</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">LTP</th>
                    <th className="py-1 pr-1 text-right bg-emerald-500/5">Δ</th>
                    <th className="py-1 text-center bg-primary/10">₹</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Δ</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">LTP</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">IV</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Vol</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">Chg</th>
                    <th className="py-1 pl-1 text-left bg-red-500/5">OI</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.strikes.map((s: OptionStrike) => (
                    <tr
                      key={s.strike}
                      className={`border-b border-border/15 ${
                        s.isATM ? 'bg-primary/10 font-medium' : 'hover:bg-muted/20'
                      }`}
                    >
                      <td className={`py-1 pr-1 text-right font-mono ${s.callOIChg > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatNum(s.callOI)}
                      </td>
                      <td className={`py-1 pr-1 text-right font-mono ${s.callOIChg > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        {s.callOIChg > 0 ? '+' : ''}{formatNum(s.callOIChg)}
                      </td>
                      <td className="py-1 pr-1 text-right font-mono text-muted-foreground">{formatNum(s.callVolume)}</td>
                      <td className="py-1 pr-1 text-right font-mono">{s.callIV.toFixed(1)}</td>
                      <td className="py-1 pr-1 text-right font-mono font-medium">{s.callLTP.toFixed(1)}</td>
                      <td className="py-1 pr-1 text-right font-mono text-muted-foreground">{s.callDelta.toFixed(2)}</td>
                      <td className={`py-1 text-center font-mono font-bold ${s.isATM ? 'text-yellow-400' : s.callITM ? 'text-emerald-400' : s.putITM ? 'text-red-400' : 'text-foreground'}`}>
                        {s.strike.toLocaleString()}
                      </td>
                      <td className="py-1 pl-1 text-left font-mono text-muted-foreground">{s.putDelta.toFixed(2)}</td>
                      <td className="py-1 pl-1 text-left font-mono font-medium">{s.putLTP.toFixed(1)}</td>
                      <td className="py-1 pl-1 text-left font-mono">{s.putIV.toFixed(1)}</td>
                      <td className="py-1 pl-1 text-left font-mono text-muted-foreground">{formatNum(s.putVolume)}</td>
                      <td className={`py-1 pl-1 text-left font-mono ${s.putOIChg > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        {s.putOIChg > 0 ? '+' : ''}{formatNum(s.putOIChg)}
                      </td>
                      <td className={`py-1 pl-1 text-left font-mono ${s.putOIChg > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatNum(s.putOI)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Top 15 Stocks */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Top 15 F&amp;O Stocks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {stocks.map((s) => (
              <div key={s.symbol} className="p-2 rounded-md border border-border/30 hover:bg-muted/30 transition-colors">
                <div className="font-medium text-xs">{s.symbol}</div>
                <div className="font-mono text-sm font-bold">{s.ltp.toLocaleString()}</div>
                <div className={`text-[10px] font-mono ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)} ({s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%)
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  PCR: <span className="font-mono">{s.pcr.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
