'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, BarChart3, Info } from 'lucide-react';
import type { WeightedCashFlowBar, CashFlowTrend } from '@/lib/types';
import { generateDemoWeightedBars, computeCashFlowTrend } from '@/lib/demo-data';

// How many bars to show in the visible window
const VISIBLE_BARS = 120; // ~30 minutes of data at 4 bars/min
const BAR_WIDTH = 3;      // px per bar
const CHART_HEIGHT = 160; // px for the bar area

export default function MoneyFlowBars() {
  const [bars, setBars] = useState<WeightedCashFlowBar[]>([]);
  const [trend, setTrend] = useState<CashFlowTrend | null>(null);
  const [niftyPrice, setNiftyPrice] = useState(24350);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate initial bars + add new ones every 15 seconds
  useEffect(() => {
    // Start with some historical bars
    const initialBars = generateDemoWeightedBars(60);
    setBars(initialBars);
    setTrend(computeCashFlowTrend(initialBars));
    setNiftyPrice(24350 + Math.random() * 100 - 50);

    // Add a new bar every 15 seconds (4 bars per minute)
    const interval = setInterval(() => {
      setBars(prev => {
        const newBar = generateDemoWeightedBars(1)[0];
        const updated = [...prev, newBar];
        // Keep max 500 bars to prevent memory issues
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
      // Update nifty price with small random walk
      setNiftyPrice(prev => prev + (Math.random() - 0.48) * 3);
      setTrend(prev => prev); // trend recalculated below
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Recalculate trend when bars change
  useEffect(() => {
    if (bars.length > 14) {
      setTrend(computeCashFlowTrend(bars));
    }
  }, [bars]);

  // Only show the last VISIBLE_BARS bars
  const visibleBars = bars.slice(-VISIBLE_BARS);

  // Compute scale for bars
  const maxAbsFlow = Math.max(
    1,
    ...visibleBars.map(b => Math.max(Math.abs(b.totalMoneyIn), Math.abs(b.totalMoneyOut), Math.abs(b.netFlow)))
  );

  // Nifty price line (simple random walk for demo)
  const pricePoints = visibleBars.map((_, i) => {
    const baseIdx = i - visibleBars.length;
    return 24350 + baseIdx * 0.5 + Math.sin(i * 0.1) * 20 + niftyPrice - 24350;
  });
  const priceMin = Math.min(...pricePoints);
  const priceMax = Math.max(...pricePoints);
  const priceRange = Math.max(1, priceMax - priceMin);

  // Aggregate stats
  const totalMoneyIn = visibleBars.reduce((s, b) => s + b.totalMoneyIn, 0);
  const totalMoneyOut = visibleBars.reduce((s, b) => s + b.totalMoneyOut, 0);
  const totalNetFlow = visibleBars.reduce((s, b) => s + b.netFlow, 0);
  const totalNiftyWeighted = visibleBars.reduce((s, b) => s + b.niftyWeightedCF, 0);
  const totalSensexWeighted = visibleBars.reduce((s, b) => s + b.sensexWeightedCF, 0);

  // Latest bar
  const latestBar = visibleBars[visibleBars.length - 1];

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          Weighted Money Flow — Below Nifty50 Price Line
          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300">
            Green = Money In
          </Badge>
          <Badge variant="outline" className="text-[9px] border-red-500/40 text-red-300">
            Red = Money Out
          </Badge>
          <Badge variant="outline" className="text-[9px] border-blue-500/40 text-blue-300">
            Blue = Net Flow
          </Badge>
          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
            4 bars/min (15s intervals)
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
          <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5">
            <div className="text-[10px] text-muted-foreground">Total Money In</div>
            <div className="text-sm font-mono font-bold text-emerald-400">
              +{(totalMoneyIn / 10000000).toFixed(1)} Cr
            </div>
          </div>
          <div className="p-2 rounded border border-red-500/20 bg-red-500/5">
            <div className="text-[10px] text-muted-foreground">Total Money Out</div>
            <div className="text-sm font-mono font-bold text-red-400">
              -{(totalMoneyOut / 10000000).toFixed(1)} Cr
            </div>
          </div>
          <div className="p-2 rounded border border-blue-500/20 bg-blue-500/5">
            <div className="text-[10px] text-muted-foreground">Net Flow</div>
            <div className={`text-sm font-mono font-bold ${totalNetFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalNetFlow >= 0 ? '+' : ''}{(totalNetFlow / 10000000).toFixed(1)} Cr
            </div>
          </div>
          <div className="p-2 rounded border border-border/30 bg-muted/20">
            <div className="text-[10px] text-muted-foreground">Nifty Weighted CF</div>
            <div className={`text-sm font-mono font-bold ${totalNiftyWeighted >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalNiftyWeighted >= 0 ? '+' : ''}{(totalNiftyWeighted / 10000000).toFixed(1)} Cr
            </div>
          </div>
          <div className="p-2 rounded border border-border/30 bg-muted/20">
            <div className="text-[10px] text-muted-foreground">Sensex Weighted CF</div>
            <div className={`text-sm font-mono font-bold ${totalSensexWeighted >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalSensexWeighted >= 0 ? '+' : ''}{(totalSensexWeighted / 10000000).toFixed(1)} Cr
            </div>
          </div>
          <div className="p-2 rounded border border-amber-500/20 bg-amber-500/5">
            <div className="text-[10px] text-muted-foreground">Trend Signal</div>
            <div className={`text-sm font-bold ${trend && trend.signalStrength > 20 ? 'text-emerald-400' : trend && trend.signalStrength < -20 ? 'text-red-400' : 'text-yellow-400'}`}>
              {trend ? (trend.signalStrength > 20 ? '↑ BULLISH' : trend.signalStrength < -20 ? '↓ BEARISH' : '— NEUTRAL') : '...'}
            </div>
          </div>
        </div>

        {/* Chart Area: Nifty Price Line on top, Money Flow Bars below */}
        <div ref={containerRef} className="relative border border-border/30 rounded-lg overflow-hidden bg-black/20" style={{ height: CHART_HEIGHT + 40 }}>
          {/* Y-axis labels for Nifty price */}
          <div className="absolute left-0 top-0 bottom-0 w-14 border-r border-border/20 z-10">
            <div className="absolute top-1 left-1 text-[9px] font-mono text-muted-foreground">
              {priceMax.toFixed(0)}
            </div>
            <div className="absolute bottom-1 left-1 text-[9px] font-mono text-muted-foreground">
              {priceMin.toFixed(0)}
            </div>
          </div>

          {/* SVG: Nifty Price Line */}
          <svg
            className="absolute left-14 top-0 right-0"
            width="100%"
            height={CHART_HEIGHT * 0.4}
            viewBox={`0 0 ${visibleBars.length * BAR_WIDTH} ${CHART_HEIGHT * 0.4}`}
            preserveAspectRatio="none"
          >
            {/* Price line */}
            <polyline
              fill="none"
              stroke={niftyPrice >= 24350 ? '#34d399' : '#f87171'}
              strokeWidth="1.5"
              points={pricePoints.map((p, i) =>
                `${i * BAR_WIDTH},${(CHART_HEIGHT * 0.4) - ((p - priceMin) / priceRange) * (CHART_HEIGHT * 0.4 - 8) - 4}`
              ).join(' ')}
            />
            {/* SMA line (simplified) */}
            {trend && (
              <line
                x1="0"
                y1={(CHART_HEIGHT * 0.4) - ((trend.smoothed - priceMin) / priceRange) * (CHART_HEIGHT * 0.4 - 8) - 4}
                x2={visibleBars.length * BAR_WIDTH}
                y2={(CHART_HEIGHT * 0.4) - ((trend.smoothed - priceMin) / priceRange) * (CHART_HEIGHT * 0.4 - 8) - 4}
                stroke="#fbbf24"
                strokeWidth="0.5"
                strokeDasharray="4,4"
              />
            )}
          </svg>

          {/* Bar Chart Area: Money Flow Bars */}
          <div
            className="absolute left-14 right-0 flex items-end gap-px overflow-hidden"
            style={{ top: CHART_HEIGHT * 0.4, height: CHART_HEIGHT * 0.6 }}
          >
            {visibleBars.map((bar, i) => {
              // Scale bars relative to max flow
              const inHeight = Math.max(1, (bar.totalMoneyIn / maxAbsFlow) * (CHART_HEIGHT * 0.25));
              const outHeight = Math.max(1, (bar.totalMoneyOut / maxAbsFlow) * (CHART_HEIGHT * 0.25));
              const netHeight = Math.abs(Math.max(1, (bar.netFlow / maxAbsFlow) * (CHART_HEIGHT * 0.3)));
              const netIsPos = bar.netFlow >= 0;

              return (
                <div
                  key={i}
                  className="flex flex-col items-center justify-end"
                  style={{ width: BAR_WIDTH, height: '100%' }}
                >
                  {/* Net flow bar (blue) — centered */}
                  <div
                    className={`w-full rounded-t-sm ${netIsPos ? 'bg-blue-500/80' : 'bg-blue-600/80'}`}
                    style={{ height: netHeight }}
                    title={`Net: ${(bar.netFlow / 10000000).toFixed(2)} Cr | In: ${(bar.totalMoneyIn / 10000000).toFixed(2)} Cr | Out: ${(bar.totalMoneyOut / 10000000).toFixed(2)} Cr | ${bar.timestamp}`}
                  />
                  {/* Money Out bar (red) — below center */}
                  <div
                    className="w-full bg-red-500/60"
                    style={{ height: outHeight * 0.3 }}
                    title={`Money Out: ${(bar.totalMoneyOut / 10000000).toFixed(2)} Cr | ${bar.timestamp}`}
                  />
                </div>
              );
            })}
          </div>

          {/* Overlay: Current Nifty Price */}
          <div className="absolute top-1 right-2 z-20 text-xs font-mono font-bold text-foreground">
            Nifty: <span className={niftyPrice >= 24350 ? 'text-emerald-400' : 'text-red-400'}>
              {niftyPrice.toFixed(0)}
            </span>
          </div>

          {/* Overlay: Last bar timestamp */}
          {latestBar && (
            <div className="absolute bottom-1 right-2 z-20 text-[9px] font-mono text-muted-foreground">
              {latestBar.timestamp}
            </div>
          )}

          {/* Live indicator */}
          <div className="absolute top-1 right-32 z-20">
            <Badge className="text-[8px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30 px-1 py-0 animate-pulse">
              LIVE
            </Badge>
          </div>
        </div>

        {/* Legend + Explanation */}
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500/70" /> Money In (Buy Pressure)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm bg-red-500/60" /> Money Out (Sell Pressure)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm bg-blue-500/80" /> Net Flow (In − Out)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-yellow-400" /> SMA Trend
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Each stock&apos;s money flow is <strong>m multiplied by its index weight</strong> (e.g., HDFCBANK at 9.97% moves Nifty 4x more than ITC at 2.40%).
            Nifty50 and Sensex weights differ — same stock has different impact on each index.
            <span className="text-amber-400 ml-1">During live market, only MONEY FLOW is visible — participant identity is unknown until after-market data release.</span>
          </div>
        </div>

        {/* Per-Stock Breakdown (latest bar) */}
        {latestBar && latestBar.stockFlows.length > 0 && (
          <div className="mt-3 border-t border-border/20 pt-2">
            <div className="text-[10px] font-medium text-muted-foreground mb-1">
              Latest 15-second bar — Per-Stock Weighted Contribution
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1">
              {latestBar.stockFlows
                .sort((a, b) => Math.abs(b.niftyWeighted) - Math.abs(a.niftyWeighted))
                .map(sf => (
                <div
                  key={sf.symbol}
                  className={`p-1 rounded text-[9px] font-mono border ${
                    sf.niftyWeighted > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
                  }`}
                >
                  <div className="font-bold">{sf.symbol}</div>
                  <div className="text-muted-foreground">W: {sf.weight.toFixed(1)}%</div>
                  <div className={sf.niftyWeighted > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {(sf.niftyWeighted / 10000000).toFixed(2)} Cr
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
