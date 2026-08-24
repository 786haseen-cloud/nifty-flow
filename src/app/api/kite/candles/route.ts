/**
 * Kite Candles — Historical price data for chart
 * GET /api/kite/candles?token=256265&interval=15minute&days=1
 *
 * Returns OHLCV candles for the Nifty50 price line chart
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCandles, NIFTY50_TOKEN } from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const token = parseInt(req.nextUrl.searchParams.get('token') || String(NIFTY50_TOKEN));
  const interval = req.nextUrl.searchParams.get('interval') || '15minute';
  const days = parseInt(req.nextUrl.searchParams.get('days') || '1');

  const candles = await getCandles(token, interval, days);

  return NextResponse.json({
    mode: 'live',
    instrumentToken: token,
    interval,
    days,
    count: candles.length,
    timestamp: new Date().toISOString(),
    candles,
  });
}
