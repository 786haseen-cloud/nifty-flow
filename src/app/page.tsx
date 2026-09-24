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
import { useServerCredsSync } from '@/hooks/use-server-creds-sync';
import { istNow, istTimeStr } from '@/lib/ist';
import { getMarketPhase } from '@/lib/market-hours';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('oi-walls');
  const [istTime, setIstTime] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [localTzLabel, setLocalTzLabel] = useState('LOCAL');
  const [marketStatus, setMarketStatus] = useState<string>('closed');
  // Market phase for the footer — re-evaluated every 15s so the dashboard
  // transitions from 'closed' → 'live' promptly when IST hits 09:15 (or
  // 'live' → 'paused' at 15:40) without needing a full page refresh.
  // EXCHANGE TIME GATE: this is what drives the footer's "Auto-refresh:
  // 30s · LIVE" vs "Paused · Market closed" label.
  const [marketPhase, setMarketPhase] = useState<'pre' | 'open' | 'post' | 'closed'>('closed');
  const [nseSession, setNseSession] = useState<NSESessionInfo | null>(null);
  const { curr: snapshot } = useKiteSnapshot(30000);

  // Paste-once-per-day: pull the newest token from the server store at boot
  // (laptop paste → office device auto-adopts; no re-pasting across devices).
  useServerCredsSync();

  // Start the global trend poller ONCE at app boot
  const startTrendPolling = useTrendStore((s) => s.startPolling);
  useEffect(() => {
    startTrendPolling();
  }, [startTrendPolling]);

  useEffect(() => {
    // EXCHANGE TIME GATE: all dashboard behavior is driven by IST exchange
    // time via market-hours.ts. The header shows BOTH:
    //   - IST (always, as the authoritative exchange clock)
    //   - User's local time (auto-detected via Intl API — works for any
    //     viewer worldwide, not just Jeddah)
    // The local time is informational only — no behavior depends on it.
    // All poller/chart gates use the IST helpers (isTradingSessionActive /
    // isChartSessionActive from market-hours.ts), so the dashboard behaves
    // identically no matter where the viewer is.

    // Detect the user's actual local timezone ONCE (not on every tick —
    // Intl.DateTimeFormat().resolvedOptions() is consistent for a tab's
    // lifetime). Falls back to 'LOCAL' if detection fails.
    let userTz = 'UTC';
    try {
      userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      userTz = 'UTC';
    }
    // Convert IANA tz name to a short label: 'Asia/Riyadh' → 'AST',
    // 'Asia/Kolkata' → 'IST', 'America/New_York' → 'EST/EDT', etc.
    // Use the browser's own formatter for the abbreviation when available,
    // fall back to the IANA name if not (some browsers don't expose tzAbbr).
    const tzAbbr = (() => {
      // Format with hourCycle + timeZoneName: 'short' to get e.g. 'GMT+3'
      // or 'AST' depending on browser support. Most browsers return
      // 'GMT+3' style; we use it as-is.
      try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: userTz, timeZoneName: 'short' });
        const parts = fmt.formatToParts(new Date());
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart?.value || userTz.split('/').pop() || 'LOCAL';
      } catch {
        return userTz.split('/').pop() || 'LOCAL';
      }
    })();
    setLocalTzLabel(tzAbbr);

    function updateTime() {
      // IST time via the centralized helper (DST-immune)
      setIstTime(istTimeStr());

      // User's local time via their browser's timezone — works anywhere
      // in the world, not just Jeddah. Updated every second.
      try {
        const local = new Date();
        const lh = local.getHours().toString().padStart(2, '0');
        const lm = local.getMinutes().toString().padStart(2, '0');
        const ls = local.getSeconds().toString().padStart(2, '0');
        setLocalTime(`${lh}:${lm}:${ls}`);
      } catch {
        setLocalTime('--:--:--');
      }

      setMarketStatus(getMarketStatus());
      setMarketPhase(getMarketPhase());
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
              {/* IST Time — authoritative exchange clock (always shown) */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span className="font-mono">IST {istTime}</span>
              </div>

              {/* User's local time — auto-detected, informational only.
                  No dashboard behavior depends on this — all gates use IST. */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-mono">{localTzLabel} {localTime}</span>
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
        <div className="px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground flex-wrap gap-2">
          <span>
            <span className="text-blue-400 font-semibold">OI Walls</span> — Max Pain + OI + PCR |
            <span className="text-sky-400 ml-1">Basis</span> — Futures Basis Spread |
            <span className="text-teal-400 ml-1">Trends</span> — Price + Cash + Options Flow |
            <span className="text-orange-400 ml-1">CAS: Cash PAUSED, F&O Continues</span>
          </span>
          {/* EXCHANGE TIME GATE status: when the exchange is open, show the
              polling cadence. When closed (pre-market / post-market / weekend),
              show that polling is paused + the next open time, so the user
              knows data will resume at 09:15 IST. This label updates every
              second via the time updater effect, so the dashboard transitions
              automatically at 09:15 / 15:40 IST without a page refresh. */}
          {marketPhase === 'open' ? (
            <span className="font-mono text-emerald-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />
              Live · Auto-refresh: 30s
            </span>
          ) : marketPhase === 'pre' ? (
            <span className="font-mono text-amber-400">
              ⏸ Paused · pre-market · next open 09:15 IST
            </span>
          ) : marketPhase === 'post' ? (
            <span className="font-mono text-amber-400">
              ⏸ Paused · market closed at 15:40 IST
            </span>
          ) : (
            <span className="font-mono text-red-400">
              ⏸ Paused · weekend · next open Mon 09:15 IST
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
