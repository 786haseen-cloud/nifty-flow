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
      message: 'Kite API not configured. Set KITE_API_KEY + KITE_ACCESS_TOKEN in Vercel env vars.',
    });
  }

  const symbolsParam = req.nextUrl.searchParams.get('symbols');

  // Default: all 4 indices
  const symbols = symbolsParam
    ? symbolsParam.split(',')
    : Object.values(KITE_INDEX_INSTRUMENTS);

  try {
    const quotes = await getQuotes(symbols);

    // Check for errors from getQuotes
    const error = (quotes as any)._error;

    if (error) {
      return NextResponse.json({
        mode: 'live',
        provider: 'Zerodha Kite',
        timestamp: new Date().toISOString(),
        error,
        symbols_requested: symbols,
        debug: {
          apiKeyPrefix: process.env.KITE_API_KEY?.substring(0, 6) + '...',
          accessTokenPrefix: process.env.KITE_ACCESS_TOKEN?.substring(0, 8) + '...',
          accessTokenLength: process.env.KITE_ACCESS_TOKEN?.length || 0,
        },
      });
    }

    const quoteCount = Object.keys(quotes).length;
    return NextResponse.json({
      mode: 'live',
      provider: 'Zerodha Kite',
      timestamp: new Date().toISOString(),
      quotes,
      quoteCount,
      symbols_requested: symbols,
      debug: {
        apiKeyPrefix: process.env.KITE_API_KEY?.substring(0, 6) + '...',
        accessTokenPrefix: process.env.KITE_ACCESS_TOKEN?.substring(0, 8) + '...',
        accessTokenLength: process.env.KITE_ACCESS_TOKEN?.length || 0,
      },
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
