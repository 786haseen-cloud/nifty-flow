/**
 * Redis Status API
 * GET /api/kite/redis-status
 *
 * Diagnostic endpoint for the Upstash Redis backing the 7-day signal
 * history. Returns whether the env vars are present, whether PING
 * succeeds (+ latency), and a data census (how many of the 19 symbols
 * have history, total entries, newest entry timestamp).
 *
 * NEVER returns the URL or token themselves — only booleans / counts /
 * timestamps. Safe to hit from the browser.
 *
 * Used by the Recent Signals card footer to tell the user *why* the
 * card is empty: "Upstash not configured" vs "configured but no signal
 * has fired yet".
 */
import { NextResponse } from 'next/server';
import { INDEX_SPECS, STOCK_SPECS } from '@/lib/kite-api';
import { getRedisStatus } from '@/lib/signal-history';

export async function GET() {
  const allSymbols = [
    ...INDEX_SPECS.map(s => s.symbol),
    ...STOCK_SPECS.map(s => s.symbol),
  ];

  try {
    const status = await getRedisStatus(allSymbols);
    return NextResponse.json({
      mode: 'live',
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      error: errMsg,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
