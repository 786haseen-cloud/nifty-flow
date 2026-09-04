/**
 * Magnet Scan API
 * GET /api/kite/magnet-scan
 *
 * Computes the full "Magnet & Gamma" dashboard data for ALL 4 indices + 15
 * stocks in ONE batched call. Used by the Trends tab's "Magnet & Gamma
 * Dashboard" section.
 *
 * For each symbol returns:
 *   - maxPain + distance from spot
 *   - GEX per strike + cumulative zero-gamma flip
 *   - Magnet Zone (top-3 strikes by composite score)
 *   - Charm flow direction + magnitude (end-of-day drift)
 *   - Pinning Probability (0..100)
 *
 * Performance: same batched pattern as max-pain-scan — collects all option
 * tokens for all 19 symbols, then does ONE getQuotes call. With 11 strikes
 * per symbol × 2 (CE+PE) × 19 symbols = ~418 tokens in a single batch.
 *
 * Poll frequency: clients should poll every 60 seconds (these are slow-moving
 * metrics; max pain + GEX don't change dramatically in seconds).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  INDEX_SPECS,
  STOCK_SPECS,
  getOptionInstruments,
  getQuotes,
  type KiteInstrument,
  type KiteQuote,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';
import {
  computeMagnet,
  type MagnetResult,
  type StrikeOption,
} from '@/lib/magnet-engine';

// ─── Helpers ───

/**
 * Compute days-to-expiry for a given expiry string.
 * Floors at 0.5 day so Black-Scholes doesn't blow up at expiry-day.
 */
function computeDTE(expiry: string): number {
  const now = new Date();
  const expiryDate = new Date(expiry);
  // Expiry is at market close (15:30 IST = 10:00 UTC)
  expiryDate.setUTCHours(10, 0, 0, 0);
  const dte = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0.5, dte);
}

// ─── Route Handler ───

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
      symbols: [],
      timestamp: new Date().toISOString(),
    });
  }

  const allSpecs = [
    ...INDEX_SPECS.map(s => ({ ...s, type: 'index' as const })),
    ...STOCK_SPECS.map(s => ({ ...s, type: 'stock' as const })),
  ];

  try {
    // Phase 1: Get spot prices for all 19 symbols in one batch
    const kiteSymbols = allSpecs.map(s => s.spotKiteSymbol || s.kiteSymbol);
    const spotQuotes = await getQuotes(kiteSymbols);
    if ('_error' in spotQuotes) {
      return NextResponse.json({
        mode: 'error',
        error: `Spot price fetch failed: ${String(spotQuotes._error)}`,
        symbols: [],
      }, { status: 502 });
    }

    const spotMap = new Map<string, { price: number; time: string }>();
    for (const spec of allSpecs) {
      const spotKey = spec.spotKiteSymbol || spec.kiteSymbol;
      const q = spotQuotes[spotKey] as KiteQuote | undefined;
      if (q?.lastPrice && q.lastPrice > 0) {
        spotMap.set(spec.symbol, {
          price: q.lastPrice,
          time: new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            timeZone: 'Asia/Kolkata', // Vercel runs UTC — force IST for spot stamps
          }),
        });
      }
    }

    // Phase 2: Collect ALL option instrument tokens for all symbols
    interface SymbolTokens {
      symbol: string;
      name: string;
      type: 'index' | 'stock';
      spot: number;
      spotTime: string;
      instruments: KiteInstrument[];
      strikeStep: number;
      lotSize: number;
      expiry: string;
    }

    const symbolDataList: SymbolTokens[] = [];
    const allOptionTokens: string[] = [];
    const tokenMeta = new Map<string, { symbol: string; strike: number; optionType: 'CE' | 'PE' }>();

    for (const spec of allSpecs) {
      const spotInfo = spotMap.get(spec.symbol);
      if (!spotInfo) continue;

      // Use 5 strikes each side (11 total) for richer GEX profile
      const { instruments, meta } = await getOptionInstruments(
        spec.symbol, spotInfo.price, 5
      );
      if (instruments.length === 0) continue;

      // Get the expiry from the first instrument
      const expiry = instruments[0].expiry;

      symbolDataList.push({
        symbol: spec.symbol,
        name: spec.name,
        type: spec.type,
        spot: spotInfo.price,
        spotTime: spotInfo.time,
        instruments,
        strikeStep: meta.strikeStep,
        lotSize: meta.lotSize,
        expiry,
      });

      for (const inst of instruments) {
        const tok = String(inst.instrumentToken);
        allOptionTokens.push(tok);
        const optType = inst.tradingSymbol.endsWith('CE') ? 'CE' : 'PE';
        tokenMeta.set(tok, { symbol: spec.symbol, strike: inst.strike, optionType: optType });
      }
    }

    // Phase 3: ONE batched getQuotes call for ALL option tokens
    const optQuotes = await getQuotes(allOptionTokens);
    if ('_error' in optQuotes) {
      return NextResponse.json({
        mode: 'error',
        error: `Option quotes fetch failed: ${String(optQuotes._error)}`,
        symbols: [],
      }, { status: 502 });
    }

    // Phase 4: Compute magnet result per symbol
    const results: MagnetResult[] = [];

    for (const sd of symbolDataList) {
      // Group option quotes by strike for this symbol
      const strikeMap = new Map<number, { ceLTP: number; peLTP: number; ceOI: number; peOI: number }>();

      for (const inst of sd.instruments) {
        const tok = String(inst.instrumentToken);
        const quote = optQuotes[tok] as KiteQuote | undefined;
        if (!quote) continue;

        const oi = quote.oi || 0;
        const ltp = quote.lastPrice || 0;

        if (!strikeMap.has(inst.strike)) {
          strikeMap.set(inst.strike, { ceLTP: 0, peLTP: 0, ceOI: 0, peOI: 0 });
        }
        const entry = strikeMap.get(inst.strike)!;
        const meta = tokenMeta.get(tok);
        if (meta?.optionType === 'CE') {
          entry.ceLTP = ltp;
          entry.ceOI = oi;
        } else if (meta?.optionType === 'PE') {
          entry.peLTP = ltp;
          entry.peOI = oi;
        }
      }

      // Build StrikeOption array (filter out strikes with zero OI on both sides)
      const strikes: StrikeOption[] = [...strikeMap.entries()]
        .map(([strike, data]) => ({
          strike,
          ceOI: data.ceOI,
          peOI: data.peOI,
          ceLTP: data.ceLTP,
          peLTP: data.peLTP,
          // Delta placeholders — recomputed internally by the engine via Black-Scholes
          ceDelta: 0,
          peDelta: 0,
        }))
        .filter(s => s.ceOI > 0 || s.peOI > 0)
        .sort((a, b) => a.strike - b.strike);

      if (strikes.length < 3) continue;

      const dte = computeDTE(sd.expiry);

      const result = computeMagnet(
        sd.symbol,
        strikes,
        sd.spot,
        sd.lotSize,
        sd.strikeStep,
        dte,
        { name: sd.name, type: sd.type, spotTime: sd.spotTime },
      );

      if (result) results.push(result);
    }

    // Sort: indices first, then stocks
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'index' ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return NextResponse.json({
      mode: 'live',
      symbols: results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      mode: 'error',
      error: errMsg,
      symbols: [],
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
