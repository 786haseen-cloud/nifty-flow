'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Globe, Activity, Target, Landmark, Thermometer, Settings,
  Wifi, WifiOff, Clock, TrendingUp, TrendingDown, Info, Layers, Crosshair, Trophy,
  Shield, Bell, BookOpen, BarChart3, Clock4,
} from 'lucide-react';
import BirdsEye from '@/components/dashboard/birds-eye';
import LiveMonitor from '@/components/dashboard/live-monitor';
import SignalEngineTab from '@/components/dashboard/signal-engine-tab';
import BigMoneyTab from '@/components/dashboard/big-money-tab';
import OptionsFlowTab from '@/components/dashboard/options-flow-tab';
import StrikeFlowMap from '@/components/dashboard/strike-flow-map';
import HighestBetTracker from '@/components/dashboard/highest-bet-tracker';
import OIWallsTab from '@/components/dashboard/oi-walls-tab';
import AlertsTab from '@/components/dashboard/alerts-tab';
import JournalTab from '@/components/dashboard/journal-tab';
import GreeksDecay from '@/components/dashboard/greeks-decay';
import SettingsConfig from '@/components/dashboard/settings-config';
import FuturesBasisTab from '@/components/dashboard/futures-basis-tab';
import MultiTimeframeTab from '@/components/dashboard/multi-timeframe-tab';
import { getMarketStatus } from '@/lib/demo-data';
import type { NSESessionInfo } from '@/lib/types';
import { getNSESession } from '@/lib/nse-sessions';
import { hasKiteCreds } from '@/lib/kite-creds';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('live'); // LIVE is the HERO — options + cash movement drives decisions
  const [istTime, setIstTime] = useState('');
  const [jeddahTime, setJeddahTime] = useState('');
  const [marketStatus, setMarketStatus] = useState<string>('closed');
  const [nseSession, setNseSession] = useState<NSESessionInfo | null>(null);
  const { curr: snapshot } = useKiteSnapshot(15000);

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      setIstTime(ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }));
      const jeddah = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      setJeddahTime(jeddah.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }));
      setMarketStatus(getMarketStatus());
      setNseSession(getNSESession());
    }

    updateTime();
    const timeInterval = setInterval(updateTime, 1000);
    return () => { clearInterval(timeInterval); };
  }, []);

  // Derive VIX from shared snapshot
  const vix = snapshot?.vix ? {
    value: snapshot.vix.value,
    change: snapshot.vix.change,
    changePercent: snapshot.vix.changePercent,
    dayHigh: snapshot.vix.dayHigh,
    dayLow: snapshot.vix.dayLow,
    dayOpen: snapshot.vix.dayOpen,
    trend: snapshot.vix.change > 0.5 ? 'rising' as const : snapshot.vix.change < -0.5 ? 'falling' as const : 'stable' as const,
    percentile: Math.min(100, Math.max(0, (snapshot.vix.value / 30) * 100)),
    panicLevel: snapshot.vix.value > 22 ? 'panic' as const : snapshot.vix.value > 18 ? 'elevated' as const : snapshot.vix.value > 13 ? 'normal' as const : 'calm' as const,
  } : null;

  const statusColor = () => {
    // During CAS: show orange (cash paused, F&O active)
    if (nseSession?.isCASActive) return 'border-orange-500/40 text-orange-400';
    switch (marketStatus) {
      case 'open': return 'border-emerald-500/40 text-emerald-400';
      case 'pre-open': return 'border-amber-500/40 text-amber-400';
      case 'closing': return 'border-orange-500/40 text-orange-400';
      default: return 'border-red-500/40 text-red-400';
    }
  };

  const statusLabel = () => {
    if (nseSession?.isCASActive) return '⛔ CAS — F&O Active';
    switch (marketStatus) {
      case 'open': return '● MARKET OPEN';
      case 'pre-open': return '◐ PRE-OPEN';
      case 'closing': return '◉ CLOSING';
      default: return '○ MARKET CLOSED';
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

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Left: Title + Market Status */}
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-orange-400">Options</span> Trading Dashboard
                <span className="text-xs text-muted-foreground ml-2 font-normal">V3</span>
              </h1>
              <Badge variant="outline" className={`text-[10px] ${statusColor()}`}>
                {statusLabel()}
              </Badge>
              {/* Cash/F&O status during CAS */}
              {nseSession?.isCASActive && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px] border-orange-500/40 text-orange-300 px-1.5 py-0">
                    ⛔ Cash PAUSED
                  </Badge>
                  <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300 px-1.5 py-0">
                    ✅ F&O Active
                  </Badge>
                </div>
              )}
            </div>

            {/* Right: Times + VIX + Connection */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* IST Time */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span className="font-mono">IST {istTime}</span>
              </div>

              {/* Jeddah Time */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-mono">AST {jeddahTime}</span>
              </div>

              {/* VIX Quick View */}
              {vix && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/5">
                  <Activity className="h-3 w-3 text-amber-400" />
                  <span className="text-xs font-mono font-medium">VIX {vix.value.toFixed(2)}</span>
                  <span className={`text-[10px] font-mono ${vix.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {vix.changePercent >= 0 ? '+' : ''}{vix.changePercent.toFixed(2)}%
                  </span>
                  <span className={`text-[10px] font-medium ${panicColor(vix.panicLevel)}`}>
                    {vix.panicLevel.toUpperCase()}
                  </span>
                </div>
              )}

              {/* Connection Status */}
              <Badge
                variant="outline"
                className={`text-[10px] ${hasKiteCreds() ? 'border-emerald-500/40 text-emerald-300' : 'border-orange-500/40 text-orange-300'}`}
              >
                {hasKiteCreds() ? <><Wifi className="mr-1 h-3 w-3" />LIVE</> : <><WifiOff className="mr-1 h-3 w-3" />Demo</>}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 w-full flex h-10 bg-muted/50">
            {/* LIVE is PRIMARY — Options + Cash movement drives index direction */}
            <TabsTrigger value="live" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300 font-bold">
              <Activity className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">⚡ LIVE</span>
              <span className="sm:hidden">⚡</span>
            </TabsTrigger>
            <TabsTrigger value="signals" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
              <Target className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Signals</span>
              <span className="sm:hidden">🎯</span>
            </TabsTrigger>
            {/* Big Money / 3-Day = PREDICTION compass — just alignment check */}
            <TabsTrigger value="big-money" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-red-500/20 data-[state=active]:text-red-300">
              <Landmark className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">3-Day Pred</span>
              <span className="sm:hidden">🔮</span>
            </TabsTrigger>
            {/* OPTIONS FLOW = THE MAIN THING — Cash + Options flow stacked view */}
            <TabsTrigger value="options-flow" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">⚡ Opt Flow</span>
              <span className="sm:hidden">⚡</span>
            </TabsTrigger>
            <TabsTrigger value="strike-flow" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-pink-500/20 data-[state=active]:text-pink-300 font-bold">
              <Crosshair className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">⚡ Strike Flow</span>
              <span className="sm:hidden">🎯</span>
            </TabsTrigger>
            <TabsTrigger value="highest-bet" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 font-bold">
              <Trophy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">⚡ Big Bets</span>
              <span className="sm:hidden">🏆</span>
            </TabsTrigger>
            <TabsTrigger value="oi-walls" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300">
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">OI Walls</span>
              <span className="sm:hidden">🛡</span>
            </TabsTrigger>
            <TabsTrigger value="futures-basis" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-300">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Basis</span>
              <span className="sm:hidden">📊</span>
            </TabsTrigger>
            <TabsTrigger value="multi-tf" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300">
              <Clock4 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Multi-TF</span>
              <span className="sm:hidden">⏱</span>
            </TabsTrigger>
            <TabsTrigger value="alerts" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300">
              <Bell className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Alerts</span>
              <span className="sm:hidden">🔔</span>
            </TabsTrigger>
            <TabsTrigger value="journal" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Journal</span>
              <span className="sm:hidden">📓</span>
            </TabsTrigger>
            <TabsTrigger value="birds-eye" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300">
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Context</span>
              <span className="sm:hidden">🌍</span>
            </TabsTrigger>
            <TabsTrigger value="greeks" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
              <Thermometer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Greeks</span>
              <span className="sm:hidden">📈</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-gray-500/20 data-[state=active]:text-gray-300">
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
              <span className="sm:hidden">⚙️</span>
            </TabsTrigger>
          </TabsList>

          {/* LIVE FIRST — Options + Cash = index movement */}
          <TabsContent value="live" className="mt-0">
            <LiveMonitor />
          </TabsContent>

          <TabsContent value="signals" className="mt-0">
            <SignalEngineTab />
          </TabsContent>

          {/* 3-Day Prediction — just alignment, not the main driver */}
          <TabsContent value="big-money" className="mt-0">
            <BigMoneyTab />
          </TabsContent>

          {/* OPTIONS FLOW = THE MAIN THING — Cash → Index Options → Stock Options stacked */}
          <TabsContent value="options-flow" className="mt-0">
            <OptionsFlowTab />
          </TabsContent>

          <TabsContent value="strike-flow" className="mt-0">
            <StrikeFlowMap />
          </TabsContent>

          <TabsContent value="highest-bet" className="mt-0">
            <HighestBetTracker />
          </TabsContent>

          <TabsContent value="oi-walls" className="mt-0">
            <OIWallsTab />
          </TabsContent>

          <TabsContent value="futures-basis" className="mt-0">
            <FuturesBasisTab />
          </TabsContent>

          <TabsContent value="multi-tf" className="mt-0">
            <MultiTimeframeTab />
          </TabsContent>

          <TabsContent value="alerts" className="mt-0">
            <AlertsTab />
          </TabsContent>

          <TabsContent value="journal" className="mt-0">
            <JournalTab />
          </TabsContent>

          <TabsContent value="birds-eye" className="mt-0">
            <BirdsEye />
          </TabsContent>

          <TabsContent value="greeks" className="mt-0">
            <GreeksDecay />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <SettingsConfig />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 bg-card/50 mt-auto">
        <div className="px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            <span className="text-emerald-400 font-semibold">LIVE = PRIMARY</span> — Options OI + Cash Flow + Money Flow drives index direction |
            <span className="text-amber-400 ml-1">3-Day = Prediction compass</span> (alignment check only) |
            <span className="text-purple-400 ml-1">Opt Flow = Cash → Idx Options → Stk Options</span> (stacked correlation) |
            <span className="text-blue-400 ml-1">Net Money Flow (NSE+BSE)</span> |
            <span className="text-orange-400 ml-1">CAS: Cash PAUSED, F&O Continues</span>
          </span>
          <span className="font-mono">Auto-refresh: 15s | Demo Mode</span>
        </div>
      </footer>
    </div>
  );
}
