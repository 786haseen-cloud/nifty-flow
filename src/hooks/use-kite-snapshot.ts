/**
 * Shared hook: polls /api/kite/highest-bet once,
 * provides real-time data + previous snapshot for diffing
 * to all dashboard components via module-level singleton.
 *
 * OPTIMIZED: Timer auto-stops when no listeners remain (saves Vercel CPU).
 *
 * MARKET HOURS GATE (added per user request — "all chart and card should
 * run during market hours only"): the poller skips API calls when IST is
 * outside the live trading session (pre-09:15, post-15:40, weekend). This
 * automatically stops every consumer of the snapshot — OptFlow TV,
 * CombinedFlowCard, MaxProbabilitySignals, SmartMoneyFootprint, Cash Flow,
 * Participant Flow, etc. — from receiving fresh data after market close.
 * Existing data in each chart/card stays so the user can scroll back
 * through the closed session. The gate uses the same getMarketPhase()
 * helper as useMagnetScan for consistency.
 *
 * Note: the user explicitly asked for the 09:00 → 15:40 window in the chart
 * components (CombinedFlowCard + OptFlow TV) so they include pre-market.
 * This poller-level gate uses the stricter 09:15 → 15:40 from
 * market-hours.ts because the snapshot fetches live spot prices + OI —
 * nothing useful to fetch during 09:00–09:15 pre-market (auction window,
 * quotes are stale). The two are compatible: chart components keep their
 * wider 09:00 visible window; the poller just stops feeding them outside
 * the live session. If the user wants the chart's gate widened to 09:15
 * too, that's a one-line change.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { withCreds } from '@/lib/kite-creds';
import { getMarketPhase } from '@/lib/market-hours';
import type { StrikeFlowData } from '@/lib/kite-api';

export interface SnapshotSymbol {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spotPrice: number;
  spotVolume: number;
  spotChange: number;
  futOI: number;
  futPrice: number;
  futLotSize: number;
  lotSize: number;
  strikeStep: number;
  strikes: StrikeFlowData[];
}

export interface VIXData {
  value: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  dayOpen: number;
}

export interface KiteSnapshot {
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  symbols: SnapshotSymbol[];
  vix: VIXData | null;
}

// Module-level singleton: all hook instances share the same data
let globalCurr: KiteSnapshot | null = null;
let globalPrev: KiteSnapshot | null = null;
const listeners = new Set<() => void>();
let globalTimer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 30000;
let globalPollCount = 0;

let _consecutiveErrors = 0;

async function pollOnce() {
  // ─── MARKET HOURS GATE ───
  // Skip the API call entirely outside the live trading session
  // (pre-09:15, post-15:40, weekend). This saves Vercel function
  // invocations + Kite API quota. Existing globalCurr stays in place
  // so chart components keep showing the last-known data.
  if (getMarketPhase() !== 'open') {
    // Still notify listeners so UI badges (LIVE/PAUSED) update promptly
    // when the market transitions from 'open' → 'post' on the 15s tick.
    listeners.forEach(fn => fn());
    return;
  }

  try {
    const url = withCreds('/api/kite/highest-bet');
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[KiteSnapshot] HTTP ${res.status} from ${url}`);
      _consecutiveErrors++;
      listeners.forEach(fn => fn());
      return;
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.symbols)) {
      console.error('[KiteSnapshot] Invalid response structure:', data);
      _consecutiveErrors++;
      listeners.forEach(fn => fn());
      return;
    }
    globalPrev = globalCurr;
    globalCurr = {
      mode: data.mode || 'demo',
      timestamp: data.timestamp,
      symbols: data.symbols || [],
      vix: data.vix || null,
    };
    globalPollCount++;
    _consecutiveErrors = 0;
  } catch (err) {
    _consecutiveErrors++;
    console.error(`[KiteSnapshot] Fetch error #${_consecutiveErrors}:`, err);
  }
  listeners.forEach(fn => fn());
}

function startPolling(intervalMs: number) {
  if (globalTimer) return;
  currentIntervalMs = intervalMs;
  pollOnce();
  globalTimer = setInterval(pollOnce, intervalMs);
}

function stopPolling() {
  if (globalTimer) {
    clearInterval(globalTimer);
    globalTimer = null;
  }
}

export function useKiteSnapshot(intervalMs = 30000) {
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    listeners.add(tick);
    startPolling(intervalMs);
    return () => {
      listeners.delete(tick);
      // Auto-stop when NO listeners remain (saves CPU)
      if (listeners.size === 0) {
        stopPolling();
      }
    };
  }, [tick, intervalMs]);

  return {
    curr: globalCurr,
    prev: globalPrev,
    pollCount: globalPollCount,
    errorCount: _consecutiveErrors,
  };
}
