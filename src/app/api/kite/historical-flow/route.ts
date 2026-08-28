/**
 * Historical Flow Backfill API
 * GET /api/kite/historical-flow
 *
 * Reconstructs the morning-to-now options flow trend from Kite's historical
 * OI candles. This solves the "options flow only shows data from when the app
 * was opened" problem.
 *
 * HOW IT WORKS
 * ------------
 * 1. For each symbol (4 indices + 15 stocks), find ATM ± 5 strikes
 * 2. For each strike's CE and PE contract, fetch today's 5-minute candles
 *    from Kite's historical API. F&O candles include OI (c[6]).
 * 3. Walk through consecutive candles, compute delta-weighted flow using
 *    the same 4-color engine logic as the client.
 * 4. Aggregate per symbol → per 5-min interval → return as FlowTrendPoint[].
 *
 * RATE LIMIT CONSIDERATION
 * --------------------------
 * 4 indices × 11 strikes × 2 (CE+PE) = 88 calls
 * 15 stocks × 9 strikes × 2 (CE+PE) = 270 calls
 * Total: ~358 historical API calls
 * Kite limit: 3 calls/second (historical) → ~2 minutes
 *
 * To stay within limits, we:
 * - Batch sequentially with 350ms delay between calls
 * - Cache the result in-memory for 60 seconds (repeat calls within a minute
 *   return the cached result instantly)
 * - Only fetch once per trading day (the client calls this on first poll only)
 *
 * TRADE-OFF
 * ----------
 * Strikes are picked based on CURRENT spot price. If spot moved significantly
 * since morning, strikes that were active at 9:15 but are now far OTM won't be
 * included. This is inherent to the approach — fixing it would require fetching
 * ALL strikes (hundreds) which would exceed rate limits.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getInstruments,
  getQuotes,
  getCandles,
  INDEX_SPECS,
  STOCK_SPECS,
  KITE_FNO_ALT_NAMES,
  type KiteHistoricalCandle,
  type KiteQuote,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';
import { istTodayISO, extractTimeSecFromKiteTS } from '@/lib/ist';

// ─── Types ───

interface HistoricalFlowResponse {
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  flowTrend: Array<{
    time: string;
    NIFTY: number;
    BANKNIFTY: number;
    FINNIFTY: number;
    SENSEX: number;
    stockAggregate: number;
  }>;
  /** Last OI snapshot per symbol per strike — used by client to continue
   *  delta computation from the latest historical candle. */
  prevSnapshots: Record<string, Array<{
    strike: number;
    ceLTP: number;
    peLTP: number;
    ceOI: number;
    peOI: number;
    ceVol: number;
    peVol: number;
    ceDelta: number;
    peDelta: number;
  }>>;
  /** Cumulative flow totals per symbol (Cr) — client resumes from these */
  cumulativeFlow: Record<string, number>;
  error?: string;
}

// ─── In-memory cache (survives between Vercel function invocations on same instance) ───

let cachedResponse: HistoricalFlowResponse | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

// ─── Black-Scholes Delta (same as highest-bet route) ───

function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

function bsDelta(isCall: boolean, S: number, K: number, T: number, r = 0.065, sigma = 0): number {
  if (T <= 0 || S <= 0 || K <= 0) return isCall ? 0.5 : -0.5;
  if (sigma <= 0) {
    const moneyness = (S - K) / S;
    sigma = 0.12 + Math.abs(moneyness) * 0.3;
  }
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return isCall ? normCDF(d1) : normCDF(d1) - 1;
}

// ─── 4-Color Flow Engine (server-side copy) ───

