'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity, TrendingUp, TrendingDown, Compass, CheckCircle, XCircle, Minus,
  Zap, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { MarketDataContext, CashFlowTrend, WeightedCashFlowBar } from '@/lib/types';
import {
  generateDemoMarketDataContext,
  generateDemoWeightedBars,
  computeCashFlowTrend,
} from '@/lib/demo-data';

export default function LiveAlignmentIndicator() {
  const [marketContext, setMarketContext] = useState<MarketDataContext | null>(null);
  const [trend, setTrend] = useState<CashFlowTrend | null>(null);
  const [latestBar, setLatestBar] = useState<WeightedCashFlowBar | null>(null);

  useEffect(() => {
    function refresh() {
      const ctx = generateDemoMarketDataContext();
      setMarketContext(ctx);

      const bars = generateDemoWeightedBars(30);
      if (bars.length > 14) {
        setTrend(computeCashFlowTrend(bars));
      }
      if (bars.length > 0) {
        setLatestBar(bars[bars.length - 1]);
      }
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  // Determine alignment between LIVE flow and 3-day prediction
  const liveDirection = latestBar
    ? latestBar.netFlow > 0 ? 'bullish' : latestBar.netFlow < 0 ? 'bearish' : 'neutral'
    : 'neutral';

  const predictionDirection = marketContext?.rollingWindow
    ? (marketContext.rollingWindow.fiiTrend === 'accumulating' && marketContext.rollingWindow.propdeskTrend === 'accumulating')
      ? 'bullish'
      : (marketContext.rollingWindow.fiiTrend === 'distributing' && marketContext.rollingWindow.propdeskTrend === 'distributing')
        ? 'bearish'
        : 'neutral'
    : 'unknown';

  const isAligned = (liveDirection === predictionDirection) ||
    (liveDirection === 'bullish' && predictionDirection === 'bullish') ||
    (liveDirection === 'bearish' && predictionDirection === 'bearish');

  const isConflict = (liveDirection === 'bullish' && predictionDirection === 'bearish') ||
    (liveDirection === 'bearish' && predictionDirection === 'bullish');

  // Live signal strength from trend
  const liveStrength = trend ? Math.abs(trend.signalStrength) : 0;
  const liveLabel = liveStrength > 70 ? 'STRONG' : liveStrength > 40 ? 'MODERATE' : 'WEAK';

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-emerald-400" />
          Live Market Direction
          <Badge variant="outline" className="ml-auto text-[9px] border-emerald-500/40 text-emerald-300 animate-pulse">
            LIVE
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* LIVE Direction — This is the PRIMARY decision driver */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {/* Live Money Flow Direction */}
          <div className={`p-3 rounded-lg border-2 ${
            liveDirection === 'bullish' ? 'border-emerald-500/50 bg-emerald-500/10' :
            liveDirection === 'bearish' ? 'border-red-500/50 bg-red-500/10' :
            'border-border/40 bg-muted/30'
          }`}>
            <div className="text-[10px] text-muted-foreground mb-1">LIVE Money Flow</div>
            <div className="flex items-center gap-2">
              {liveDirection === 'bullish' ? <ArrowUpRight className="h-5 w-5 text-emerald-400" /> :
               liveDirection === 'bearish' ? <ArrowDownRight className="h-5 w-5 text-red-400" /> :
               <Minus className="h-5 w-5 text-muted-foreground" />}
              <span className={`text-lg font-bold ${
                liveDirection === 'bullish' ? 'text-emerald-400' :
                liveDirection === 'bearish' ? 'text-red-400' : 'text-muted-foreground'
              }`}>
                {liveDirection === 'bullish' ? 'BULLISH' : liveDirection === 'bearish' ? 'BEARISH' : 'NEUTRAL'}
              </span>
            </div>
            {latestBar && (
              <div className="text-[10px] font-mono text-muted-foreground mt-1">
                Net: {(latestBar.netFlow / 10000000).toFixed(1)} Cr
                {' '}Strength: {liveLabel} ({liveStrength.toFixed(0)}%)
              </div>
            )}
          </div>

          {/* 3-Day Prediction — Just alignment compass */}
          <div className={`p-3 rounded-lg border ${
            predictionDirection === 'bullish' ? 'border-emerald-500/30 bg-emerald-500/5' :
            predictionDirection === 'bearish' ? 'border-red-500/30 bg-red-500/5' :
            'border-border/30 bg-muted/20'
          }`}>
            <div className="text-[10px] text-muted-foreground mb-1">
              <Compass className="inline h-3 w-3 mr-0.5" />
              3-Day Prediction (compass)
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-base font-bold ${
                predictionDirection === 'bullish' ? 'text-emerald-400/80' :
                predictionDirection === 'bearish' ? 'text-red-400/80' : 'text-muted-foreground/60'
              }`}>
                {predictionDirection === 'bullish' ? '↑ BULL' :
                 predictionDirection === 'bearish' ? '↓ BEAR' : '— NEUTRAL'}
              </span>
            </div>
            {marketContext?.rollingWindow && (
              <div className="text-[10px] text-muted-foreground mt-1">
                FII: {marketContext.rollingWindow.fiiTrend} |
                PropDesk: {marketContext.rollingWindow.propdeskTrend}
              </div>
            )}
          </div>

          {/* Alignment Status */}
          <div className={`p-3 rounded-lg border-2 ${
            isAligned && liveDirection !== 'neutral' ? 'border-emerald-500/50 bg-emerald-500/10' :
            isConflict ? 'border-red-500/50 bg-red-500/10' :
            'border-amber-500/30 bg-amber-500/5'
          }`}>
            <div className="text-[10px] text-muted-foreground mb-1">Live vs Prediction</div>
            <div className="flex items-center gap-2">
              {isAligned && liveDirection !== 'neutral' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-lg font-bold text-emerald-400">ALIGNED</span>
                </>
              ) : isConflict ? (
                <>
                  <XCircle className="h-5 w-5 text-red-400" />
                  <span className="text-lg font-bold text-red-400">CONFLICT</span>
                </>
              ) : (
                <>
                  <Minus className="h-5 w-5 text-amber-400" />
                  <span className="text-lg font-bold text-amber-400">NO SIGNAL</span>
                </>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {isAligned && liveDirection !== 'neutral' ? 'Live confirms prediction → Higher confidence' :
               isConflict ? 'Live contradicts prediction → Wait or trade smaller' :
               'Need both live + prediction aligned'}
            </div>
          </div>
        </div>

        {/* Key insight from trader */}
        <div className="p-2 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-[10px] text-emerald-300/80">
          <Zap className="inline h-3 w-3 mr-1" />
          <strong>LIVE Options + Cash = Index Direction.</strong> 3-day data is just a prediction compass — "where should market go?"
          When LIVE flow aligns with prediction → trade with confidence. When CONFLICT → wait or reduce size.
          Retailers can't move the market — only big money flow matters.
        </div>

        {/* Options OI Quick Read — from live data */}
        {trend && (
          <div className="mt-2 flex flex-wrap gap-2">
            {trend.isStrongInflow && (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                <TrendingUp className="mr-1 h-3 w-3" />Strong Inflow — Big money buying
              </Badge>
            )}
            {trend.isStrongOutflow && (
              <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">
                <TrendingDown className="mr-1 h-3 w-3" />Strong Outflow — Big money selling
              </Badge>
            )}
            {trend.bearishDivergence && (
              <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px]">
                ⚠️ Bearish Divergence — Price up but flow weakening
              </Badge>
            )}
            {trend.bullishDivergence && (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                ✦ Bullish Divergence — Price down but flow strengthening
              </Badge>
            )}
            {trend.isUptrend && !trend.isStrongInflow && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-300">
                ↑ Uptrend
              </Badge>
            )}
            {trend.isDowntrend && !trend.isStrongOutflow && (
              <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-300">
                ↓ Downtrend
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
