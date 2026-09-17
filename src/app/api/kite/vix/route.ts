/**
 * India VIX — REAL quote (NSE:INDIA VIX)
 * GET /api/kite/vix
 *
 * Returns the same engine-grade quote the magnet scan uses (factor 13).
 * mode:'live'  → real Kite quote (server store / env / URL creds)
 * mode:'demo'  → Kite not configured OR quote fetch failed (error field
 *                explains) — callers MUST badge this in the UI; demo VIX is
 *                a random number and must never be presented as live.
 */
import { NextRequest, NextResponse } from 'next/server';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';
import { fetchIndiaVix } from '@/lib/vix';
import { generateDemoVIX } from '@/lib/demo-data';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      vix: generateDemoVIX(),
      message: 'Kite API not configured — demo VIX',
      timestamp: new Date().toISOString(),
    });
  }

  const result = await fetchIndiaVix();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}
