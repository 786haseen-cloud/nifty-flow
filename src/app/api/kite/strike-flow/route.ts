import { NextRequest, NextResponse } from 'next/server';
import { getStrikeFlowSnapshot, isKiteConfigured, getInstrumentSpec } from '@/lib/kite-api';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'NIFTY').toUpperCase();
  const spotPrice = parseFloat(searchParams.get('spotPrice') || '0');

  // Validate symbol
  const spec = getInstrumentSpec(symbol);
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown symbol: ${symbol}. Use one of: NIFTY, BANKNIFTY, SENSEX, FINNIFTY, RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, HINDUNILVR, SBIN, BHARTIARTL, ITC, KOTAKBANK, LT, AXISBANK, BAJFINANCE, MARUTI, TATAMOTORS` },
      { status: 400 }
    );
  }

  if (!isKiteConfigured()) {
    return NextResponse.json({ error: 'Kite API not configured. Set KITE_API_KEY and KITE_ACCESS_TOKEN in .env' }, { status: 503 });
  }

  try {
    const snapshot = await getStrikeFlowSnapshot(
      symbol,
      spotPrice > 0 ? spotPrice : undefined,
    );

    if (!snapshot) {
      return NextResponse.json(
        { error: `No data returned for ${symbol}. Check if market is open and symbol is valid.` },
        { status: 404 }
      );
    }

    return NextResponse.json(snapshot);
  } catch (err: any) {
    console.error('[StrikeFlow] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