function computeFlowBetweenCandles(
  prev: { ceOI: number; peOI: number; ceLTP: number; peLTP: number; ceDelta: number; peDelta: number },
  curr: { ceOI: number; peOI: number; ceLTP: number; peLTP: number; ceDelta: number; peDelta: number },
  lotSize: number,
): number {
  let bullish = 0;
  let bearish = 0;
  const CR = 10000000;

  const ceDeltaOI = curr.ceOI - prev.ceOI;
  const peDeltaOI = curr.peOI - prev.peOI;
  const ceDeltaPrice = curr.ceLTP - prev.ceLTP;
  const peDeltaPrice = curr.peLTP - prev.peLTP;

  if (ceDeltaOI > 0) {
    const val = (Math.abs(ceDeltaOI) * curr.ceDelta * lotSize) / CR;
    if (ceDeltaPrice > 0) bullish += val; else bearish += val;
  } else if (ceDeltaOI < 0) {
    const val = (Math.abs(ceDeltaOI) * 0.3 * curr.ceDelta * lotSize) / CR;
    if (ceDeltaPrice > 0) bullish += val; else bearish += val;
  }

  if (peDeltaOI > 0) {
    const val = (Math.abs(peDeltaOI) * curr.peDelta * lotSize) / CR;
    if (peDeltaPrice > 0) bullish += val; else bearish += val;
  } else if (peDeltaOI < 0) {
    const val = (Math.abs(peDeltaOI) * 0.3 * curr.peDelta * lotSize) / CR;
    if (peDeltaPrice > 0) bullish += val; else bearish += val;
  }

  return bullish - bearish;
}

// ─── Historical Flow Computation ───

