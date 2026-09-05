'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, Activity, BarChart3, Info,
} from 'lucide-react';
import type { WeightedCashFlowBar, CashFlowTrend } from '@/lib/types';
import {
  generateDemoWeightedCashFlowBars,
  generateDemoCashFlowTrend,
  formatCr,
} from '@/lib/demo-data';

// Stock base prices with weights (for Sensex weight lookup in table)
// Weights: Sep 2026 rebalance — kept in sync with types.ts TOP_STOCKS
const STOCK_CONFIG = [
  { symbol: 'HDFCBANK',  sensexWeight: 11.92 },
  { symbol: 'ICICIBANK', sensexWeight: 11.26 },
  { symbol: 'RELIANCE',  sensexWeight: 9.67 },
  { symbol: 'BHARTIARTL',sensexWeight: 6.39 },
  { symbol: 'LT',        sensexWeight: 5.09 },
  { symbol: 'SBIN',      sensexWeight: 4.67 },
  { symbol: 'INFY',      sensexWeight: 4.43 },
  { symbol: 'AXISBANK',  sensexWeight: 3.95 },
  { symbol: 'KOTAKBANK', sensexWeight: 3.42 },
  { symbol: 'M&M',       sensexWeight: 3.18 },
  { symbol: 'BAJFINANCE',sensexWeight: 3.09 },
  { symbol: 'ITC',       sensexWeight: 2.81 },
  { symbol: 'TCS',       sensexWeight: 2.64 },
  { symbol: 'ETERNAL',   sensexWeight: 2.59 },
  { symbol: 'TITAN',     sensexWeight: 2.28 },
];

