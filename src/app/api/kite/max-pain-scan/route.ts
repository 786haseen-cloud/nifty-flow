/**
 * Max Pain Scan API
 * GET /api/kite/max-pain-scan
 *
 * Fetches max pain for ALL 4 indices + 15 stocks in one batched call.
 * Optimized: collects all option tokens first, then does ONE getQuotes batch.
 * Returns: { symbols: [{ symbol, name, type, spot, maxPain, dist }], timestamp }
 *
 * Used by OI Walls tab's "Max Pain Gravity Meter" section.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  INDEX_SPECS,
  STOCK_SPECS,
  getOptionInstruments,
  getQuotes,
  isKiteConfigured,
  type KiteInstrument,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

interface MaxPainResult {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spot: number;
  maxPain: number;
  dist: number;       // spot - maxPain (positive = above)
  distPct: number;    // (spot - maxPain) / spot * 100
  totalCEOI: number;
  totalPEOI: number;
}

// Compute max pain from strike data (same logic as OI Walls tab)
function computeMaxPain(strikes: { strike: number; ceOI: number; peOI: number }[]): number {
  if (strikes.length === 0) return 0;
  let minLoss = Infinity;
  let mpStrike = strikes[0].strike;

  for (const k of strikes) {
    let totalLoss = 0;
    for (const s of strikes) {
      totalLoss += Math.max(0, s.strike - k.strike) * s.ceOI;
      totalLoss += Math.max(0, k.strike - s.strike) * s.peOI;
    }
    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      mpStrike = k.strike;
    }
  }
  return mpStrike;
}

export async function GET(req: NextRequest) {
  const configured = applyKiteCredsFromRequest(req.url);
  if (!configured) {
    return NextResponse.json({
      mode: 'demo',
      message: 'Kite API not configured',
      symbols: [],
    });
  }

  const allSpecs = [
    ...INDEX_SPECS.map(s => ({ ...s, type: 'index' as const })),
    ...STOCK_SPECS.map(s => ({ ...s, type: 'stock' as const })),
  ];

  try {
    // Phase 1: Get spot prices for all symbols in one batch
    // Use spotKiteSymbol if the cash ticker differs from F&O ticker (e.g. TATAMOTORS → NSE:TATAMOTORS)
    const kiteSymbols = allSpecs.map(s => s.spotKiteSymbol || s.kiteSymbol);
    const spotQuotes = await getQuotes(kiteSymbols);
    if ('_error' in spotQuotes) {
      return NextResponse.json({
        mode: 'error',
        error: `Spot price fetch failed: ${String(spotQuotes._error)}`,
        symbols: [],
      }, { status: 502 });
    }

    // Map kiteSymbol → spot price
    const spotMap = new Map<string, number>();
    for (const spec of allSpecs) {
      const spotKey = spec.spotKiteSymbol || spec.kiteSymbol;
      const q = spotQuotes[spotKey];
      if (q?.lastPrice && q.lastPrice > 0) {
        spotMap.set(spec.symbol, q.lastPrice);
      }
    }

    // Phase 2: Collect ALL option instrument tokens for all symbols
    // and batch them into ONE getQuotes call
    interface SymbolTokens {
      symbol: string;
      name: string;
      type: 'index' | 'stock';
      spot: number;
      instruments: KiteInstrument[];
      strikeStep: number;
      lotSize: number;
    }

    const symbolDataList: SymbolTokens[] = [];
    const allOptionTokens: string[] = [];
    // Map: token string → { symbol, strike, ceOrPe }
    const tokenMeta = new Map<string, { symbol: string; strike: number; optionType: 'CE' | 'PE' }>();

    for (const spec of allSpecs) {
      const spot = spotMap.get(spec.symbol);
      if (!spot) continue; // skip if no spot price

      const { instruments, meta } = await getOptionInstruments(
        spec.symbol, spot, 4 // 4 strikes each side = 9 total (lighter than 5)
      );

      if (instruments.length === 0) continue;

      symbolDataList.push({
        symbol: spec.symbol,
        name: spec.name,
        type: spec.type,
        spot,
        instruments,
        strikeStep: meta.strikeStep,
        lotSize: meta.lotSize,
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

    // Phase 4: Compute max pain per symbol
    const results: MaxPainResult[] = [];

    for (const sd of symbolDataList) {
      // Group by strike for this symbol
      const strikeMap = new Map<number, { ceOI: number; peOI: number }>();

      for (const inst of sd.instruments) {
        const tok = String(inst.instrumentToken);
        const quote = optQuotes[tok];
        if (!quote) continue;

        const oi = quote.oi || 0;
        if (oi === 0) continue;

        if (!strikeMap.has(inst.strike)) {
          strikeMap.set(inst.strike, { ceOI: 0, peOI: 0 });
        }
        const entry = strikeMap.get(inst.strike)!;
        const meta = tokenMeta.get(tok);
        if (meta?.optionType === 'CE') entry.ceOI = oi;
        else entry.peOI = oi;
      }

      const strikes = [...strikeMap.entries()].map(([strike, data]) => ({
        strike,
        ceOI: data.ceOI,
        peOI: data.peOI,
      }));

      if (strikes.length < 3) continue;

      const mp = computeMaxPain(strikes);
      const dist = sd.spot - mp;
      const totalCEOI = strikes.reduce((s, k) => s + k.ceOI, 0);
      const totalPEOI = strikes.reduce((s, k) => s + k.peOI, 0);

      results.push({
        symbol: sd.symbol,
        name: sd.name,
        type: sd.type,
        spot: sd.spot,
        maxPain: mp,
        dist,
        distPct: (dist / sd.spot) * 100,
        totalCEOI,
        totalPEOI,
      });
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