async function fetchHistoricalFlow(): Promise<HistoricalFlowResponse> {
  const allSpecs = [...INDEX_SPECS, ...STOCK_SPECS];
  const allInstruments = await getInstruments();
  if (allInstruments.length === 0) {
    return { mode: 'error', timestamp: new Date().toISOString(), flowTrend: [], prevSnapshots: {}, cumulativeFlow: {}, error: 'Instruments empty' };
  }

  // Step 1: Get spot prices for all symbols to determine ATM
  const cashTokenList: string[] = [];
  // Kite uses different names for index cash instruments vs our short symbols.
  // e.g. FINNIFTY's cash instrument is named "NIFTY FIN SERVICE".
  const KITE_INDEX_NAMES: Record<string, string[]> = {
    'NIFTY': ['NIFTY 50', 'NIFTY'],
    'BANKNIFTY': ['NIFTY BANK', 'BANKNIFTY'],
    'FINNIFTY': ['NIFTY FIN SERVICE', 'FINNIFTY'],
    'SENSEX': ['SENSEX'],
  };

  const specCashTokens: Array<{ spec: typeof allSpecs[0]; cashToken: number }> = [];

  for (const spec of allSpecs) {
    const isIndex = spec.instrumentType === 'OPTIDX';
    const cashExchange = spec.symbol === 'SENSEX' ? 'BSE' : 'NSE';
    const cashType = isIndex ? 'INDEX' : 'EQ';
    const altNames = KITE_INDEX_NAMES[spec.symbol] || [spec.symbol];

    const cashInst = allInstruments.find(i =>
      i.exchange === cashExchange &&
      i.instrumentType === cashType &&
      (altNames.some(n => i.tradingSymbol.toUpperCase() === n.toUpperCase()) ||
        altNames.some(n => i.name.toUpperCase().includes(n.toUpperCase())))
    );

    if (cashInst) {
      cashTokenList.push(String(cashInst.instrumentToken));
      specCashTokens.push({ spec, cashToken: cashInst.instrumentToken });
    }
  }

  if (cashTokenList.length === 0) {
    return { mode: 'error', timestamp: new Date().toISOString(), flowTrend: [], prevSnapshots: {}, cumulativeFlow: {}, error: 'No cash tokens' };
  }

  const cashQuotes = await getQuotes(cashTokenList);
  if ('_error' in cashQuotes) {
    return { mode: 'error', timestamp: new Date().toISOString(), flowTrend: [], prevSnapshots: {}, cumulativeFlow: {}, error: 'Quote error' };
  }

  // Step 2: For each symbol, find option strike tokens + compute historical flow
  interface SymbolFlowResult {
    symbol: string;
    type: 'index' | 'stock';
    flowPerTimestamp: Map<string, number>;
    lastSnapshot: Array<{ strike: number; ceLTP: number; peLTP: number; ceOI: number; peOI: number; ceVol: number; peVol: number; ceDelta: number; peDelta: number }>;
    totalFlow: number;
  }

  const results: SymbolFlowResult[] = [];
  let apiCallCount = 0;

  for (const { spec, cashToken } of specCashTokens) {
    const spotQ = cashQuotes[String(cashToken)] as KiteQuote | undefined;
    if (!spotQ?.lastPrice || spotQ.lastPrice <= 0) continue;

    const spotPrice = spotQ.lastPrice;
    const isIndex = spec.instrumentType === 'OPTIDX';
    const optExchange = isIndex ? (spec.symbol === 'SENSEX' ? 'BFO' : 'NFO') : 'NFO';

    // CRITICAL FIX: Use KITE_FNO_ALT_NAMES for index symbols to match Kite's
    // actual CSV names (e.g. 'NIFTY BANK' for BANKNIFTY, 'NIFTY FIN SERVICE' for FINNIFTY).
    const optAltNames = isIndex
      ? (KITE_FNO_ALT_NAMES[spec.symbol] || [spec.symbol])
      : [spec.symbol.toUpperCase()];
    const opts = allInstruments.filter(i =>
      i.exchange === optExchange &&
      i.instrumentType === spec.instrumentType &&
      optAltNames.some(n =>
        i.name.toUpperCase().includes(n.toUpperCase()) ||
        i.tradingSymbol.toUpperCase().includes(n.toUpperCase())
      )
    );

    if (opts.length === 0) continue;

    const lotSize = opts[0].lotSize || 1;

    // Derive strike step
    const uniqueStrikes = [...new Set(opts.map(o => o.strike))].sort((a, b) => a - b);
    let strikeStep = 50;
    if (uniqueStrikes.length >= 2) {
      const gaps: Record<number, number> = {};
      for (let i = 1; i < uniqueStrikes.length; i++) {
        const gap = Math.round(uniqueStrikes[i] - uniqueStrikes[i - 1]);
        gaps[gap] = (gaps[gap] || 0) + 1;
      }
      strikeStep = parseInt(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]) || 50;
    }

    // Nearest expiry
    const todayStr = istTodayISO();
    const nearestExpiry = [...new Set(opts.map(o => o.expiry))].sort()
      .find(e => e >= todayStr) || opts[0].expiry;

    const expiryOpts = opts.filter(o => o.expiry === nearestExpiry);
    const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;
    const strikesAround = spec.strikesAround;
    const strikeList = Array.from({ length: strikesAround * 2 + 1 }, (_, i) =>
      atmStrike - strikesAround * strikeStep + i * strikeStep
    );

    // Group CE/PE tokens per strike
    const strikeTokens: Array<{ strike: number; ceToken: number; peToken: number }> = [];
    for (const inst of expiryOpts) {
      if (!strikeList.includes(inst.strike)) continue;
      const isCE = inst.tradingSymbol.endsWith('CE');
      const existing = strikeTokens.find(s => s.strike === inst.strike);
      if (isCE) {
        if (existing) existing.ceToken = inst.instrumentToken;
        else strikeTokens.push({ strike: inst.strike, ceToken: inst.instrumentToken, peToken: 0 });
      } else {
        if (existing) existing.peToken = inst.instrumentToken;
        else strikeTokens.push({ strike: inst.strike, ceToken: 0, peToken: inst.instrumentToken });
      }
    }

    // Time to expiry for delta
    const expiryDate = new Date(nearestExpiry);
    const daysToExpiry = Math.max(0.5, (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const T = daysToExpiry / 365;

    // Fetch 5-min candles for each CE and PE contract
    const ceCandlesByToken = new Map<number, KiteHistoricalCandle[]>();
    const peCandlesByToken = new Map<number, KiteHistoricalCandle[]>();

    const tokensToFetch: Array<{ token: number; strike: number; isCE: boolean }> = [];
    for (const st of strikeTokens) {
      if (st.ceToken > 0) tokensToFetch.push({ token: st.ceToken, strike: st.strike, isCE: true });
      if (st.peToken > 0) tokensToFetch.push({ token: st.peToken, strike: st.strike, isCE: false });
    }

    // Fetch with rate limit (3/s for historical)
    for (const { token, strike, isCE } of tokensToFetch) {
      try {
        apiCallCount++;
        const candles = await getCandles(token, '5minute', 1);
        if (candles.length > 0) {
          if (isCE) ceCandlesByToken.set(strike, candles);
          else peCandlesByToken.set(strike, candles);
        }
        // Rate limit: sleep every 3 calls (~350ms between, under 3/s limit)
        if (apiCallCount % 3 === 0) {
          await new Promise(r => setTimeout(r, 350));
        }
      } catch (e) {
        console.warn(`[HistFlow] ${spec.symbol} ${strike} ${isCE ? 'CE' : 'PE'}:`, e);
      }
    }

    // Step 3: Walk through 5-min candles, compute flow per timestamp
    const flowPerTimestamp = new Map<string, number>();
    let totalFlow = 0;

    const allTimestamps = new Set<string>();
    for (const [, candles] of ceCandlesByToken) {
      for (const c of candles) allTimestamps.add(c.timestamp);
    }
    for (const [, candles] of peCandlesByToken) {
      for (const c of candles) allTimestamps.add(c.timestamp);
    }

    const sortedTimestamps = [...allTimestamps].sort();

    for (let t = 1; t < sortedTimestamps.length; t++) {
      const prevTime = sortedTimestamps[t - 1];
      const currTime = sortedTimestamps[t];
      let intervalFlow = 0;

      for (const strike of strikeList) {
        const ceCandles = ceCandlesByToken.get(strike);
        const peCandles = peCandlesByToken.get(strike);
        if (!ceCandles || !peCandles) continue;

        const cePrev = ceCandles.find(c => c.timestamp === prevTime);
        const ceCurr = ceCandles.find(c => c.timestamp === currTime);
        const pePrev = peCandles.find(c => c.timestamp === prevTime);
        const peCurr = peCandles.find(c => c.timestamp === currTime);

        if (!cePrev || !ceCurr || !pePrev || !peCurr) continue;
        if (cePrev.oi === 0 && ceCurr.oi === 0 && pePrev.oi === 0 && peCurr.oi === 0) continue;

        const ceDelta = Math.abs(bsDelta(true, spotPrice, strike, T));
        const peDelta = Math.abs(bsDelta(false, spotPrice, strike, T));

        intervalFlow += computeFlowBetweenCandles(
          { ceOI: cePrev.oi, peOI: pePrev.oi, ceLTP: cePrev.close, peLTP: pePrev.close, ceDelta, peDelta },
          { ceOI: ceCurr.oi, peOI: peCurr.oi, ceLTP: ceCurr.close, peLTP: peCurr.close, ceDelta, peDelta },
          lotSize,
        );
      }

      totalFlow += intervalFlow;
      const timeStr = extractTimeSecFromKiteTS(currTime);
      flowPerTimestamp.set(timeStr, totalFlow);
    }

    // Build last snapshot from the most recent candle
    const lastTimestamp = sortedTimestamps[sortedTimestamps.length - 1];
    const lastSnapshot: SymbolFlowResult['lastSnapshot'] = [];

    for (const strike of strikeList) {
      const ceCandles = ceCandlesByToken.get(strike);
      const peCandles = peCandlesByToken.get(strike);
      if (!ceCandles || !peCandles) continue;

      const ceLast = ceCandles.find(c => c.timestamp === lastTimestamp);
      const peLast = peCandles.find(c => c.timestamp === lastTimestamp);
      if (!ceLast || !peLast) continue;

      lastSnapshot.push({
        strike,
        ceLTP: ceLast.close,
        peLTP: peLast.close,
        ceOI: ceLast.oi,
        peOI: peLast.oi,
        ceVol: ceLast.volume,
        peVol: peLast.volume,
        ceDelta: Math.abs(bsDelta(true, spotPrice, strike, T)),
        peDelta: Math.abs(bsDelta(false, spotPrice, strike, T)),
      });
    }

    results.push({ symbol: spec.symbol, type: isIndex ? 'index' : 'stock', flowPerTimestamp, lastSnapshot, totalFlow });
  }

  // Step 4: Merge all symbols into unified FlowTrendPoint[]
  const allTimes = new Set<string>();
  for (const r of results) {
    for (const t of r.flowPerTimestamp.keys()) allTimes.add(t);
  }
  const sortedTimes = [...allTimes].sort();

  const flowTrend: HistoricalFlowResponse['flowTrend'] = [];
  const cumulativeFlow: Record<string, number> = {};
  const prevSnapshots: Record<string, SymbolFlowResult['lastSnapshot']> = {};
  const runningTotals: Record<string, number> = {};

  for (const time of sortedTimes) {
    let niftyFlow = 0, bankniftyFlow = 0, finniftyFlow = 0, sensexFlow = 0, stockAgg = 0;

    for (const r of results) {
      // If this symbol has data at this timestamp, update running total
      if (r.flowPerTimestamp.has(time)) {
        runningTotals[r.symbol] = r.flowPerTimestamp.get(time)!;
      }

      const val = runningTotals[r.symbol] || 0;
      switch (r.symbol) {
        case 'NIFTY': niftyFlow = val; break;
        case 'BANKNIFTY': bankniftyFlow = val; break;
        case 'FINNIFTY': finniftyFlow = val; break;
        case 'SENSEX': sensexFlow = val; break;
      }
      if (r.type === 'stock') stockAgg += val;
    }

    flowTrend.push({
      time,
      NIFTY: Math.round(niftyFlow * 10) / 10,
      BANKNIFTY: Math.round(bankniftyFlow * 10) / 10,
      FINNIFTY: Math.round(finniftyFlow * 10) / 10,
      SENSEX: Math.round(sensexFlow * 10) / 10,
      stockAggregate: Math.round(stockAgg * 10) / 10,
    });
  }

  for (const r of results) {
    cumulativeFlow[r.symbol] = Math.round(r.totalFlow * 10) / 10;
    if (r.lastSnapshot.length > 0) prevSnapshots[r.symbol] = r.lastSnapshot;
  }

  console.log(`[HistFlow] Done. ${apiCallCount} API calls, ${flowTrend.length} pts, ${results.length} symbols`);

  return { mode: 'live', timestamp: new Date().toISOString(), flowTrend, prevSnapshots, cumulativeFlow };
}

// ─── GET Handler ───

export async function GET(request: NextRequest) {
  try {
    // Check cache
    if (cachedResponse && Date.now() - cachedAt < CACHE_TTL_MS) {
      console.log('[HistFlow] Returning cached response');
      return NextResponse.json(cachedResponse);
    }

    const configured = applyKiteCredsFromRequest(request.url);
    if (!configured) {
      return NextResponse.json({
        mode: 'demo', timestamp: new Date().toISOString(),
        flowTrend: [], prevSnapshots: {}, cumulativeFlow: {},
      });
    }

    const data = await fetchHistoricalFlow();
    cachedResponse = data;
    cachedAt = Date.now();
    return NextResponse.json(data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[HistFlow] Error:', errMsg);
    return NextResponse.json({
      mode: 'error', timestamp: new Date().toISOString(),
      flowTrend: [], prevSnapshots: {}, cumulativeFlow: {}, error: errMsg,
    });
  }
}