export default function WeightedCashFlowChart() {
  const [bars, setBars] = useState<WeightedCashFlowBar[]>([]);
  const [trend, setTrend] = useState<CashFlowTrend | null>(null);

  useEffect(() => {
    function refresh() {
      setBars(generateDemoWeightedCashFlowBars(60)); // Last 15 minutes (4 bars/min × 15 min)
      setTrend(generateDemoCashFlowTrend());
    }
    refresh();
    const interval = setInterval(refresh, 15000); // Every 15 seconds = 4 bars/min
    return () => clearInterval(interval);
  }, []);

  // Transform bars for Recharts — green=Money In, red=Money Out, blue=Net Flow
  const chartData = bars.map((bar) => ({
    time: bar.timestamp.slice(0, 5), // HH:MM
    moneyIn: bar.totalMoneyIn / 10000000,
    moneyOut: -bar.totalMoneyOut / 10000000, // Negative for visual below zero
    netFlow: bar.netFlow / 10000000,
    niftyCF: bar.niftyWeightedCF / 10000000,
  }));

  // Latest bar summary
  const latestBar = bars[bars.length - 1];
  const totalIn = bars.reduce((s, b) => s + b.totalMoneyIn, 0);
  const totalOut = bars.reduce((s, b) => s + b.totalMoneyOut, 0);
  const totalNet = totalIn - totalOut;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground">Nifty Weighted CF</div>
            <div className={`text-lg font-mono font-bold ${latestBar && latestBar.niftyWeightedCF >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {latestBar ? formatCr(latestBar.niftyWeightedCF) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">Latest 15s bar</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5 backdrop-blur-sm">
          <CardContent className="p-3 text-center">
            <div className="text-[10px] text-emerald-400">Total Money In</div>
            <div className="text-lg font-mono font-bold text-emerald-400">
              {formatCr(totalIn)}
            </div>
            <div className="text-[10px] text-muted-foreground">15 min total</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5 backdrop-blur-sm">
          <CardContent className="p-3 text-center">
            <div className="text-[10px] text-red-400">Total Money Out</div>
            <div className="text-lg font-mono font-bold text-red-400">
              {formatCr(totalOut)}
            </div>
            <div className="text-[10px] text-muted-foreground">15 min total</div>
          </CardContent>
        </Card>
        <Card className={`border-blue-500/20 backdrop-blur-sm ${totalNet >= 0 ? 'bg-blue-500/5' : 'bg-red-500/5'}`}>
          <CardContent className="p-3 text-center">
            <div className={`text-[10px] ${totalNet >= 0 ? 'text-blue-400' :'text-red-400'}`}>Net Flow</div>
            <div className={`text-lg font-mono font-bold ${totalNet >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
              {totalNet >= 0 ? '+' : ''}{formatCr(totalNet)}
            </div>
            <div className="text-[10px] text-muted-foreground">In − Out</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart: Bar chart with Money In (green) / Money Out (red) / Net Flow (blue) */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            Weighted Cash Flow — Impact on Nifty50
            <Badge variant="outline" className="ml-2 text-[10px] border-emerald-500/40 text-emerald-300">
              Green=In
            </Badge>
            <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">
              Red=Out
            </Badge>
            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-300">
              Blue=Net
            </Badge>
            <Badge variant="outline" className="ml-auto text-[10px]">
              4 bars/min (15s)
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#888', fontSize: 9 }}
                  interval={3}
                />
                <YAxis
                  tick={{ fill: '#888', fontSize: 9 }}
                  tickFormatter={(v: number) => `${v.toFixed(0)} Cr`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a1a2e',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string) => {
                    const label = name === 'moneyIn' ? 'Money In' :
                                  name === 'moneyOut' ? 'Money Out' :
                                  name === 'netFlow' ? 'Net Flow' : name;
                    return [`${value.toFixed(2)} Cr`, label];
                  }}
                  labelFormatter={(label: string) => `IST ${label}`}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Bar dataKey="moneyIn" fill="#22c55e" fillOpacity={0.7} name="Money In" isAnimationActive={false} />
                <Bar dataKey="moneyOut" fill="#ef4444" fillOpacity={0.7} name="Money Out" isAnimationActive={false} />
                <Line type="monotone" dataKey="netFlow" stroke="#3b82f6" strokeWidth={2} dot={false} name="Net Flow" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Each bar = 15 seconds of <strong>weighted cash flow</strong> across all 15 stocks.
            Stock impact on Nifty50 calculated as per weightage (HDFCBANK 9.97%, ICICIBANK 9.09%, etc.).
            <strong> CashFlow = (Close − Open) × Volume × Weight%</strong> — converted from your Pine Script.
          </div>
        </CardContent>
      </Card>

      {/* Trend Analysis with Smoothing & Bands */}
      {trend && (
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-amber-400" />
              Cash Flow Trend — Smoothing &amp; Bands
              <Badge variant="outline" className="ml-2 text-[10px] border-amber-500/40 text-amber-300">
                <Info className="mr-1 h-3 w-3" />From Pine Script
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-2 rounded-md border border-border/30 bg-muted/20">
                <div className="text-[10px] text-muted-foreground">Current</div>
                <div className={`text-sm font-mono font-bold ${trend.currentValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCr(trend.currentValue)}
                </div>
              </div>
              <div className="p-2 rounded-md border border-border/30 bg-muted/20">
                <div className="text-[10px] text-muted-foreground">SMA(14)</div>
                <div className="text-sm font-mono font-bold text-foreground">
                  {formatCr(trend.smoothed)}
                </div>
              </div>
              <div className="p-2 rounded-md border border-emerald-500/20 bg-emerald-500/5">
                <div className="text-[10px] text-emerald-400">Upper Band</div>
                <div className="text-sm font-mono font-bold text-emerald-400">
                  {formatCr(trend.upperBand)}
                </div>
              </div>
              <div className="p-2 rounded-md border border-red-500/20 bg-red-500/5">
                <div className="text-[10px] text-red-400">Lower Band</div>
                <div className="text-sm font-mono font-bold text-red-400">
                  {formatCr(trend.lowerBand)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Badge className={`text-[10px] ${trend.isStrongInflow ? 'bg-emerald-500/20 text-emerald-300' : 'bg-muted/30 text-muted-foreground'}`}>
                {trend.isStrongInflow ? '▲ INFLOW' : '— Inflow'}
              </Badge>
              <Badge className={`text-[10px] ${trend.isStrongOutflow ? 'bg-red-500/20 text-red-300' : 'bg-muted/30 text-muted-foreground'}`}>
                {trend.isStrongOutflow ? '▼ OUTFLOW' : '— Outflow'}
              </Badge>
              <Badge className={`text-[10px] ${trend.isUptrend ? 'bg-emerald-500/20 text-emerald-300' : trend.isDowntrend ? 'bg-red-500/20 text-red-300' : 'bg-muted/30 text-muted-foreground'}`}>
                {trend.isUptrend ? '↑ Up' : trend.isDowntrend ? '↓ Down' : '— Flat'}
              </Badge>
              <Badge className={`text-[10px] ${trend.momentum > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                Mom: {trend.momentum >= 0 ? '+' : ''}{(trend.momentum / 1000000).toFixed(1)}M
              </Badge>
              <Badge className={`text-[10px] ${trend.bearishDivergence ? 'bg-red-500/20 text-red-300' : 'bg-muted/30 text-muted-foreground'}`}>
                {trend.bearishDivergence ? '⚠ Div-' : '— No Div-'}
              </Badge>
              <Badge className={`text-[10px] ${trend.bullishDivergence ? 'bg-emerald-500/20 text-emerald-300' : 'bg-muted/30 text-muted-foreground'}`}>
                {trend.bullishDivergence ? '✦ Div+' : '— No Div+'}
              </Badge>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              <strong>Signal Strength:</strong> {trend.signalStrength.toFixed(0)}/100 |
              <strong> Bands:</strong> SMA(14) ± 0.5×StDev —
              CF &gt; Upper → <span className="text-emerald-400">Strong Inflow</span> |
              CF &lt; Lower → <span className="text-red-400">Strong Outflow</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Stock Weightage Impact Breakdown */}
      {latestBar && (
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              Per-Stock Weightage Impact (Latest Bar)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="py-1.5 pr-2 text-left font-medium">Stock</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Nifty Wt%</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Sensex Wt%</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Cash Flow</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Nifty Impact</th>
                    <th className="py-1.5 text-right font-medium">Sensex Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {[...latestBar.stockFlows]
                    .sort((a, b) => Math.abs(b.niftyWeighted) - Math.abs(a.niftyWeighted))
                    .map((sf) => {
                      const config = STOCK_CONFIG.find(s => s.symbol === sf.symbol);
                      return (
                        <tr key={sf.symbol} className="border-b border-border/15 hover:bg-muted/20">
                          <td className="py-1 pr-2 font-medium">{sf.symbol}</td>
                          <td className="py-1 pr-2 text-right font-mono text-amber-400">{sf.weight.toFixed(2)}%</td>
                          <td className="py-1 pr-2 text-right font-mono text-purple-400">
                            {config ? config.sensexWeight.toFixed(2) : '—'}%
                          </td>
                          <td className={`py-1 pr-2 text-right font-mono ${sf.cashFlow >= 0 ? 'text-foreground' : 'text-red-400'}`}>
                            {formatCr(sf.cashFlow)}
                          </td>
                          <td className={`py-1 pr-2 text-right font-mono font-bold ${sf.niftyWeighted >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {sf.niftyWeighted >= 0 ? '+' : ''}{formatCr(sf.niftyWeighted)}
                          </td>
                          <td className={`py-1 text-right font-mono font-bold ${sf.sensexWeighted >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {sf.sensexWeighted >= 0 ? '+' : ''}{formatCr(sf.sensexWeighted)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Stocks sorted by <strong>absolute Nifty impact</strong>. HDFCBANK at 9.97% weight impacts Nifty 4× more than ITC at 2.40%.
              Same stock has different impact on Sensex due to different weightage.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
