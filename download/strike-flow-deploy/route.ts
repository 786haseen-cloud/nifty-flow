/**
 * Strike Flow Map API
 * GET /api/kite/strike-flow?symbol=NIFTY&spotPrice=24350
 *
 * Returns raw per-strike snapshot (OI, LTP, volume, delta).
 * Frontend stores 2 consecutive snapshots and computes 4-color flow.
 * This avoids Vercel serverless state-loss between cold starts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getStrikeFlowSnapshot, getQuotes, KITE_INDEX_INSTRUMENTS } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const symbol = req.nextUrl.searchParams.get('symbol') || 'NIFTY';
  let spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '0');

  try {
    // If no spot price provided, fetch it live from Kite
    if (spotPrice <= 0) {
      const instInfo = KITE_INDEX_INSTRUMENTS[symbol];
      if (instInfo) {
        const quotes = await getQuotes([String(instInfo.token)]);
        if (!('_error' in quotes)) {
          const q = quotes[instInfo.token];
          if (q?.lastPrice && q.lastPrice > 1000) {
            spotPrice = q.lastPrice;
          }
        }
      }
    }

    // Fallback spot price
    if (spotPrice <= 0) spotPrice = 24250;

    const snapshot = await getStrikeFlowSnapshot(symbol, spotPrice);

    if (!snapshot) {
      return NextResponse.json({
        mode: 'error',
        symbol,
        spotPrice,
        error: 'No options data returned from Kite',
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    return NextResponse.json({
      mode: 'live',
      ...snapshot,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      symbol,
      spotPrice,
      error: errMsg,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
