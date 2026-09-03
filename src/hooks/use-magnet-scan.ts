'use client';

/**
 * useMagnetScan — polling hook for the Magnet & Gamma Dashboard.
 *
 * WHY A SEPARATE HOOK (not in trend-store.ts)?
 * -------------------------------------------
 * The trend-store polls every 15s and accumulates 15s-delta flow points.
 * The magnet scan is expensive (batched fetch of ~400 option quotes for all
 * 19 symbols) and the metrics change slowly (max pain + GEX drift on the
 * order of minutes, not seconds). Polling it every 15s would:
 *   1. Triple the API call volume (60s vs 15s = 4× more calls)
 *   2. Hammer Kite's rate limit
 *   3. Provide no benefit — the chart would look identical at 15s resolution
 *
 * So we keep it as a standalone 60-second hook that lives inside the
 * MagnetDashboard component. When the user is on the Trends tab, this polls;
 * when they switch tabs, the component unmounts and the poller cleans up.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { withCreds } from '../lib/kite-creds';
import { getMarketPhase } from '../lib/market-hours';
import type { MagnetResult } from '../lib/magnet-engine';

interface MagnetScanResponse {
  mode: 'live' | 'demo' | 'error';
  symbols: MagnetResult[];
  timestamp: string;
  error?: string;
  message?: string;
}

const POLL_INTERVAL_MS = 60_000;  // 60 seconds

export function useMagnetScan(enabled: boolean = true) {
  const [data, setData] = useState<MagnetResult[]>([]);
  const [mode, setMode] = useState<'live' | 'demo' | 'error' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    // ─── MARKET HOURS GATE (API quota saver) ───
    // The magnet scan is the most expensive call in the app (~400 option
    // quotes batched for 19 symbols). Outside the session:
    //   'pre'/'closed' (weekend) → skip entirely
    //   'post' (after 15:40 IST) → allow ONE fetch so the dashboard shows
    //     the final state of the day, then stop polling.
    if (getMarketPhase() !== 'open' && hasDataRef.current) {
      return;
    }

    if (inFlightRef.current) return;  // skip overlap
    inFlightRef.current = true;
    try {
      const res = await fetch(withCreds('/api/kite/magnet-scan'));
      const json: MagnetScanResponse = await res.json();
      if (json.mode === 'live' && json.symbols?.length > 0) {
        setData(json.symbols);
        setMode('live');
        setError(null);
        hasDataRef.current = true;
      } else if (json.mode === 'demo') {
        setData([]);
        setMode('demo');
        setError(json.message || 'Kite API not configured');
      } else if (json.mode === 'error') {
        setMode('error');
        setError(json.error || 'Unknown error');
      }
      setLastPollAt(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMode('error');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Immediate fetch on mount
    fetchOnce();

    // Start interval
    timerRef.current = setInterval(fetchOnce, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, fetchOnce]);

  return { data, mode, error, lastPollAt, refetch: fetchOnce };
}
