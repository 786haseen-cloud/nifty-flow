/**
 * Kite Quote — Real-time index & stock quotes
 * GET /api/kite/quote?symbols=NSE:NIFTY 50,NSE:NIFTY BANK
 *
 * Returns live prices for the dashboard price line chart
 */
import { NextRequest, NextResponse } from 'next/server';
import { getQuotes, KITE_INDEX_INSTRUMENTS } from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured. Set KITE_API_KEY + KITE_ACCESS_TOKEN in Vercel env vars.',
    });
  }

  const symbolsParam = req.nextUrl.searchParams.get('symbols');

  // Default: all 4 indices (use trading symbols)
  const symbols = symbolsParam
    ? symbolsParam.split(',')
    : Object.values(KITE_INDEX_INSTRUMENTS).map(v => v.symbol);

  try {
    const quotes = await getQuotes(symbols);
    const error = (quotes as any)._error;

    if (error) {
      return NextResponse.json({
        mode: 'live',
        provider: 'Zerodha Kite',
        timestamp: new Date().toISOString(),
        error,
        symbols_requested: symbols,
      });
    }

    return NextResponse.json({
      mode: 'live',
      provider: 'Zerodha Kite',
      timestamp: new Date().toISOString(),
      quotes,
      quoteCount: Object.keys(quotes).length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'live',
      error: `Server error: ${errMsg}`,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
