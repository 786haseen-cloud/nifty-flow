/**
 * Strike Flow Map API
 * GET /api/kite/strike-flow?symbol=NIFTY
 * GET /api/kite/strike-flow?symbol=HDFCBANK
 * GET /api/kite/strike-flow?symbol=RELIANCE&spotPrice=2950
 *
 * Supports all 4 indices + 15 stocks.
 * Returns raw per-strike snapshot (OI, LTP, volume, delta).
 * Frontend stores 2 consecutive snapshots and computes 4-color flow.
 * This avoids Vercel serverless state-loss between cold starts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getStrikeFlowSnapshot, getQuotes, getInstrumentSpec } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const symbol = (req.nextUrl.searchParams.get('symbol') || 'NIFTY').toUpperCase();
  let spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '0');

  // Validate symbol
  const spec = getInstrumentSpec(symbol);
  if (!spec) {
    return NextResponse.json({
      mode: 'error',
      symbol,
      error: `Unknown symbol: ${symbol}`,
    }, { status: 400 });
  }

  try {
    // Auto-fetch spot price if not provided
    if (spotPrice <= 0) {
      const quotes = await getQuotes([spec.kiteSymbol]);
      const q = quotes[spec.kiteSymbol];
      if (q?.lastPrice && q.lastPrice > 0) {
        spotPrice = q.lastPrice;
      }
    }

    if (spotPrice <= 0) {
      return NextResponse.json({
        mode: 'error',
        symbol,
        error: `Could not fetch spot price for ${symbol}. Is market open?`,
      }, { status: 502 });
    }

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