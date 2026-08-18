'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Globe, Activity, Target, Landmark, Thermometer, Settings,
  Wifi, WifiOff, Clock, TrendingUp, TrendingDown, Info,
} from 'lucide-react';
import BirdsEye from '@/components/dashboard/birds-eye';
import LiveMonitor from '@/components/dashboard/live-monitor';
import SignalEngineTab from '@/components/dashboard/signal-engine-tab';
import BigMoneyTab from '@/components/dashboard/big-money-tab';
import GreeksDecay from '@/components/dashboard/greeks-decay';
import SettingsConfig from '@/components/dashboard/settings-config';
import { generateDemoVIX, getMarketStatus } from '@/lib/demo-data';
import type { VIXData, NSESessionInfo } from '@/lib/types';
import { getNSESession } from '@/lib/nse-sessions';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('live'); // LIVE is the HERO — options + cash movement drives decisions
  const [istTime, setIstTime] = useState('');
  const [jeddahTime, setJeddahTime] = useState('');
  const [vix, setVix] = useState<VIXData | null>(null);
  const [marketStatus, setMarketStatus] = useState<string>('closed');
  const [nseSession, setNseSession] = useState<NSESessionInfo | null>(null);

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      // IST = UTC + 5:30
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      setIstTime(ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }));

      // Jeddah = UTC + 3:00
      const jeddah = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      setJeddahTime(jeddah.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }));

      setMarketStatus(getMarketStatus());
      setNseSession(getNSESession());
    }

    function refreshVix() {
      setVix(generateDemoVIX());
    }

    updateTime();
    refreshVix();
    const timeInterval = setInterval(updateTime, 1000);
    const vixInterval = setInterval(refreshVix, 15000);

    return () => {
      clearInterval(timeInterval);
      clearInterval(vixInterval);
    };
  }, []);

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
                  <span className="text-xs font-mono font-medium">VIX {vix.value.toFixed(1)}</span>
                  <span className={`text-[10px] font-mono ${vix.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {vix.change >= 0 ? '+' : ''}{vix.change.toFixed(1)}
                  </span>
                  <Badge variant="outline" className="text-[8px] border-amber-500/30 text-amber-300 px-1 py-0">
                    <Info className="mr-0.5 h-2 w-2" />Info
                  </Badge>
                  <span className={`text-[10px] font-medium ${panicColor(vix.panicLevel)}`}>
                    {vix.panicLevel.toUpperCase()}
                  </span>
                </div>
              )}

              {/* Connection Status */}
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                <Wifi className="mr-1 h-3 w-3" />Demo
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
            <span className="text-blue-400 ml-1">Net Money Flow (NSE+BSE)</span> |
            <span className="text-orange-400 ml-1">CAS: Cash PAUSED, F&O Continues</span>
          </span>
          <span className="font-mono">Auto-refresh: 15s | Demo Mode</span>
        </div>
      </footer>
    </div>
  );
}
