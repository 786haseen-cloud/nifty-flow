/**
 * Kite Quote — Real-time index & stock quotes
 * GET /api/kite/quote?symbols=NSE:NIFTY 50,NSE:NIFTY BANK
 *
 * Returns live prices for the dashboard price line chart
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getQuotes, KITE_INDEX_INSTRUMENTS } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured. Set KITE_API_KEY + KITE_ACCESS_TOKEN in .env',
    });
  }

  const symbolsParam = req.nextUrl.searchParams.get('symbols');

  // Default: all 4 indices
  const symbols = symbolsParam
    ? symbolsParam.split(',')
    : Object.values(KITE_INDEX_INSTRUMENTS);

  const quotes = await getQuotes(symbols);

  return NextResponse.json({
    mode: 'live',
    provider: 'Zerodha Kite',
    timestamp: new Date().toISOString(),
    quotes,
  });
}
