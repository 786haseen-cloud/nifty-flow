/**
 * Participant Flow Daily API
 * POST /api/participants/daily  — save yesterday's FII/DII/Client/PropDesk numbers
 * GET  /api/participants/daily  — fetch last 7 days + current bias for the dashboard
 *
 * ─── POST body ─────────────────────────────────────────────────────────
 *   {
 *     date:     "2026-09-07",   // YYYY-MM-DD IST trading day
 *     fii:      -1200,          // ₹ Crore, signed
 *     dii:       850,
 *     client:    400,
 *     propdesk: -50,
 *     source?:  "NSE archive"   // optional note
 *   }
 *
 * Returns 200 { ok: true, entry: ParticipantFlow } on success.
 * Returns 400 { error: "..." } on validation failure.
 * Returns 503 { error: "Redis not configured" } if Upstash env missing.
 *
 * ─── GET response ──────────────────────────────────────────────────────
 *   {
 *     history: ParticipantFlow[],         // last 7 days, most-recent-first
 *     bias:    ParticipantBiasResult,     // current Factor 12 contribution
 *     configured: boolean                 // false = Upstash not configured
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  saveParticipantFlow,
  getRecentParticipantFlow,
  getCachedParticipantBias,
  getParticipantPositioningByDate,
  type ParticipantFlow,
  type ParticipantBiasResult,
} from '@/lib/participant-service';

// ─── POST: save today's data ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const { date, fii, dii, client, propdesk } = body ?? {};
    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid `date` (expected YYYY-MM-DD string)' },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: `Invalid date format: "${date}" — expected YYYY-MM-DD` },
        { status: 400 }
      );
    }
    for (const field of ['fii', 'dii', 'client', 'propdesk'] as const) {
      const v = body[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return NextResponse.json(
          { error: `Invalid \`${field}\` value: ${v} — expected finite number (Cr)` },
          { status: 400 }
        );
      }
    }

    const entry = await saveParticipantFlow({
      date,
      fii,
      dii,
      client,
      propdesk,
      source: typeof body.source === 'string' ? body.source : undefined,
    });

    if (!entry) {
      return NextResponse.json(
        { error: 'Redis not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[participants/daily] POST error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── GET: fetch recent history + current bias ───
// Diagnostic: ?positioning=YYYY-MM-DD → raw FAO OI + Vol reports for that
// date (verifies the daily upload routine landed under the right key).

export async function GET(req: NextRequest) {
  try {
    const posDate = req.nextUrl.searchParams.get('positioning');
    if (posDate && /^\d{4}-\d{2}-\d{2}$/.test(posDate)) {
      const [fao_oi, fao_vol] = await Promise.all([
        getParticipantPositioningByDate(posDate, 'fao_oi'),
        getParticipantPositioningByDate(posDate, 'fao_vol'),
      ]);
      return NextResponse.json({
        date: posDate,
        fao_oi,
        fao_vol,
        configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      });
    }

    const [history, bias] = await Promise.all([
      getRecentParticipantFlow(7, 30),
      getCachedParticipantBias(),
    ]);

    const response: {
      history: ParticipantFlow[];
      bias: ParticipantBiasResult;
      configured: boolean;
    } = {
      history,
      bias,
      configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    };

    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[participants/daily] GET error:', msg);
    return NextResponse.json(
      { history: [], bias: null, configured: false, error: msg },
      { status: 500 }
    );
  }
}
