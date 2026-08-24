/**
 * Kite Candles — Historical price data for chart
 * GET /api/kite/candles?token=256265&interval=15minute&days=1
 *
 * Returns OHLCV candles for the Nifty50 price line chart
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCandles, NIFTY50_TOKEN, isKiteConfigured, kiteHeaders as getKiteHeaders } from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({ mode: 'demo', message: 'Kite API not configured' });
  }

  const token = parseInt(req.nextUrl.searchParams.get('token') || String(NIFTY50_TOKEN));
  const interval = req.nextUrl.searchParams.get('interval') || '15minute';
  const days = parseInt(req.nextUrl.searchParams.get('days') || '1');

  let candles: Awaited<ReturnType<typeof getCandles>> = [];
  let debugInfo: Record<string, string> = {};

  try {
    // Direct Kite call for debugging
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const toIST = (d: Date) => new Date(d.getTime() + IST_OFFSET);
    const toDate = toIST(new Date());
    const fromDate = toIST(new Date());
    fromDate.setDate(fromDate.getDate() - days);

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    const fromStr = fmt(fromDate);
    const toStr = fmt(toDate);
    debugInfo.from = fromStr;
    debugInfo.to = toStr;
    debugInfo.serverTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    debugInfo.serverUTC = new Date().toISOString();
    debugInfo.url = `historical/${token}/${interval}?from=${fromStr}&to=${toStr}`;

    const res = await fetch(`https://api.kite.trade/instruments/historical/${token}/${interval}?from=${fromStr}&to=${toStr}&continuous=0`, {
      headers: {
        'Authorization': getKiteHeaders()['Authorization'],
        'X-Kite-Version': '3',
      },
    });

    debugInfo.kiteStatus = String(res.status);
    const data = await res.json();
    debugInfo.kiteResponseStatus = data.status;
    debugInfo.kiteErrorMsg = data.message || data.error_type || '';
    debugInfo.candlesFromKite = String(data.data?.candles?.length ?? 'none');

    candles = (data.data?.candles || []).map((c: any[]) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    }));
  } catch (err) {
    debugInfo.exception = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    mode: 'live',
    instrumentToken: token,
    interval,
    days,
    count: candles.length,
    timestamp: new Date().toISOString(),
    debug: debugInfo,
    candles,
  });
}
