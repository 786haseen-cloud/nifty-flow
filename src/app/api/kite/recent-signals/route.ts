/**
 * Recent Signals API
 * GET /api/kite/recent-signals?limit=5
 *
 * Returns the N most-recent signal entries across ALL 19 symbols (4 indices
 * + 15 F&O stocks), pulled from Upstash Redis 7-day rolling history.
 *
 * Each entry contains: symbol, direction, strength, score, confidence, spot,
 * timestamp, plus optional outcome (win/loss/partial/expired) — filled in
 * when a NEW signal replaced this one.
 *
 * Used by the "Recent Signals" card on the Trends tab to show the latest
 * signal flips across the entire market in one glance.
 *
 * Cost: ~19 zrange calls in parallel ≈ 30-50ms (well within free tier).
 * Returns empty array if Upstash not configured.
 */
import { NextRequest, NextResponse } from 'next/server';
import { INDEX_SPECS, STOCK_SPECS } from '@/lib/kite-api';
import { getRecentSignalsGlobal } from '@/lib/signal-history';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

export async function GET(req: NextRequest) {
  // Apply creds (not strictly needed for Redis, but keeps the route
  // consistent with other /api/kite/* endpoints)
  applyKiteCredsFromRequest(req.url);

  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(50, Math.max(1, parseInt(limitParam || '5', 10) || 5));

  const allSymbols = [
    ...INDEX_SPECS.map(s => s.symbol),
    ...STOCK_SPECS.map(s => s.symbol),
  ];

  try {
    const entries = await getRecentSignalsGlobal(allSymbols, limit);

    return NextResponse.json({
      mode: 'live',
      signals: entries,
      count: entries.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      error: errMsg,
      signals: [],
      count: 0,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
