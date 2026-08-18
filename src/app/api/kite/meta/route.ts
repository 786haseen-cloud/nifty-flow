/**
 * Kite Instrument Meta — Show current lot sizes + strike steps from CSV
 * GET /api/kite/meta?symbol=NIFTY&spotPrice=24350
 *
 * Returns the ACTUAL current lot size and strike step from Kite's master CSV.
 * Use this to verify lot sizes match what NSE currently has.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getInstrumentMeta, INDEX_SPECS, STOCK_SPECS } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    // Return specs without dynamic data
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured. Showing spec definitions only.',
      indexSpecs: INDEX_SPECS,
      stockSpecs: STOCK_SPECS,
      note: 'Lot sizes and strike steps will be fetched from Kite CSV once API is connected.',
    });
  }

  const symbol = req.nextUrl.searchParams.get('symbol');
  const spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '24350');

  if (symbol) {
    // Get meta for specific symbol
    const meta = await getInstrumentMeta(symbol, spotPrice);
    return NextResponse.json({
      mode: 'live',
      symbol,
      spotPrice,
      lotSize: meta.lotSize,
      strikeStep: meta.strikeStep,
      timestamp: new Date().toISOString(),
    });
  }

  // Get meta for ALL instruments
  const allSpecs = [...INDEX_SPECS, ...STOCK_SPECS];
  const results: Record<string, { lotSize: number; strikeStep: number }> = {};

  for (const spec of allSpecs) {
    try {
      const meta = await getInstrumentMeta(spec.symbol, spotPrice);
      results[spec.symbol] = meta;
    } catch {
      results[spec.symbol] = { lotSize: -1, strikeStep: -1 };
    }
  }

  return NextResponse.json({
    mode: 'live',
    timestamp: new Date().toISOString(),
    instruments: results,
    note: 'These values are from Kite\'s live instrument CSV. They update automatically.',
  });
}
