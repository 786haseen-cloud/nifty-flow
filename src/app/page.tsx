'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useTrendStore } from '@/lib/trend-store';
import {
  Activity, Shield, BarChart3, LineChart, Settings,
  Wifi, WifiOff, Clock,
} from 'lucide-react';
import OIWallsTab from '@/components/dashboard/oi-walls-tab';
import SettingsConfig from '@/components/dashboard/settings-config';
import FuturesBasisTab from '@/components/dashboard/futures-basis-tab';
import TrendAnalysisTab from '@/components/dashboard/trend-analysis-tab';
import { getMarketStatus } from '@/lib/demo-data';
import type { NSESessionInfo } from '@/lib/types';
import { getNSESession } from '@/lib/nse-sessions';
import { hasKiteCreds } from '@/lib/kite-creds';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('oi-walls');
  const [istTime, setIstTime] = useState('');
  const [jeddahTime, setJeddahTime] = useState('');
  const [marketStatus, setMarketStatus] = useState<string>('closed');
  const [nseSession, setNseSession] = useState<NSESessionInfo | null>(null);
  const { curr: snapshot } = useKiteSnapshot(15000);

  // Start the global trend poller ONCE at app boot
  const startTrendPolling = useTrendStore((s) => s.startPolling);
  useEffect(() => {
    startTrendPolling();
  }, [startTrendPolling]);

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

      <main className="flex-1 p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 w-full flex h-10 bg-muted/50">
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
            <TabsTrigger value="trends" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-teal-500/20 data-[state=active]:text-teal-300 font-bold">
              <LineChart className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Trends</span>
              <span className="sm:hidden">📈</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-gray-500/20 data-[state=active]:text-gray-300">
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
              <span className="sm:hidden">⚙️</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="oi-walls" className="mt-0">
            <OIWallsTab />
          </TabsContent>

          <TabsContent value="futures-basis" className="mt-0">
            <FuturesBasisTab />
          </TabsContent>

          <TabsContent value="trends" className="mt-0">
            <TrendAnalysisTab />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <SettingsConfig />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border/30 bg-card/50 mt-auto">
        <div className="px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            <span className="text-blue-400 font-semibold">OI Walls</span> — Max Pain + OI + PCR |
            <span className="text-sky-400 ml-1">Basis</span> — Futures Basis Spread |
            <span className="text-teal-400 ml-1">Trends</span> — Price + Cash + Options Flow |
            <span className="text-orange-400 ml-1">CAS: Cash PAUSED, F&O Continues</span>
          </span>
          <span className="font-mono">Auto-refresh: 15s</span>
        </div>
      </footer>
    </div>
  );
}
