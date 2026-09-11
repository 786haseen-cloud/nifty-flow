'use client';

import { useEffect } from 'react';
import { getKiteCreds, setKiteCreds } from '@/lib/kite-creds';
import { useTrendStore } from '@/lib/trend-store';

/**
 * Boot-time credential sync with the server store — the mechanism behind
 * "paste once per day, works on every device".
 *
 * THE DAILY WORKFLOW THIS ENABLES
 * -------------------------------
 * 09:14 laptop : paste token → Save & Test → creds stored locally AND on
 *                the server (POST /api/kite/creds-store, done in Settings).
 * 11:00 office : open dashboard → this hook GETs the server store → local
 *                has nothing (or yesterday's stale token with an older
 *                savedAt) → adopts the server token → the 15s poller picks
 *                it up on the next cycle → demo→live transition (fresh
 *                device) or notifyCredsRefreshed (stale device) re-runs the
 *                historical backfills → all three flow cards reconstruct
 *                the full 09:15→now session. Zero pasting at the office.
 * Next day     : paste the new token once (any device) → every other device
 *                converges on it the next time it boots, because savedAt is
 *                strictly newer than what they hold.
 *
 * Convergence rule (last-writer-wins):
 *   server.savedAt  >  local.savedAt  → adopt server creds
 *   server empty AND local exists    → push local creds up (migration +
 *                                      self-heal for a failed Settings POST)
 *   local.savedAt   >  server.savedAt → push local up (covers a POST that
 *                                      failed earlier in the day)
 *   equal / identical                → no-op
 *
 * Runs once per app boot from page.tsx. Fire-and-forget by design: polling
 * starts immediately with whatever creds the device already has, and if a
 * new token is adopted a few hundred ms later the existing demo→live /
 * notifyCredsRefreshed machinery heals everything within one 15s cycle.
 */

interface ServerCredsResponse {
  configured: boolean;
  apiKey?: string;
  accessToken?: string;
  savedAt?: number;
}

export function useServerCredsSync(): void {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/kite/creds-store', { cache: 'no-store' });
        if (!res.ok) return;
        const data: ServerCredsResponse = await res.json();
        if (cancelled) return;

        const local = getKiteCreds();
        const localSavedAt = local.savedAt || 0;
        const serverSavedAt = data.savedAt || 0;

        // ── Case 1: server has creds, local is missing or older → ADOPT ──
        if (data.configured && data.apiKey && data.accessToken &&
            (!local.apiKey || !local.accessToken || serverSavedAt > localSavedAt)) {

          const differs = data.apiKey !== local.apiKey || data.accessToken !== local.accessToken;
          if (differs) {
            setKiteCreds(data.apiKey, data.accessToken, serverSavedAt || Date.now());
            console.log(
              `[CredsSync] Adopted server-side token (server savedAt ${serverSavedAt || '?'}` +
              ` vs local ${localSavedAt || 'none'}) — next polls go live automatically`
            );
            // Guarded inside: no-ops when market is closed/pre, or when the
            // live feed is already healthy. This is REQUIRED for the stale
            // office device: with an expired token the trends route returns
            // mode 'error' (not 'demo'), so the demo→live transition in
            // pollOnce misses — this clears the frozen data and re-runs the
            // 09:15→now backfills.
            useTrendStore.getState().notifyCredsRefreshed();
          }
          return;
        }

        // ── Case 2: local has creds, server missing or older → PUSH ──
        // Covers first boot after this feature ships (server store empty,
        // laptop already has this morning's token) and self-heals a
        // Settings POST that failed earlier.
        if (local.apiKey && local.accessToken &&
            (!data.configured || localSavedAt > serverSavedAt)) {
          try {
            const pushRes = await fetch('/api/kite/creds-store', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey: local.apiKey,
                accessToken: local.accessToken,
                savedAt: localSavedAt || Date.now(),
              }),
            });
            if (pushRes.ok && !cancelled) {
              console.log('[CredsSync] Pushed local token to server store (other devices can now adopt it)');
            }
          } catch { /* server unreachable — device keeps its local creds */ }
        }
      } catch {
        // Server unreachable — device keeps its localStorage creds as before.
      }
    })();

    return () => { cancelled = true; };
  }, []);
}
