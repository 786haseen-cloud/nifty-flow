/**
 * Kite Options — Options chain & flow data
 * GET /api/kite/options?index=NIFTY&spotPrice=24350
 *
 * Returns options flow data per strike (CB/PW/PB/CW + OI)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getOptionsFlow, getInstrumentMeta } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const index = req.nextUrl.searchParams.get('index') || 'NIFTY';
  const spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '24350');

  try {
    // First get meta (tests if instruments CSV works)
    const meta = await getInstrumentMeta(index, spotPrice);

    const flow = await getOptionsFlow(index, spotPrice);

    return NextResponse.json({
      mode: 'live',
      index,
      spotPrice,
      meta,
      strikeCount: flow?.length || 0,
      timestamp: new Date().toISOString(),
      strikes: flow,
      debug: {
        metaLotSize: meta.lotSize,
        metaStrikeStep: meta.strikeStep,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      index,
      spotPrice,
      error: errMsg,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
