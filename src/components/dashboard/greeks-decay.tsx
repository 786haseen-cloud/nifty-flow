'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Thermometer, ShieldAlert, Info, AlertTriangle,
  Activity, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import type { InstrumentData, VIXData, OptionStrike } from '@/lib/types';
import {
  generateDemoInstrument,
  generateDemoVIX,
} from '@/lib/demo-data';

export default function GreeksDecay() {
  const [vix, setVix] = useState<VIXData | null>(null);
  const [instrument, setInstrument] = useState<InstrumentData | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<string>('ATM');

  useEffect(() => {
    function refresh() {
      const v = generateDemoVIX();
      const inst = generateDemoInstrument('NIFTY', 'Nifty 50', 'index', 24350);
      setVix(v);
      setInstrument(inst);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  const panicLevelLabel = (level: string) => {
    switch (level) {
      case 'calm': return 'CALM';
      case 'normal': return 'NORMAL';
      case 'elevated': return 'ELEVATED';
      case 'panic': return 'PANIC';
      default: return level.toUpperCase();
    }
  };

  const panicColor = (level: string) => {
    switch (level) {
      case 'calm': return 'text-emerald-400';
      case 'normal': return 'text-yellow-400';
      case 'elevated': return 'text-orange-400';
      case 'panic': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };

  const panicPercent = vix ? Math.min(100, (vix.value / 30) * 100) : 50;

  // Theta decay data for chart
  const thetaDecayData = instrument?.strikes.filter(s => {
    const diff = Math.abs(s.strike - instrument.atmStrike);
    return diff <= (instrument.symbol === 'NIFTY' ? 150 : 300);
  }).map(s => ({
    strike: s.strike.toString(),
    callTheta: Math.abs(s.callTheta),
    putTheta: Math.abs(s.putTheta),
    callIV: s.callIV,
    putIV: s.putIV,
  })) || [];

  // IV Skew
  const ivSkewData = instrument?.strikes.filter(s => {
    const diff = Math.abs(s.strike - instrument.atmStrike);
    return diff <= (instrument.symbol === 'NIFTY' ? 200 : 400);
  }).map(s => ({
    strike: s.strike.toString(),
    callIV: s.callIV,
    putIV: s.putIV,
    skew: s.putIV - s.callIV,
  })) || [];

  // Selected strike Greeks
  const strikeData = selectedStrike === 'ATM'
    ? instrument?.strikes.find(s => s.isATM)
    : instrument?.strikes.find(s => s.strike.toString() === selectedStrike);

  return (
    <div className="space-y-4">
      {/* INFO banner */}
      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0" />
        <span className="font-medium">INFORMATIONAL — These indicators do NOT drive trading signals. Theta &amp; VIX are for context only.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Panic Meter Large */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Panic Meter
              <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />Info Only
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vix && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${panicColor(vix.panicLevel)}`}>
                    {panicLevelLabel(vix.panicLevel)}
                  </div>
                  <div className="text-2xl font-mono mt-2">{vix.value.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">India VIX</div>
                </div>
                <div className="relative h-8 rounded-full bg-muted overflow-hidden">
                  <div className="absolute inset-y-0 left-0 w-[16%] bg-emerald-500/40 rounded-l-full flex items-center justify-center text-[10px] font-medium text-emerald-200">
                    {vix.panicLevel === 'calm' ? '●' : ''}
                  </div>
                  <div className="absolute inset-y-0 left-[16%] w-[20%] bg-yellow-500/40 flex items-center justify-center text-[10px] font-medium text-yellow-200">
                    {vix.panicLevel === 'normal' ? '●' : ''}
                  </div>
                  <div className="absolute inset-y-0 left-[36%] w-[24%] bg-orange-500/40 flex items-center justify-center text-[10px] font-medium text-orange-200">
                    {vix.panicLevel === 'elevated' ? '●' : ''}
                  </div>
                  <div className="absolute inset-y-0 left-[60%] w-[40%] bg-red-500/40 rounded-r-full flex items-center justify-center text-[10px] font-medium text-red-200">
                    {vix.panicLevel === 'panic' ? '●' : ''}
                  </div>
                  <div
                    className="absolute inset-y-0 w-1.5 bg-white rounded-full shadow-lg transition-all duration-700"
                    style={{ left: `${Math.min(98, panicPercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Calm (&lt;12)</span><span>Normal (12-16)</span><span>Elevated (16-20)</span><span>Panic (&gt;20)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">VIX Percentile</span>
                    <div className="font-mono font-bold">{vix.percentile.toFixed(0)}th</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trend</span>
                    <div className={`font-bold ${vix.trend === 'rising' ? 'text-red-400' : vix.trend === 'falling' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {vix.trend.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Day Range</span>
                    <div className="font-mono">{vix.dayLow.toFixed(1)} - {vix.dayHigh.toFixed(1)}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Melting Speed */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Thermometer className="h-4 w-4 text-cyan-400" />
              Melting Speed Comparison
              <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />Info Only
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={thetaDecayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="strike" tick={{ fill: '#888', fontSize: 10 }} />
                <YAxis tick={{ fill: '#888', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => [`₹${value.toFixed(1)}/day`, '']}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="callTheta" fill="#10b981" name="Call |θ|" radius={[4, 4, 0, 0]} />
                <Bar dataKey="putTheta" fill="#ef4444" name="Put |θ|" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-muted-foreground">
              Higher theta = faster premium decay. The side melting faster indicates which option writers are more confident.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* IV Skew */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-purple-400" />
            IV Skew — Fear Premium Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={ivSkewData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="strike" tick={{ fill: '#888', fontSize: 10 }} />
              <YAxis tick={{ fill: '#888', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="callIV" stroke="#10b981" strokeWidth={2} name="Call IV" />
              <Line type="monotone" dataKey="putIV" stroke="#ef4444" strokeWidth={2} name="Put IV" />
              <Line type="monotone" dataKey="skew" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 5" name="Skew (Put-Call)" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 text-xs text-muted-foreground">
            Put IV &gt; Call IV = Fear premium (protective puts in demand). Higher skew = more bearish sentiment among option buyers.
          </div>
        </CardContent>
      </Card>

      {/* Full Greeks Table */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            Full Greeks Table — {instrument?.name || 'Nifty 50'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">Strike</th>
                  <th className="py-1.5 pr-2 text-center font-medium" colSpan={6}>Call Greeks</th>
                  <th className="py-1.5 pr-2 text-center font-medium" colSpan={6}>Put Greeks</th>
                </tr>
                <tr className="border-b border-border/30 text-muted-foreground">
                  <th className="py-1 pr-2 text-left">₹</th>
                  <th className="py-1 pr-2 text-right">IV</th>
                  <th className="py-1 pr-2 text-right">Δ</th>
                  <th className="py-1 pr-2 text-right">Γ</th>
                  <th className="py-1 pr-2 text-right">Θ</th>
                  <th className="py-1 pr-2 text-right">Vega</th>
                  <th className="py-1 pr-2 text-right">LTP</th>
                  <th className="py-1 pr-2 text-right">IV</th>
                  <th className="py-1 pr-2 text-right">Δ</th>
                  <th className="py-1 pr-2 text-right">Γ</th>
                  <th className="py-1 pr-2 text-right">Θ</th>
                  <th className="py-1 pr-2 text-right">Vega</th>
                  <th className="py-1 pr-2 text-right">LTP</th>
                </tr>
              </thead>
              <tbody>
                {instrument?.strikes.map((s: OptionStrike) => (
                  <tr key={s.strike} className={`border-b border-border/15 ${s.isATM ? 'bg-primary/10' : 'hover:bg-muted/20'}`}>
                    <td className={`py-1 pr-2 font-mono font-bold ${s.isATM ? 'text-yellow-400' : 'text-foreground'}`}>
                      {s.strike.toLocaleString()}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{s.callIV.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono text-emerald-400">{s.callDelta.toFixed(3)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.callGamma.toFixed(4)}</td>
                    <td className="py-1 pr-2 text-right font-mono text-red-400">{s.callTheta.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.callVega.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono font-medium">{s.callLTP.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.putIV.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono text-red-400">{s.putDelta.toFixed(3)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.putGamma.toFixed(4)}</td>
                    <td className="py-1 pr-2 text-right font-mono text-red-400">{s.putTheta.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.putVega.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right font-mono font-medium">{s.putLTP.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* IV Rank / Percentile */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">IV Rank &amp; Percentile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {instrument?.strikes.filter(s => {
              const diff = Math.abs(s.strike - instrument.atmStrike);
              return diff <= (instrument.symbol === 'NIFTY' ? 100 : 200);
            }).map(s => {
              const ivRank = Math.round(Math.random() * 100);
              const ivPercentile = Math.round(Math.random() * 100);
              return (
                <div key={s.strike} className="p-3 rounded-lg border border-border/30">
                  <div className="text-sm font-mono font-bold">{s.strike.toLocaleString()}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">IV Rank</span>
                      <div className="font-mono font-bold">{ivRank}%</div>
                      <Progress value={ivRank} className="h-1.5 mt-1" />
                    </div>
                    <div>
                      <span className="text-muted-foreground">IV %ile</span>
                      <div className="font-mono font-bold">{ivPercentile}%</div>
                      <Progress value={ivPercentile} className="h-1.5 mt-1" />
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Call IV: {s.callIV.toFixed(1)}% | Put IV: {s.putIV.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
