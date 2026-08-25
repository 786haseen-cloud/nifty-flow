/**
 * Kite Candles — Historical price data for chart
 * GET /api/kite/candles?token=256265&interval=15minute&days=1
 *
 * Returns OHLCV candles for the Nifty50 price line chart
 *
 * Debug mode: add &debug=1 to surface the raw Kite response when count=0.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCandles, NIFTY50_TOKEN, kiteHeaders } from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

const KITE_BASE = 'https://api.kite.trade';

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
  const debug = req.nextUrl.searchParams.get('debug') === '1';

  const candles = await getCandles(token, interval, days);

  // If debug requested AND no candles, fetch the raw Kite response to surface the actual error
  let debugInfo: any = undefined;
  if (debug && candles.length === 0) {
    try {
      const IST_OFFSET = 5.5 * 60 * 60 * 1000;
      const toIST = (d: Date) => new Date(d.getTime() + IST_OFFSET);
      const toDate = toIST(new Date());
      const fromDate = toIST(new Date());
      fromDate.setDate(fromDate.getDate() - days);
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00`;
      const url = `${KITE_BASE}/instruments/historical/${token}/${interval}?from=${encodeURIComponent(fmt(fromDate))}&to=${encodeURIComponent(fmt(toDate))}&continuous=0`;
      const res = await fetch(url, { headers: kiteHeaders() });
      const body = await res.text();
      debugInfo = {
        requestUrl: url,
        httpStatus: res.status,
        responseBody: body.substring(0, 800),
      };
    } catch (e: any) {
      debugInfo = { error: e.message };
    }
  }

  return NextResponse.json({
    mode: 'live',
    instrumentToken: token,
    interval,
    days,
    count: candles.length,
    timestamp: new Date().toISOString(),
    candles,
    ...(debugInfo ? { debug: debugInfo } : {}),
  });
}
