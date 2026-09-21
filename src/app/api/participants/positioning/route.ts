/**
 * Participant Positioning API (Task 42)
 * GET /api/participants/positioning?days=3
 *
 * Returns the last N days of F&O participant positioning snapshots for both
 * fao_oi (close-of-day OI snapshot) and fao_vol (today's traded volume),
 * most-recent-first. Used by the Smart Money OI Flow card on the Big Money
 * tab to render the 6-table reference layout + 3-day carried positions
 * comparison.
 *
 * Reuses the already-existing `getRecentPositioning(reportType, N)` service
 * function — no new Redis access code. The 35-day TTL on the underlying
 * keys is the natural cap on `days`.
 *
 * Response shape:
 *   {
 *     fao_oi:  ParticipantPositioning[]   // most-recent-first
 *     fao_vol: ParticipantPositioning[]
 *     configured: boolean                 // true if Upstash env vars set
 *   }
 *
 * If `days` is omitted it defaults to 3. If `days` > 35 it is clamped to 35.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getRecentPositioning,
  type ParticipantPositioning,
} from '@/lib/participant-service';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days');
  const days = Math.min(35, Math.max(1, parseInt(daysParam || '3', 10) || 3));

  try {
    // Fire both fetches in parallel — they hit independent Redis keys.
    const [faoOi, faoVol] = await Promise.all([
      getRecentPositioning('fao_oi', days),
      getRecentPositioning('fao_vol', days),
    ]);

    const configured = !!(faoOi || faoVol);

    return NextResponse.json({
      fao_oi: faoOi ?? ([] as ParticipantPositioning[]),
      fao_vol: faoVol ?? ([] as ParticipantPositioning[]),
      configured,
      days,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[participants/positioning] error:', errMsg);
    return NextResponse.json({
      fao_oi: [],
      fao_vol: [],
      configured: false,
      days,
      error: errMsg,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
