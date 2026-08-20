'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Target, Info, AlertTriangle, TrendingUp, TrendingDown, Minus, History,
} from 'lucide-react';
import type { Signal, SignalMode, InstrumentData, VIXData, DayComparison, GlobalIndex } from '@/lib/types';
import {
  generateDemoInstrument,
  generateDemoVIX,
  generateDemo3DayComparison,
  generateDemoGlobalIndices,
  generateDemoExpiryInfo,
} from '@/lib/demo-data';
import { generateHolisticSignal } from '@/lib/signal-engine';

export default function SignalEngineTab() {
  const [mode, setMode] = useState<SignalMode>('aggressive');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalHistory, setSignalHistory] = useState<Signal[]>([]);

  useEffect(() => {
    function generateSignals() {
      const instruments: InstrumentData[] = [
        generateDemoInstrument('NIFTY', 'Nifty 50', 'index', 24350),
        generateDemoInstrument('SENSEX', 'Sensex', 'index', 80100),
        generateDemoInstrument('BANKNIFTY', 'Bank Nifty', 'index', 51800),
        generateDemoInstrument('FINNIFTY', 'Fin Nifty', 'index', 23200),
      ];
      const vix = generateDemoVIX();
      const dayComp = generateDemo3DayComparison();
      const globalIndices = generateDemoGlobalIndices();
      const expiryInfo = generateDemoExpiryInfo();
      const niftyExpiry = expiryInfo.find(e => e.symbol === 'NIFTY');
      const daysToExpiry = niftyExpiry?.daysToExpiry ?? 5;

      const newSignals = instruments.map(inst =>
        generateHolisticSignal(inst, {
          instrument: inst,
          vix,
          dayComparison: dayComp,
          globalIndices,
          daysToExpiry,
          stockSentiment: (Math.random() - 0.5) * 2,
        }, mode)
      );

      setSignals(newSignals);
      setSignalHistory(prev => [...newSignals, ...prev].slice(0, 50));
    }

    generateSignals();
    const interval = setInterval(generateSignals, 15000);
    return () => clearInterval(interval);
  }, [mode]);

  const signalColor = (type: string) => {
    switch (type) {
      case 'CALL_BUY': return 'border-emerald-500/50 bg-emerald-500/10';
      case 'PUT_BUY': return 'border-red-500/50 bg-red-500/10';
      case 'SELL_BOTH': return 'border-yellow-500/50 bg-yellow-500/10';
      case 'WAIT': return 'border-gray-500/30 bg-gray-500/10';
      default: return 'border-border/50 bg-card/80';
    }
  };

  const signalTextColor = (type: string) => {
    switch (type) {
      case 'CALL_BUY': return 'text-emerald-400';
      case 'PUT_BUY': return 'text-red-400';
      case 'SELL_BOTH': return 'text-yellow-400';
      case 'WAIT': return 'text-gray-400';
      default: return 'text-foreground';
    }
  };

  const scoreBar = (score: number, label: string, weight: number) => {
    const absScore = Math.min(100, Math.abs(score));
    const isPositive = score >= 0;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-24 text-muted-foreground shrink-0">{label} ({(weight * 100).toFixed(0)}%)</span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
          <div
            className={`absolute inset-y-0 rounded-full ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
            style={{ width: `${absScore}%`, left: isPositive ? '50%' : `${50 - absScore / 2}%` }}
          />
          <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        </div>
        <span className={`w-12 text-right font-mono ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {score >= 0 ? '+' : ''}{score.toFixed(1)}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-orange-400" />
              <span className="font-medium">Signal Mode</span>
            </div>
            <ToggleGroup type="single" value={mode} onValueChange={(v) => { if (v) setMode(v as SignalMode); }}>
              <ToggleGroupItem value="aggressive" className="text-xs">Aggressive</ToggleGroupItem>
              <ToggleGroupItem value="conservative" className="text-xs">Conservative</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardContent>
      </Card>

      {/* Signal Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {signals.map((sig) => (
          <Card key={`${sig.instrument}-${sig.timestamp.getTime()}`} className={`border ${signalColor(sig.signalType)}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="font-medium">{sig.instrument}</span>
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs ${signalTextColor(sig.signalType)} bg-transparent border-current`}>
                    {sig.signalType === 'CALL_BUY' ? '▲ CALL BUY' :
                     sig.signalType === 'PUT_BUY' ? '▼ PUT BUY' :
                     sig.signalType === 'SELL_BOTH' ? '◆ SELL BOTH' : '— WAIT'}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {sig.confidence.toFixed(0)}%
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Strike + Premium */}
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Strike</span>
                  <div className="font-mono font-bold">{sig.suggestedStrike.toLocaleString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{sig.optionType}</span>
                  <div className="font-mono font-bold">₹{sig.premium.toFixed(1)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">SL</span>
                  <div className="font-mono text-red-400">₹{sig.stopLoss.toFixed(1)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Target</span>
                  <div className="font-mono text-emerald-400">₹{sig.target.toFixed(1)}</div>
                </div>
              </div>

              {/* Reasoning Breakdown */}
              <div className="space-y-1.5">
                {scoreBar(sig.reasoning.fiiFlowScore, 'Net Flow Score', 0.25)}
                {scoreBar(sig.reasoning.propdeskFlowScore, 'F&O Flow', 0.20)}
                {scoreBar(sig.reasoning.clientContrarianScore, 'Contrarian Flow', 0.15)}
                {scoreBar(sig.reasoning.threeDayOITrendScore, '3-Day OI Trend', 0.15)}
                {scoreBar(sig.reasoning.cashFutAlignScore, 'Cash+Fut Align', 0.10)}
                {scoreBar(sig.reasoning.globalContextScore, 'Global Context', 0.10)}
                {scoreBar(sig.reasoning.stockSentimentScore, 'Stock Sentiment', 0.05)}
                <div className="flex items-center gap-2 text-xs pt-1 border-t border-border/30">
                  <span className="w-24 text-muted-foreground shrink-0">Total Score</span>
                  <span className={`flex-1 font-mono font-bold ${sig.reasoning.totalScore >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {sig.reasoning.totalScore >= 0 ? '+' : ''}{sig.reasoning.totalScore.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* INFO: Theta + VIX + Smart Money (NOT in score) */}
              <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs">
                <div className="flex items-center gap-1 text-amber-300 font-medium mb-1">
                  <Info className="h-3 w-3" />
                  INFORMATIONAL — Not in Signal Score
                </div>
                {sig.reasoning.thetaInfo && (
                  <div className="text-amber-200/70">
                    Call melting: ₹{sig.reasoning.thetaInfo.callMelting.toFixed(1)}/day{sig.reasoning.thetaInfo.fasterSide === 'call' ? ' (FAST)' : ''} | Put melting: ₹{sig.reasoning.thetaInfo.putMelting.toFixed(1)}/day{sig.reasoning.thetaInfo.fasterSide === 'put' ? ' (FAST)' : ''}
                  </div>
                )}
                {sig.reasoning.vixInfo && (
                  <div className="text-amber-200/70">
                    VIX Panic: <span className="capitalize">{sig.reasoning.vixInfo.panicLevel}</span> ({sig.reasoning.vixInfo.percentile.toFixed(0)}th percentile)
                  </div>
                )}
                {sig.reasoning.smartMoneyWindow && (
                  <div className="text-orange-300 font-medium">
                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                    SMART MONEY WINDOW — Positions being built
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="text-[10px] text-muted-foreground">{sig.reasoning.details}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Signal History */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-muted-foreground" />
            Signal History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            <div className="space-y-1">
              {signalHistory.slice(4).map((sig, i) => (
                <div key={i} className="flex items-center gap-3 text-xs p-1.5 rounded hover:bg-muted/30">
                  <span className="text-muted-foreground font-mono shrink-0">
                    {sig.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="font-medium shrink-0">{sig.instrument}</span>
                  <Badge variant="outline" className={`text-[10px] ${signalTextColor(sig.signalType)}`}>
                    {sig.signalType.replace('_', ' ')}
                  </Badge>
                  <span className="text-muted-foreground">{sig.confidence.toFixed(0)}%</span>
                  <span className="font-mono text-muted-foreground">{sig.suggestedStrike.toLocaleString()} {sig.optionType}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
