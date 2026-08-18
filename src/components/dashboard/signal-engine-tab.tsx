'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Zap, Shield, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Signal, SignalMode } from '@/lib/types';

function signalColor(type: Signal['signalType']): string {
  switch (type) {
    case 'STRONG_BUY': return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    case 'BUY': return 'text-emerald-300 border-emerald-400/20 bg-emerald-400/5';
    case 'NEUTRAL': return 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5';
    case 'SELL': return 'text-red-300 border-red-400/20 bg-red-400/5';
    case 'STRONG_SELL': return 'text-red-400 border-red-500/30 bg-red-500/10';
    default: return '';
  }
}

function signalIcon(type: Signal['signalType']) {
  if (type === 'STRONG_BUY' || type === 'BUY') return <CheckCircle className="h-4 w-4 text-emerald-400" />;
  if (type === 'SELL' || type === 'STRONG_SELL') return <XCircle className="h-4 w-4 text-red-400" />;
  return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value > 70 ? 'bg-emerald-500' : value > 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  return (
    <Card className={`border ${signalColor(signal.signalType)}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {signalIcon(signal.signalType)}
            <div>
              <span className="font-bold text-sm">{signal.signalType.replace('_', ' ')}</span>
              <span className="text-xs text-muted-foreground ml-2">{signal.instrument}</span>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">{signal.mode}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2 text-xs font-mono">
          <div>
            <span className="text-muted-foreground">Strike</span>
            <div className="font-semibold">{signal.strike} {signal.optionType}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Premium</span>
            <div className="font-semibold">₹{signal.premium.toFixed(2)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Confidence</span>
            <div className="font-semibold">{signal.confidence}%</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-1 text-xs font-mono">
          <div>
            <span className="text-muted-foreground">SL: </span>
            <span className="text-red-400">₹{signal.stopLoss.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Target: </span>
            <span className="text-emerald-400">₹{signal.target.toFixed(2)}</span>
          </div>
        </div>

        <ConfidenceBar value={signal.confidence} />

        {/* Holistic Reasoning Breakdown */}
        {signal.reasoning.holistic && (
          <Accordion type="single" collapsible className="mt-2">
            <AccordionItem value="holistic" className="border-none">
              <AccordionTrigger className="text-[10px] text-muted-foreground py-1">
                Holistic Breakdown
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 text-[10px] font-mono">
                  <div className="flex justify-between">
                    <span>Own Data (40%)</span>
                    <span className="text-blue-400">{signal.reasoning.holistic.ownScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sentiment (20%)</span>
                    <span className="text-purple-400">{signal.reasoning.holistic.sentimentScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cross-Index (15%)</span>
                    <span className="text-cyan-400">{signal.reasoning.holistic.crossIndexScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VIX (15%)</span>
                    <span className="text-yellow-400">{signal.reasoning.holistic.vixScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Theta (10%)</span>
                    <span className="text-red-400">{signal.reasoning.holistic.thetaScore}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border/30 pt-1 mt-1">
                    <span>Final Score</span>
                    <span className="text-foreground">{signal.reasoning.holistic.finalScore}</span>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <div className="text-[10px] text-muted-foreground mt-1">
          {new Date(signal.timestamp).toLocaleTimeString('en-IN', { hour12: false })} IST
        </div>
      </CardContent>
    </Card>
  );
}

export default function SignalEngineTab() {
  const { signals, addSignal, signalMode, setSignalMode, instruments, vix, isLoading, setIsLoading } = useStore();
  const [generating, setGenerating] = useState(false);

  const generateSignal = useCallback(async (mode: SignalMode) => {
    setGenerating(true);
    setIsLoading(true);
    try {
      const symbol = useStore.getState().selectedInstrument || 'NIFTY';
      const res = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: symbol, mode }),
      });
      const data = await res.json();
      if (data.signal) {
        addSignal({
          ...data.signal,
          timestamp: new Date(data.signal.timestamp),
        });
      }
    } catch {
      // silent
    } finally {
      setGenerating(false);
      setIsLoading(false);
    }
  }, [addSignal, setIsLoading]);

  // Auto-generate on first load
  useEffect(() => {
    if (signals.length === 0) {
      generateSignal(signalMode);
    }
  }, [signals.length, generateSignal, signalMode]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          Signal Engine
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Conservative</span>
            <Switch
              checked={signalMode === 'aggressive'}
              onCheckedChange={(checked) => setSignalMode(checked ? 'aggressive' : 'conservative')}
            />
            <span className="text-xs text-muted-foreground">Aggressive</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateSignal(signalMode)}
            disabled={generating}
            className="gap-1"
          >
            {generating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Generate
          </Button>
        </div>
      </div>

      {/* Mode indicator */}
      <div className="flex gap-2">
        <Badge variant={signalMode === 'aggressive' ? 'default' : 'secondary'} className="text-xs">
          <Zap className="h-3 w-3 mr-1" /> Aggressive
        </Badge>
        <Badge variant={signalMode === 'conservative' ? 'default' : 'secondary'} className="text-xs">
          <Shield className="h-3 w-3 mr-1" /> Conservative
        </Badge>
      </div>

      {/* Current signals */}
      <ScrollArea className="max-h-[600px]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </div>
      </ScrollArea>

      {signals.length === 0 && !generating && (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Click &quot;Generate&quot; to create a signal
          </CardContent>
        </Card>
      )}
    </div>
  );
}
