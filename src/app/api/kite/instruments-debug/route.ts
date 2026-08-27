/**
 * Instruments CSV Debug Endpoint
 * GET /api/kite/instruments-debug
 * GET /api/kite/instruments-debug?refresh=1   (force re-download)
 *
 * Surfaces the live state of the Kite instruments CSV download + parser so we can
 * diagnose "No option instruments found" errors without guessing. Returns:
 *   - HTTP status + first few rows of the raw CSV (so we can see the actual format)
 *   - Total instruments parsed
 *   - Per-exchange counts (NSE, BSE, NFO, BFO, ...)
 *   - Sample NIFTY options (proves options are being found correctly)
 *   - Cache state (size + age)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getInstruments, invalidateInstrumentsCache, kiteHeaders, getQuotes } from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

const KITE_BASE = 'https://api.kite.trade';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured. Pass ?api_key=X&access_token=Y in the URL.',
    });
  }

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (refresh) {
    invalidateInstrumentsCache();
  }

  // Step 1: Re-download the raw CSV directly (bypass cache) to see what Kite actually returns
  let rawCsvStatus = 0;
  let rawCsvFirstRows: string[] = [];
  let rawCsvTotalLines = 0;
  let rawCsvError: string | null = null;
  try {
    const res = await fetch(`${KITE_BASE}/instruments`, { headers: kiteHeaders() });
    rawCsvStatus = res.status;
    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n');
      rawCsvTotalLines = lines.length;
      rawCsvFirstRows = lines.slice(0, 5);
    } else {
      rawCsvError = (await res.text()).substring(0, 500);
    }
  } catch (e) {
    rawCsvError = e instanceof Error ? e.message : String(e);
  }

  // Step 2: Fetch via the cached getInstruments() (so we see what the rest of the app sees)
  const allInstruments = await getInstruments(undefined, refresh);

  // Step 3: Per-exchange breakdown
  const byExchange: Record<string, number> = {};
  for (const i of allInstruments) {
    byExchange[i.exchange] = (byExchange[i.exchange] || 0) + 1;
  }

  // Step 4: Per-segment breakdown (top 10)
  const bySegment: Record<string, number> = {};
  for (const i of allInstruments) {
    bySegment[i.segment] = (bySegment[i.segment] || 0) + 1;
  }
  const topSegments = Object.entries(bySegment)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([seg, count]) => ({ segment: seg, count }));

  // Step 5: Per-instrumentType breakdown
  const byType: Record<string, number> = {};
  for (const i of allInstruments) {
    byType[i.instrumentType] = (byType[i.instrumentType] || 0) + 1;
  }

  // Step 6: Find sample NIFTY options on the NFO exchange
  const niftyOptions = allInstruments
    .filter(i =>
      i.exchange === 'NFO' &&
      i.instrumentType === 'OPTIDX' &&
      i.name.toUpperCase().includes('NIFTY') &&
      !i.name.toUpperCase().includes('BANK') &&
      !i.name.toUpperCase().includes('FIN')
    )
    .slice(0, 5)
    .map(i => ({
      tradingSymbol: i.tradingSymbol,
      name: i.name,
      exchange: i.exchange,
      segment: i.segment,
      instrumentType: i.instrumentType,
      strike: i.strike,
      lotSize: i.lotSize,
      expiry: i.expiry,
      instrumentToken: i.instrumentToken,
    }));

  // Step 7: Verify a live quote on a NIFTY option token (proves the token is real + valid)
  let quoteTest: any = null;
  if (niftyOptions.length > 0) {
    const testToken = String(niftyOptions[0].instrumentToken);
    try {
      const q = await getQuotes([testToken]);
      if ('_error' in q) {
        quoteTest = { status: 'error', error: String(q._error) };
      } else {
        const quote = (Object.values(q)[0] as any) || null;
        quoteTest = {
          status: 'ok',
          token: testToken,
          lastPrice: quote?.lastPrice || 0,
          oi: quote?.oi || 0,
          volume: quote?.volume || 0,
        };
      }
    } catch (e) {
      quoteTest = { status: 'exception', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Step 8: Spot price sanity check (NIFTY 50 token = 256265)
  let spotTest: any = null;
  try {
    const sq = await getQuotes(['256265']);
    if (!('_error' in sq)) {
      const q = (Object.values(sq)[0] as any) || null;
      spotTest = {
        status: 'ok',
        symbol: 'NSE:NIFTY 50',
        lastPrice: q?.lastPrice || 0,
        close: q?.close || 0,
        change: q?.lastPrice && q?.close ? ((q.lastPrice - q.close) / q.close * 100).toFixed(2) + '%' : 'n/a',
      };
    }
  } catch (e) {
    spotTest = { status: 'exception', error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    mode: 'live',
    timestamp: new Date().toISOString(),
    refresh_forced: refresh,
    raw_csv: {
      http_status: rawCsvStatus,
      total_lines: rawCsvTotalLines,
      first_5_rows: rawCsvFirstRows,
      error: rawCsvError,
    },
    parsed: {
      total_instruments: allInstruments.length,
      by_exchange: byExchange,
      top_segments: topSegments,
      by_instrument_type: byType,
    },
    nifty_option_samples: niftyOptions,
    quote_test_on_first_nifty_option: quoteTest,
    nifty50_spot: spotTest,
    diagnosis: niftyOptions.length > 0
      ? 'OK — NIFTY options found. Strike Flow / Options Flow should work.'
      : rawCsvStatus !== 200
        ? `FAILED — Kite instruments CSV download returned HTTP ${rawCsvStatus}. Check credentials/token.`
        : allInstruments.length === 0
          ? 'FAILED — CSV downloaded OK but parser produced 0 instruments. Parser bug?'
          : 'FAILED — CSV parsed but 0 NIFTY options matched. Filter bug? (check by_exchange has NFO, by_instrument_type has OPTIDX)',
  });
}
