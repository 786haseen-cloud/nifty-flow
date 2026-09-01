/**
 * Shared hook: polls /api/kite/highest-bet once,
 * provides real-time data + previous snapshot for diffing
 * to all dashboard components via module-level singleton.
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { withCreds } from '@/lib/kite-creds';
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
let globalPollCount = 0;

let _consecutiveErrors = 0;

async function pollOnce() {
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

function ensurePolling(intervalMs: number) {
  if (globalTimer) return;
  pollOnce();
  globalTimer = setInterval(pollOnce, intervalMs);
  // Auto-stop after 12 hours to prevent memory leaks
  setTimeout(() => {
    if (globalTimer) { clearInterval(globalTimer); globalTimer = null; }
  }, 12 * 60 * 60 * 1000);
}

export function useKiteSnapshot(intervalMs = 15000) {
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    listeners.add(tick);
    ensurePolling(intervalMs);
    return () => { listeners.delete(tick); };
  }, [tick, intervalMs]);

  return {
    curr: globalCurr,
    prev: globalPrev,
    pollCount: globalPollCount,
    errorCount: _consecutiveErrors,
  };
}
