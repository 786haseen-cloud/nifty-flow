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
  getFutureInstrument,
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

// ─── Phase 1 Enhancement: Server-Side Caches ───
//
// Two in-memory caches that persist across polls on the same Vercel
// serverless instance (best-effort — Vercel may cold-start a new
// instance, in which case caches start empty and rebuild over the
// next 2 polls):
//
//   1. prevSnapshotCache: stores last OI snapshot per symbol → enables
//      ΔOI computation for the "OI Buildup Direction" factor.
//
//   2. vixHistoryCache: stores INDIA VIX readings with timestamps →
//      enables 30-min rate-of-change computation for the "VIX Regime"
//      factor.
//
// Both caches auto-expire entries older than 2 hours (post-session
// stale data shouldn't survive into the next trading day).

interface CachedSnapshot {
  strikes: StrikeOption[];
  timestamp: number;
}
const prevSnapshotCache = new Map<string, CachedSnapshot>();

interface CachedVIX {
  value: number;
  timestamp: number;
}
const vixHistoryCache: CachedVIX[] = [];
const VIX_HISTORY_MAX = 60;             // keep last 60 readings (60min @ 60s poll)
const VIX_LOOKBACK_MS = 30 * 60 * 1000; // 30 min lookback for ΔVIX%
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h TTL

/** Prune stale entries from both caches. */
function pruneCaches(): void {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [key, entry] of prevSnapshotCache.entries()) {
    if (entry.timestamp < cutoff) prevSnapshotCache.delete(key);
  }
  while (vixHistoryCache.length > 0 && vixHistoryCache[0].timestamp < cutoff) {
    vixHistoryCache.shift();
  }
}

/**
 * Compute VIX rate-of-change (%) over the last ~30 minutes.
 * Returns null if no historical reading is available.
 */
function computeVixChangePct(currentVix: number): number | null {
  if (vixHistoryCache.length === 0) return null;
  const now = Date.now();
  // Find the reading closest to (now - 30 min)
  const target = now - VIX_LOOKBACK_MS;
  let best: CachedVIX | null = null;
  let bestDist = Infinity;
  for (const v of vixHistoryCache) {
    const d = Math.abs(v.timestamp - target);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  if (!best || best.value <= 0) return null;
  // Only return RoC if the best match is within 10 min of the 30-min target
  // (otherwise we don't have enough history yet)
  if (Math.abs(best.timestamp - target) > 10 * 60 * 1000) return null;
  return ((currentVix - best.value) / best.value) * 100;
}

// India VIX kite symbol (NSE:INDIA VIX)
const INDIA_VIX_SYMBOL = 'NSE:INDIA VIX';

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
    // Also fetch INDIA VIX in the same call (cheap — one extra symbol)
    const kiteSymbols = [
      ...allSpecs.map(s => s.spotKiteSymbol || s.kiteSymbol),
      INDIA_VIX_SYMBOL,
    ];
    const spotQuotes = await getQuotes(kiteSymbols);
    if ('_error' in spotQuotes) {
      return NextResponse.json({
        mode: 'error',
        error: `Spot price fetch failed: ${String(spotQuotes._error)}`,
        symbols: [],
      }, { status: 502 });
    }

    // Extract India VIX (null if quote missing)
    const vixQuote = spotQuotes[INDIA_VIX_SYMBOL] as KiteQuote | undefined;
    const currentVix = vixQuote?.lastPrice && vixQuote.lastPrice > 0
      ? vixQuote.lastPrice
      : null;
    const vixChangePct = currentVix !== null ? computeVixChangePct(currentVix) : null;

    // Cache the current VIX reading for future 30-min RoC computation
    if (currentVix !== null) {
      vixHistoryCache.push({ value: currentVix, timestamp: Date.now() });
      if (vixHistoryCache.length > VIX_HISTORY_MAX) vixHistoryCache.shift();
    }

    // Prune stale cache entries (cheap, runs once per poll)
    pruneCaches();

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

    // Phase 1.5 (NEW): Resolve FUTURE instrument tokens for all symbols that
    // have a spot. We'll batch-fetch their quotes alongside options in Phase 3.
    // This adds the "Futures Basis" factor to the signal engine.
    const futureTokenMap = new Map<string, string>();  // symbol → future token (string)
    const futureTokenToSymbol = new Map<string, string>();  // reverse lookup
    const futureTokenList: string[] = [];
    for (const spec of allSpecs) {
      if (!spotMap.has(spec.symbol)) continue;
      try {
        const fut = await getFutureInstrument(spec.symbol);
        if (fut) {
          const tok = String(fut.instrumentToken);
          futureTokenMap.set(spec.symbol, tok);
          futureTokenToSymbol.set(tok, spec.symbol);
          futureTokenList.push(tok);
        }
      } catch (err) {
        // Future lookup failed for this symbol — non-fatal, basis will be null
        console.warn(`[magnet-scan] getFutureInstrument(${spec.symbol}) failed:`, err);
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

    // Phase 3: ONE batched getQuotes call for ALL option tokens + future tokens
    // (Futures quotes are batched in the same call — no extra round-trip)
    const allTokens = [...allOptionTokens, ...futureTokenList];
    const allQuotes = await getQuotes(allTokens);
    if ('_error' in allQuotes) {
      return NextResponse.json({
        mode: 'error',
        error: `Option quotes fetch failed: ${String(allQuotes._error)}`,
        symbols: [],
      }, { status: 502 });
    }
    const optQuotes = allQuotes;

    // Extract future prices per symbol
    const futurePriceMap = new Map<string, number>();  // symbol → future LTP
    for (const tok of futureTokenList) {
      const symbol = futureTokenToSymbol.get(tok);
      if (!symbol) continue;
      const q = allQuotes[tok] as KiteQuote | undefined;
      if (q?.lastPrice && q.lastPrice > 0) {
        futurePriceMap.set(symbol, q.lastPrice);
      }
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

      // Look up previous OI snapshot for this symbol (for OI buildup factor)
      const prevCached = prevSnapshotCache.get(sd.symbol);
      const prevStrikes = prevCached?.strikes ?? null;

      // Look up future price for this symbol (for basis factor)
      const futurePrice = futurePriceMap.get(sd.symbol) ?? null;

      const result = computeMagnet(
        sd.symbol,
        strikes,
        sd.spot,
        sd.lotSize,
        sd.strikeStep,
        dte,
        { name: sd.name, type: sd.type, spotTime: sd.spotTime },
        {
          futurePrice,
          prevStrikes,
          vix: currentVix,
          vixChangePct,
        },
      );

      // Cache the current OI snapshot for next poll's ΔOI computation.
      // (Store a deep copy so the cached array isn't mutated by reference.)
      if (result) {
        prevSnapshotCache.set(sd.symbol, {
          strikes: strikes.map(s => ({ ...s })),
          timestamp: Date.now(),
        });
        results.push(result);
      }
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
