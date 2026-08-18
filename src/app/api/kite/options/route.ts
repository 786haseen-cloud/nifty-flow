/**
 * Kite Options — Options chain & flow data
 * GET /api/kite/options?index=NIFTY&spotPrice=24350
 *
 * Returns options flow data per strike (CB/PW/PB/CW + OI)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, getOptionsFlow } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  if (!isKiteConfigured()) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const index = req.nextUrl.searchParams.get('index') || 'NIFTY';
  const spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '24350');

  const flow = await getOptionsFlow(index, spotPrice);

  return NextResponse.json({
    mode: 'live',
    index,
    spotPrice,
    timestamp: new Date().toISOString(),
    strikes: flow,
  });
}
