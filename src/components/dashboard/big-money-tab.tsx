'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Landmark, Users, ArrowUpRight, ArrowDownRight, Minus,
  AlertCircle, TrendingUp,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import type { DayComparison, BigTradeEntry, NiftyDivergencePoint, InstrumentData, PlayerFlow, DualExchangeStock, MarketDataContext } from '@/lib/types';
import {
  generateDemo3DayComparison,
  generateDemoBigTrades,
  generateDemoNiftyDivergence,
  generateDemoInstrument,
  generateDemoDualExchangeStocks,
  generateDemoMarketDataContext,
  formatNum,
  formatCr,
} from '@/lib/demo-data';
import WeightedCashFlowChart from '@/components/dashboard/weighted-cash-flow';

export default function BigMoneyTab() {
  const [dayComparison, setDayComparison] = useState<DayComparison[]>([]);
  const [bigTrades, setBigTrades] = useState<BigTradeEntry[]>([]);
  const [divergence, setDivergence] = useState<NiftyDivergencePoint[]>([]);
  const [instrument, setInstrument] = useState<InstrumentData | null>(null);
  const [dualExchangeStocks, setDualExchangeStocks] = useState<DualExchangeStock[]>([]);
  const [marketContext, setMarketContext] = useState<MarketDataContext | null>(null);

  useEffect(() => {
    function refresh() {
      setDayComparison(generateDemo3DayComparison());
      setBigTrades(generateDemoBigTrades());
      setDivergence(generateDemoNiftyDivergence());
      setInstrument(generateDemoInstrument('NIFTY', 'Nifty 50', 'index', 24350));
      setDualExchangeStocks(generateDemoDualExchangeStocks());
      setMarketContext(generateDemoMarketDataContext());
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const flowColor = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const flowSign = (v: number) => v >= 0 ? '+' : '';
  const trendArrow = (current: number, previous: number) => {
    if (current > previous) return <ArrowUpRight className="inline h-3 w-3 text-emerald-400" />;
    if (current < previous) return <ArrowDownRight className="inline h-3 w-3 text-red-400" />;
    return <Minus className="inline h-3 w-3 text-muted-foreground" />;
  };

  // FII vs Client contrarian chart data
  const contrarianData = dayComparison.map(d => ({
    label: d.label,
    FII: d.fii.totalNet / 100,
    Client: d.client.totalNet / 100,
  }));

  const playerColor = (p: string) => {
    switch (p) {
      case 'FII': return 'text-red-400';
      case 'PROPDESK': return 'text-purple-400';
      case 'CLIENT': return 'text-cyan-400';
      case 'DII': return 'text-emerald-400';
      default: return 'text-foreground';
    }
  };

  const playerBg = (p: string) => {
    switch (p) {
      case 'FII': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'PROPDESK': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'CLIENT': return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
      case 'DII': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      default: return 'bg-gray-500/20 text-gray-300';
    }
  };

  return (
    <div className="space-y-4">
      {/* Data Awareness Card — Live vs After-Market */}
      <Card className={`border-border/50 backdrop-blur-sm ${
        marketContext?.availability === 'live_flow_only'
          ? 'bg-amber-500/5 border-amber-500/30'
          : 'bg-emerald-500/5 border-emerald-500/30 bg-card/80'
      }`}>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 mb-1">
                <Badge className={`text-[10px] ${
                  marketContext?.availability === 'live_flow_only'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}>
                  {marketContext?.availability === 'live_flow_only' ? '🔴 LIVE MARKET' : '🟢 AFTER-MARKET'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {marketContext?.availability === 'live_flow_only'
                    ? 'Only Money Flow visible — WHO is behind it is unknown'
                    : 'NSE participant data available — Full correlation possible'
                  }
                </span>
              </div>
              {marketContext?.correlationMessage && (
                <div className="text-[10px] text-muted-foreground">
                  {marketContext.correlationMessage}
                </div>
              )}
            </div>
            {marketContext?.availability === 'live_flow_only' && marketContext.liveInference && (
              <div className="flex flex-wrap gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Net Flow: </span>
                  <span className={`font-mono font-bold ${marketContext.liveInference.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(marketContext.liveInference.netFlow / 10000000).toFixed(1)} Cr
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Velocity: </span>
                  <span className="font-mono">{marketContext.liveInference.flowVelocity.toFixed(1)} Cr/min</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Institutional: </span>
                  <span className={marketContext.liveInference.likelyInstitutional ? 'text-orange-400 font-bold' : 'text-muted-foreground'}>
                    {marketContext.liveInference.likelyInstitutional ? 'LIKELY YES' : 'Uncertain'}
                  </span>
                </div>
              </div>
            )}
            {marketContext?.availability === 'after_market_available' && marketContext.rollingWindow && (
              <div className="flex flex-wrap gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">FII 3D: </span>
                  <span className={`font-mono font-bold ${marketContext.rollingWindow.totalFIINet3D >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {marketContext.rollingWindow.totalFIINet3D >= 0 ? '+' : ''}{marketContext.rollingWindow.totalFIINet3D.toFixed(0)} Cr
                  </span>
                  <span className={`ml-1 text-[10px] ${marketContext.rollingWindow.fiiTrend === 'accumulating' ? 'text-emerald-400' : marketContext.rollingWindow.fiiTrend === 'distributing' ? 'text-red-400' : 'text-muted-foreground'}`}>
                    ({marketContext.rollingWindow.fiiTrend})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">PropDesk: </span>
                  <span className={`font-mono font-bold ${marketContext.rollingWindow.totalPropDeskNet3D >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {marketContext.rollingWindow.totalPropDeskNet3D >= 0 ? '+' : ''}{marketContext.rollingWindow.totalPropDeskNet3D.toFixed(0)} Cr
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Client: </span>
                  <span className="font-mono">{marketContext.rollingWindow.totalClientNet3D.toFixed(0)} Cr</span>
                  <span className={`ml-1 text-[10px] ${marketContext.rollingWindow.clientTrend === 'contrarian_bullish' ? 'text-emerald-400' : marketContext.rollingWindow.clientTrend === 'contrarian_bearish' ? 'text-red-400' : 'text-muted-foreground'}`}>
                    ({marketContext.rollingWindow.clientTrend.replace('contrarian_', '')})
                  </span>
                </div>
              </div>
            )}
            <div className="text-[10px] text-amber-400/70 max-w-md">
              Retailers cannot move the market in minutes. Only big money flow indicates institutional activity.
              3-day data tells the story — after NSE releases data, we correlate WHO did WHAT.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section A: 3-Day Prediction Compass — NOT the main driver */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-amber-400" />
            3-Day Prediction Compass
            <Badge variant="outline" className="ml-auto text-[10px] text-amber-300 border-amber-500/30">
              ALIGNMENT CHECK ONLY
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">Player</th>
                  <th className="py-1.5 pr-2 text-left font-medium">Segment</th>
                  {dayComparison.map(d => (
                    <th key={d.label} className="py-1.5 pr-2 text-right font-medium">{d.label}<br /><span className="text-[9px]">{d.date}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['fii', 'propdesk', 'client', 'dii'] as const).map((player) => {
                  const playerLabel = player === 'fii' ? 'FII' : player === 'propdesk' ? 'PropDesk' : player === 'client' ? 'Client' : 'DII (Cash Only)';
                  const segments = player === 'dii' ? ['cashNet'] : ['cashNet', 'futNet', 'optCallNet', 'optPutNet', 'totalNet'];
                  const segmentLabels = player === 'dii'
                    ? ['Cash Net']
                    : ['Cash Net', 'Fut Net', 'Opt Call Net', 'Opt Put Net', 'Total'];

                  return segments.map((seg, si) => (
                    <tr key={`${player}-${seg}`} className={`border-b border-border/15 ${si === 0 ? '' : ''} ${seg === 'totalNet' ? 'font-medium bg-muted/20' : ''}`}>
                      {si === 0 && (
                        <td rowSpan={segments.length} className={`py-1 pr-2 font-bold ${playerColor(playerLabel.split(' ')[0])}`} valign="top">
                          {playerLabel}
                        </td>
                      )}
                      <td className="py-1 pr-2 text-muted-foreground">{segmentLabels[si]}</td>
                      {dayComparison.map((d, di) => {
                        const data = d[player] as PlayerFlow;
                        const val = data[seg as keyof PlayerFlow] as number;
                        const prevVal = di > 0 ? (dayComparison[di - 1][player] as PlayerFlow)[seg as keyof PlayerFlow] as number : 0;
                        return (
                          <td key={d.label} className={`py-1 pr-2 text-right font-mono ${flowColor(val)}`}>
                            {flowSign(val)}{formatCr(val)}
                            {di > 0 && <span className="ml-1">{trendArrow(val, prevVal)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </ScrollArea>
          <div className="mt-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-300/80">
            <strong>⚠️ This is PREDICTION only, not action.</strong> 3-day data tells you where market <em>should</em> go.
            LIVE options OI + cash flow tell you where it <em>actually</em> goes.
            Use this as alignment: if LIVE direction matches 3-day prediction → trade with confidence.
            If CONFLICT → wait or trade smaller. Live data is always the primary driver.
          </div>
        </CardContent>
      </Card>

      {/* Section B: FII vs Client Contrarian Chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-purple-400" />
              FII vs Client (Contrarian View)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={contrarianData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => [`₹${value.toFixed(0)} Cr`, '']}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="FII" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="FII Net" />
                <Line type="monotone" dataKey="Client" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4 }} name="Client Net" />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-muted-foreground">
              When FII &amp; Client are <span className="text-red-400">opposite</span> → FII is setting up a move.
              When <span className="text-emerald-400">aligned</span> → Trend is strong.
            </div>
          </CardContent>
        </Card>

        {/* Section D: Nifty vs FII Divergence */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              Nifty Price vs FII Net Flow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={divergence}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" tick={{ fill: '#888', fontSize: 10 }} interval={4} />
                <YAxis yAxisId="left" tick={{ fill: '#888', fontSize: 10 }} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#888', fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="left" type="monotone" dataKey="niftyPrice" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} name="Nifty Price" />
                <Area yAxisId="right" type="monotone" dataKey="fiiNetFlow" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} name="FII Net Flow (₹Cr)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-muted-foreground">
              🔴 Price ↑ + FII selling → <span className="text-red-400">Bearish divergence</span>
              {' '}| 🟢 Price ↓ + FII buying → <span className="text-emerald-400">Bullish divergence</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section C: ATM + ITM Focus */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            ATM + ITM Focus — Where Smart Money Trades
            <Badge variant="outline" className="ml-2 text-[10px]">FII &amp; PropDesk focus ATM+ITM</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {instrument && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="py-1.5 pr-2 text-left font-medium">Strike</th>
                    <th className="py-1.5 pr-2 text-center font-medium">Type</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Call OI</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Call OI Chg</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Put OI</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Put OI Chg</th>
                    <th className="py-1.5 text-right font-medium">FII/PropDesk Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {instrument.strikes.filter(s => {
                    const diff = Math.abs(s.strike - instrument.atmStrike);
                    const step = instrument.symbol === 'NIFTY' ? 50 : 100;
                    return diff <= step * 2;
                  }).map(s => {
                    const diff = s.strike - instrument.atmStrike;
                    const step = instrument.symbol === 'NIFTY' ? 50 : 100;
                    let strikeType = 'ATM';
                    if (diff < 0) strikeType = `ITM Call ${Math.abs(diff / step)}`;
                    if (diff > 0) strikeType = `ITM Put ${Math.abs(diff / step)}`;

                    const smartMoneySignal = s.callOIChg > 100000 && s.putOIChg < 0 ? 'Call Writing (Bullish)' :
                      s.putOIChg > 100000 && s.callOIChg < 0 ? 'Put Writing (Bearish)' :
                      s.callOIChg > 50000 ? 'Call OI Buildup' :
                      s.putOIChg > 50000 ? 'Put OI Buildup' : '—';

                    return (
                      <tr key={s.strike} className={`border-b border-border/15 ${s.isATM ? 'bg-primary/10' : ''}`}>
                        <td className={`py-1.5 pr-2 font-mono font-bold ${s.isATM ? 'text-yellow-400' : 'text-foreground'}`}>
                          {s.strike.toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-2 text-center">
                          <Badge variant="outline" className={`text-[10px] ${s.isATM ? 'border-yellow-500/40 text-yellow-300' : 'border-border/40'}`}>
                            {strikeType}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.callOI)}</td>
                        <td className={`py-1.5 pr-2 text-right font-mono ${s.callOIChg > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.callOIChg > 0 ? '+' : ''}{formatNum(s.callOIChg)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{formatNum(s.putOI)}</td>
                        <td className={`py-1.5 pr-2 text-right font-mono ${s.putOIChg > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.putOIChg > 0 ? '+' : ''}{formatNum(s.putOIChg)}
                        </td>
                        <td className={`py-1.5 text-right text-[10px] ${
                          smartMoneySignal.includes('Bullish') ? 'text-emerald-400' :
                          smartMoneySignal.includes('Bearish') ? 'text-red-400' : 'text-muted-foreground'
                        }`}>
                          {smartMoneySignal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section E: Big Trades Timeline */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-cyan-400" />
            Biggest Trades Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-1.5">
              {bigTrades.slice(0, 20).map((t, i) => (
                <div key={i} className="flex items-center gap-3 text-xs p-2 rounded-md hover:bg-muted/30 transition-colors">
                  <span className="text-muted-foreground font-mono whitespace-nowrap">
                    {t.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <Badge className={`text-[10px] shrink-0 ${playerBg(t.player)}`}>
                    {t.player}
                  </Badge>
                  <span className="font-medium">{t.instrument}</span>
                  <span className="text-muted-foreground">{t.tradeType}</span>
                  <Badge variant="outline" className={`text-[10px] ${t.action === 'BUY' ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
                    {t.action}
                  </Badge>
                  <span className="font-mono text-muted-foreground">{formatNum(t.quantity)}</span>
                  <span className="font-mono">₹{t.value.toFixed(1)}</span>
                  {t.strike && <span className="text-muted-foreground font-mono">Strike: {t.strike.toLocaleString()}</span>}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Section F: Net Money Flow Summary — Heavy Weight Stocks */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            Net Money Flow — Heavy Weight Stocks (NSE + BSE)
            <Badge variant="outline" className="ml-2 text-[10px]">Money In − Money Out</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dualExchangeStocks.length > 0 && (
            <>
              {/* Total Net Flow */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {(() => {
                  const totalIn = dualExchangeStocks.reduce((s, d) => s + d.totalMoneyIn, 0);
                  const totalOut = dualExchangeStocks.reduce((s, d) => s + d.totalMoneyOut, 0);
                  const totalNet = totalIn - totalOut;
                  return (
                    <>
                      <div className="p-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 text-center">
                        <div className="text-[10px] text-emerald-400">Total Money In</div>
                        <div className="text-sm font-mono font-bold text-emerald-400">{(totalIn / 10000000).toFixed(1)} Cr</div>
                      </div>
                      <div className="p-2 rounded-md border border-red-500/20 bg-red-500/5 text-center">
                        <div className="text-[10px] text-red-400">Total Money Out</div>
                        <div className="text-sm font-mono font-bold text-red-400">{(totalOut / 10000000).toFixed(1)} Cr</div>
                      </div>
                      <div className={`p-2 rounded-md border text-center ${totalNet >= 0 ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                        <div className={`text-[10px] ${totalNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Net Money Flow</div>
                        <div className={`text-sm font-mono font-bold ${totalNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {totalNet >= 0 ? '+' : ''}{(totalNet / 10000000).toFixed(1)} Cr
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Per-stock breakdown */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="py-1.5 pr-2 text-left font-medium">Stock</th>
                      <th className="py-1.5 pr-2 text-right font-medium">NSE Net</th>
                      <th className="py-1.5 pr-2 text-right font-medium">BSE Net</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Combined</th>
                      <th className="py-1.5 pr-2 text-right font-medium">NSE-BSE</th>
                      <th className="py-1.5 text-center font-medium">Dominant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dualExchangeStocks.map((s) => (
                      <tr key={s.symbol} className="border-b border-border/15 hover:bg-muted/20">
                        <td className="py-1 pr-2 font-medium">{s.symbol}</td>
                        <td className={`py-1 pr-2 text-right font-mono ${s.nse.netMoneyFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(s.nse.netMoneyFlow / 10000000).toFixed(1)} Cr
                        </td>
                        <td className={`py-1 pr-2 text-right font-mono ${s.bse.netMoneyFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(s.bse.netMoneyFlow / 10000000).toFixed(1)} Cr
                        </td>
                        <td className={`py-1 pr-2 text-right font-mono font-bold ${s.combinedNetFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.combinedNetFlowCr >= 0 ? '+' : ''}{s.combinedNetFlowCr.toFixed(1)} Cr
                        </td>
                        <td className={`py-1 pr-2 text-right font-mono ${Math.abs(s.nseBseDiff) > 2 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                          {s.nseBseDiff > 0 ? '+' : ''}{s.nseBseDiff.toFixed(1)}
                        </td>
                        <td className="py-1 text-center">
                          <Badge variant="outline" className={`text-[9px] ${
                            s.dominantExchange === 'NSE' ? 'border-blue-500/30 text-blue-300' :
                            s.dominantExchange === 'BSE' ? 'border-purple-500/30 text-purple-300' :
                            'border-gray-500/30 text-gray-400'
                          }`}>
                            {s.dominantExchange}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="mt-3 text-xs text-muted-foreground">
            <strong>Net Money Flow</strong> tracks actual capital moving in/out of each stock across <strong>NSE + BSE</strong>.
            Same stock (e.g., Reliance) has <strong>different buyers &amp; sellers</strong> on each exchange.
            NSE-BSE price differences &gt; ₹2 may indicate arbitrage opportunity.
          </div>
        </CardContent>
      </Card>

      {/* Weighted Cash Flow Bar Chart — Pine Script Converted */}
      <WeightedCashFlowChart />
    </div>
  );
}
