'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Activity, Sigma, Zap, Building2, Calendar, Settings,
  Moon, Sun, Wifi, WifiOff, Clock, RefreshCw,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useStore } from '@/lib/store';

import LiveMonitor from '@/components/dashboard/live-monitor';
import GreeksAnalysis from '@/components/dashboard/greeks-analysis';
import SignalEngineTab from '@/components/dashboard/signal-engine-tab';
import BigMoneyTab from '@/components/dashboard/big-money-tab';
import DailyActivity from '@/components/dashboard/daily-activity';
import SettingsConfig from '@/components/dashboard/settings-config';

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function MarketStatusBadge() {
  const now = useClock();
  const istHour = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  const istMin = (now.getUTCMinutes() + 30) % 60;

  const isMarketHours = (istHour === 9 && istMin >= 15) || (istHour > 9 && istHour < 15) || (istHour === 15 && istMin <= 30);
  const isPreMarket = istHour === 9 && istMin < 15;
  const isPostMarket = istHour === 15 && istMin > 30;

  let status = 'CLOSED';
  let color = 'bg-red-500/20 text-red-400';
  if (isMarketHours) { status = 'LIVE'; color = 'bg-emerald-500/20 text-emerald-400'; }
  else if (isPreMarket) { status = 'PRE-MARKET'; color = 'bg-yellow-500/20 text-yellow-400'; }
  else if (isPostMarket) { status = 'POST-MARKET'; color = 'bg-orange-500/20 text-orange-400'; }

  return <Badge variant="outline" className={`text-[10px] ${color}`}>{status}</Badge>;
}

export default function DashboardPage() {
  const { theme, setTheme } = useTheme();
  const { vix, isLive, lastRefresh, activeTab, setActiveTab } = useStore();
  const now = useClock();

  const istTime = useMemo(() => {
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toUTCString().slice(17, 25) + ' IST';
  }, [now]);

  const jeddahTime = useMemo(() => {
    const jed = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return jed.toUTCString().slice(17, 25) + ' AST';
  }, [now]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2">
          {/* Left: App Name + Time */}
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-400" />
              <span className="hidden sm:inline">Options Trading Dashboard</span>
              <span className="sm:hidden">OTD</span>
              <Badge variant="secondary" className="text-[9px]">V2</Badge>
            </h1>
            <Separator orientation="vertical" className="h-4 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{istTime}</span>
              <span className="text-muted-foreground/50">|</span>
              <span>{jeddahTime}</span>
            </div>
          </div>

          {/* Right: VIX, Market Status, Connection, Theme */}
          <div className="flex items-center gap-2">
            {/* VIX quick view */}
            {vix && (
              <Badge variant="outline" className="text-[10px] font-mono">
                <span className="text-yellow-400">VIX</span>{' '}
                <span className={vix.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {vix.value.toFixed(1)}
                </span>
              </Badge>
            )}

            {/* Market Status */}
            <MarketStatusBadge />

            {/* Connection */}
            <Badge variant="outline" className={`text-[10px] ${isLive ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {isLive ? <Wifi className="h-3 w-3 mr-0.5" /> : <WifiOff className="h-3 w-3 mr-0.5" />}
              {isLive ? 'Live' : 'Demo'}
            </Badge>

            {/* Last Refresh */}
            <span className="text-[9px] font-mono text-muted-foreground hidden md:inline">
              <RefreshCw className="h-3 w-3 inline mr-0.5" />
              {lastRefresh.toLocaleTimeString('en-IN', { hour12: false })}
            </span>

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-3 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="w-full justify-start mb-3 bg-muted/30 h-9 overflow-x-auto">
            <TabsTrigger value="live" className="text-xs gap-1 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400">
              <Activity className="h-3 w-3" />
              <span className="hidden sm:inline">Live</span>
            </TabsTrigger>
            <TabsTrigger value="greeks" className="text-xs gap-1 data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">
              <Sigma className="h-3 w-3" />
              <span className="hidden sm:inline">Greeks</span>
            </TabsTrigger>
            <TabsTrigger value="signals" className="text-xs gap-1 data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400">
              <Zap className="h-3 w-3" />
              <span className="hidden sm:inline">Signals</span>
            </TabsTrigger>
            <TabsTrigger value="bigmoney" className="text-xs gap-1 data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
              <Building2 className="h-3 w-3" />
              <span className="hidden sm:inline">Big Money</span>
              <Badge variant="secondary" className="text-[8px] px-1 py-0 hidden sm:inline-block">NEW</Badge>
            </TabsTrigger>
            <TabsTrigger value="daily" className="text-xs gap-1 data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
              <Calendar className="h-3 w-3" />
              <span className="hidden sm:inline">Daily</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs gap-1 data-[state=active]:bg-muted/50">
              <Settings className="h-3 w-3" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="live" className="mt-0">
              <LiveMonitor />
            </TabsContent>
            <TabsContent value="greeks" className="mt-0">
              <GreeksAnalysis />
            </TabsContent>
            <TabsContent value="signals" className="mt-0">
              <SignalEngineTab />
            </TabsContent>
            <TabsContent value="bigmoney" className="mt-0">
              <BigMoneyTab />
            </TabsContent>
            <TabsContent value="daily" className="mt-0">
              <DailyActivity />
            </TabsContent>
            <TabsContent value="settings" className="mt-0">
              <SettingsConfig />
            </TabsContent>
          </div>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 px-4 py-1.5 text-center">
        <div className="text-[10px] text-muted-foreground font-mono flex items-center justify-center gap-3">
          <span>Indian Options Dashboard V2</span>
          <span>|</span>
          <span>Kite/Zerodha API</span>
          <span>|</span>
          <span>Black-Scholes Engine</span>
          <span>|</span>
          <span>Big Money Footprint™</span>
        </div>
      </footer>
    </div>
  );
}
