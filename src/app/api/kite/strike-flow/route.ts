/**
 * Strike Flow Map API
 * GET /api/kite/strike-flow?symbol=NIFTY
 * GET /api/kite/strike-flow?symbol=HDFCBANK
 * GET /api/kite/strike-flow?symbol=RELIANCE&spotPrice=2950
 *
 * Supports all 4 indices + 15 stocks.
 * Returns raw per-strike snapshot (OI, LTP, volume, delta).
 * Frontend stores 2 consecutive snapshots and computes 4-color flow.
 * This avoids Vercel serverless state-loss between cold starts.
 *
 * Debug: ?debug=1 returns option-instrument lookup diagnostics instead of
 * the generic 'No options data returned from Kite' error. Useful for
 * distinguishing between 'option lookup failed' and 'option quote failed'.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getStrikeFlowSnapshot,
  getQuotes,
  getOptionInstruments,
  getInstrumentSpec,
  getInstruments,
  type StrikeFlowSnapshot,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
    });
  }

  const symbol = (req.nextUrl.searchParams.get('symbol') || 'NIFTY').toUpperCase();
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  let spotPrice = parseFloat(req.nextUrl.searchParams.get('spotPrice') || '0');

  // Validate symbol
  const spec = getInstrumentSpec(symbol);
  if (!spec) {
    return NextResponse.json({
      mode: 'error',
      symbol,
      error: `Unknown symbol: ${symbol}`,
    }, { status: 400 });
  }

  try {
    // Auto-fetch spot price if not provided
    if (spotPrice <= 0) {
      const quotes = await getQuotes([spec.kiteSymbol]);
      const q = quotes[spec.kiteSymbol];
      if (q?.lastPrice && q.lastPrice > 0) {
        spotPrice = q.lastPrice;
      }
    }

    if (spotPrice <= 0) {
      return NextResponse.json({
        mode: 'error',
        symbol,
        error: `Could not fetch spot price for ${symbol}. Is market open?`,
      }, { status: 502 });
    }

    // Debug branch: inspect each step of the lookup pipeline
    if (debug) {
      const optLookup = await getOptionInstruments(symbol, spotPrice, 5);

      // If we have instruments, also test the quote call
      let quoteTest: any = null;
      if (optLookup.instruments.length > 0) {
        const testTokens = optLookup.instruments.slice(0, 3).map(i => String(i.instrumentToken));
        const testQuotes = await getQuotes(testTokens);
        if ('_error' in testQuotes) {
          quoteTest = { status: 'error', error: String(testQuotes._error) };
        } else {
          quoteTest = {
            status: 'ok',
            count: Object.keys(testQuotes).length,
            sample: Object.entries(testQuotes).slice(0, 2).map(([k, v]: [string, any]) => ({
              token: k,
              lastPrice: v.lastPrice,
              oi: v.oi,
              volume: v.volume,
            })),
          };
        }
      }

      return NextResponse.json({
        mode: 'live',
        symbol,
        spotPrice,
        debug: {
          optionInstrumentsCount: optLookup.instruments.length,
          lotSize: optLookup.meta.lotSize,
          strikeStep: optLookup.meta.strikeStep,
          sampleOptionInstruments: optLookup.instruments.slice(0, 3).map(i => ({
            tradingSymbol: i.tradingSymbol,
            name: i.name,
            strike: i.strike,
            instrumentToken: i.instrumentToken,
            expiry: i.expiry,
            instrumentType: i.instrumentType,
            segment: i.segment,
            exchange: i.exchange,
          })),
          quoteTest,
        },
      });
    }

    // Non-debug: return a SPECIFIC error message (not generic "No options data")
    // so the user knows exactly what failed.
    const snapshot = await getStrikeFlowSnapshot(symbol, spotPrice);

    if (!snapshot) {
      // Diagnose the specific failure
      const optLookup = await getOptionInstruments(symbol, spotPrice, 5);
      let specificError: string;

      if (optLookup.instruments.length === 0) {
        specificError = `No option instruments found for ${symbol} at spot ${spotPrice}. ` +
          `Check if Kite CSV parsing is correct (instrumentType=${spec.instrumentType}, segment=${spec.segment}).`;
      } else {
        // Instruments found but snapshot failed → quote API issue
        const testTokens = optLookup.instruments.slice(0, 3).map(i => String(i.instrumentToken));
        const testQuotes = await getQuotes(testTokens);
        if ('_error' in testQuotes) {
          specificError = `Option instruments found (${optLookup.instruments.length}) but quote API failed: ${String(testQuotes._error)}`;
        } else {
          specificError = `Option instruments found (${optLookup.instruments.length}) and quotes work, but snapshot was empty. Unexpected.`;
        }
      }

      return NextResponse.json({
        mode: 'error',
        symbol,
        spotPrice,
        error: specificError,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    return NextResponse.json({
      mode: 'live',
      ...snapshot,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      symbol,
      spotPrice,
      error: errMsg,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
