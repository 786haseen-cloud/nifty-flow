/**
 * Historical Cash Flow Backfill API
 * GET /api/kite/historical-cash-flow
 *
 * Reconstructs the morning-to-now NET CASH FLOW trend (NSE + BSE) for the
 * 15 tracked F&O stocks from Kite's historical 5-min cash candles.
 *
 * PROBLEM SOLVED
 * --------------
 * The "Net Cash Flow — 15 Stocks" card on the Trend tab only shows data
 * from the moment the user pasted their Kite access token. If the user
 * opened the app at 11:00 AM (token pasted at office), the card started
 * from 11:00 — the 9:15→11:00 morning history was missing.
 *
 * The Nifty 50 Price Trend chart didn't have this problem because it's
 * re-fetched from Kite's historical candle API every single poll. The
 * cash flow card, however, was built by appending one point per 15s
 * live poll — no historical reconstruction.
 *
 * HOW IT WORKS
 * ------------
 * 1. For each of 15 STOCK_SPECS, find NSE EQ + BSE EQ instrument tokens.
 * 2. Fetch today's 5-min cash candles for each token (30 calls, ~10s).
 * 3. For each candle:
 *    - open = first candle's open (today's open price)
 *    - cumulative_volume_at_t = sum of volumes from candle[0] to candle[t]
 *    - close_at_t = candle[t].close
 *    - cash_flow_at_t = (close_at_t - open) * cumulative_volume_at_t
 *    This mirrors the live formula in /api/kite/trends: (lastPrice - open) * volume,
 *    where `volume` from the live quote is also cumulative-since-open.
 * 4. Aggregate across 15 stocks at each 5-min timestamp, with forward-fill
 *    for stocks that haven't traded in a given bar (carry forward last
 *    known cumulative flow).
 * 5. Return CashFlowTrendPoint[] + lastStockTotals (raw, NOT /CR) —
 *    client sets prevStockTotals to this so the next live poll's
 *    interval delta = current_total - last_historical_total.
 *
 * RATE LIMIT
 * ----------
 * 30 calls × (3 calls per 350ms) ≈ 3.5s. Cached 60s in-memory like the
 * options flow backfill. The cash backfill is much faster than the options
 * backfill (~2min for 358 calls) so we run them concurrently — even with
 * both running, the aggregate rate stays under 10 calls/s which Kite tolerates.
 *
 * TRADE-OFF
 * ---------
 * Cash flow values from historical candles may differ slightly from the
 * live quote's `(lastPrice - open) * volume` because:
 *   - Live quote's `lastPrice` is the most recent trade (sub-second).
 *   - Historical candle's `close` is the last trade in the 5-min bar.
 *   - Live quote's `volume` and our sum of candle volumes should match
 *     exactly (both are cumulative day volume), but tiny discrepancies
 *     can occur if a trade straddles a bar boundary.
 * The discrepancy is typically <0.1% and doesn't affect the chart visually.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getInstruments,
  getTodayCandles,
  STOCK_SPECS,
  type KiteHistoricalCandle,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';
import { extractTimeSecFromKiteTS } from '@/lib/ist';

// ─── Types ───

interface HistCashFlowResponse {
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  cashFlowTrend: Array<{
    time: string;     // "HH:MM:SS"
    nse: number;      // Cr
    bse: number;      // Cr
    net: number;      // Cr
    weighted: number; // Cr
    interval: number; // always 0 (backfill doesn't compute per-15s delta)
  }>;
  /** Final cumulative stock totals (raw, NOT /CR) — client sets prevStockTotals
   *  to this so the next live poll's interval delta is correct. */
  lastStockTotals: { nse: number; bse: number; weighted: number };
  error?: string;
}

// ─── In-memory cache (60s TTL, same as options flow backfill) ───

let cachedResponse: HistCashFlowResponse | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

// ─── Stock token lookup ───

interface StockTokens {
  symbol: string;
  nseToken: number;
  bseToken: number;
  weight: number;
}

async function findStockTokens(): Promise<StockTokens[]> {
  const allInstruments = await getInstruments();
  if (allInstruments.length === 0) return [];

  const tokens: StockTokens[] = [];
  for (const spec of STOCK_SPECS) {
    const weight = spec.niftyWeight ?? 2.0;

    // NSE EQ — exact tradingSymbol match (e.g. "HDFCBANK", "M&M", "TITAN")
    const nseInst = allInstruments.find(
      (i) =>
        i.exchange === 'NSE' &&
        i.instrumentType === 'EQ' &&
        i.tradingSymbol.toUpperCase() === spec.symbol.toUpperCase()
    );

    // BSE EQ — try exact tradingSymbol match first, fall back to name includes
    let bseInst = allInstruments.find(
      (i) =>
        i.exchange === 'BSE' &&
        i.instrumentType === 'EQ' &&
        i.tradingSymbol.toUpperCase() === spec.symbol.toUpperCase()
    );
    if (!bseInst) {
      bseInst = allInstruments.find(
        (i) =>
          i.exchange === 'BSE' &&
          i.instrumentType === 'EQ' &&
          i.name.toUpperCase().includes(spec.symbol.toUpperCase())
      );
    }

    // Some stocks may not have a BSE listing — bseToken stays 0, that's OK
    tokens.push({
      symbol: spec.symbol,
      nseToken: nseInst?.instrumentToken ?? 0,
      bseToken: bseInst?.instrumentToken ?? 0,
      weight,
    });
  }

  return tokens;
}

// ─── Historical Cash Flow Computation ───

async function fetchHistoricalCashFlow(): Promise<HistCashFlowResponse> {
  const stockTokens = await findStockTokens();
  if (stockTokens.length === 0) {
    return {
      mode: 'error', timestamp: new Date().toISOString(),
      cashFlowTrend: [], lastStockTotals: { nse: 0, bse: 0, weighted: 0 },
      error: 'No stock tokens found',
    };
  }

  // Step 1: Fetch 5-min candles for each NSE/BSE token (rate-limited 3/s)
  const nseCandles = new Map<string, KiteHistoricalCandle[]>();
  const bseCandles = new Map<string, KiteHistoricalCandle[]>();
  let apiCallCount = 0;

  for (const st of stockTokens) {
    if (st.nseToken > 0) {
      try {
        apiCallCount++;
        const c = await getTodayCandles(st.nseToken, '5minute');
        if (c.length > 0) nseCandles.set(st.symbol, c);
        if (apiCallCount % 3 === 0) await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.warn(`[HistCashFlow] NSE ${st.symbol}:`, e);
      }
    }
    if (st.bseToken > 0) {
      try {
        apiCallCount++;
        const c = await getTodayCandles(st.bseToken, '5minute');
        if (c.length > 0) bseCandles.set(st.symbol, c);
        if (apiCallCount % 3 === 0) await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.warn(`[HistCashFlow] BSE ${st.symbol}:`, e);
      }
    }
  }

  // Step 2: Build global union of all candle timestamps
  const globalTimestamps = new Set<string>();
  for (const [, candles] of nseCandles) {
    for (const c of candles) globalTimestamps.add(extractTimeSecFromKiteTS(c.timestamp));
  }
  for (const [, candles] of bseCandles) {
    for (const c of candles) globalTimestamps.add(extractTimeSecFromKiteTS(c.timestamp));
  }

  if (globalTimestamps.size === 0) {
    return {
      mode: 'error', timestamp: new Date().toISOString(),
      cashFlowTrend: [], lastStockTotals: { nse: 0, bse: 0, weighted: 0 },
      error: 'No candles fetched',
    };
  }

  const sortedGlobalTs = [...globalTimestamps].sort();

  // Step 3: For each stock, build flow-at-each-global-timestamp with forward-fill.
  // Forward-fill = if a stock didn't trade in a given 5-min bar, carry forward
  // its last known cumulative flow (a stock that hasn't traded still has its
  // prior cumulative cash flow value).
  const flowByTime = new Map<string, { nse: number; bse: number; weighted: number }>();
  for (const t of sortedGlobalTs) {
    flowByTime.set(t, { nse: 0, bse: 0, weighted: 0 });
  }

  for (const st of stockTokens) {
    const nseC = nseCandles.get(st.symbol) || [];
    const bseC = bseCandles.get(st.symbol) || [];
    if (nseC.length === 0 && bseC.length === 0) continue;

    // Today's open price = first candle's open
    const nseOpen = nseC.length > 0 ? nseC[0].open : 0;
    const bseOpen = bseC.length > 0 ? bseC[0].open : 0;

    // Build per-stock flow at each of its OWN candle timestamps.
    // cumulative_volume_at_t = sum of volumes from candle[0] to candle[t].
    // cash_flow_at_t = (close_at_t - open) * cumulative_volume_at_t
    const nseFlowAtTime = new Map<string, number>();
    let nseCumVol = 0;
    for (const c of nseC) {
      nseCumVol += c.volume;
      const flow = nseOpen > 0 ? (c.close - nseOpen) * nseCumVol : 0;
      nseFlowAtTime.set(extractTimeSecFromKiteTS(c.timestamp), flow);
    }

    const bseFlowAtTime = new Map<string, number>();
    let bseCumVol = 0;
    for (const c of bseC) {
      bseCumVol += c.volume;
      const flow = bseOpen > 0 ? (c.close - bseOpen) * bseCumVol : 0;
      bseFlowAtTime.set(extractTimeSecFromKiteTS(c.timestamp), flow);
    }

    // Walk GLOBAL timestamps, forward-filling this stock's flow into each.
    let lastNseFlow = 0;
    let lastBseFlow = 0;
    for (const t of sortedGlobalTs) {
      if (nseFlowAtTime.has(t)) lastNseFlow = nseFlowAtTime.get(t)!;
      if (bseFlowAtTime.has(t)) lastBseFlow = bseFlowAtTime.get(t)!;

      const entry = flowByTime.get(t)!;
      entry.nse += lastNseFlow;
      entry.bse += lastBseFlow;
      entry.weighted += (lastNseFlow + lastBseFlow) * st.weight / 100;
    }
  }

  // Step 4: Build cashFlowTrend array (sorted by time, converted to Cr)
  const CR = 10000000;
  const cashFlowTrend: HistCashFlowResponse['cashFlowTrend'] = [];
  let lastNse = 0, lastBse = 0, lastWeighted = 0;

  for (const t of sortedGlobalTs) {
    const e = flowByTime.get(t)!;
    lastNse = e.nse;
    lastBse = e.bse;
    lastWeighted = e.weighted;
    cashFlowTrend.push({
      time: t,
      nse: Math.round((e.nse / CR) * 10) / 10,
      bse: Math.round((e.bse / CR) * 10) / 10,
      net: Math.round(((e.nse + e.bse) / CR) * 10) / 10,
      weighted: Math.round((e.weighted / CR) * 10) / 10,
      interval: 0,  // backfill doesn't compute per-15s delta; live polls resume this
    });
  }

  console.log(
    `[HistCashFlow] Done. ${apiCallCount} API calls, ${cashFlowTrend.length} pts, ` +
    `${stockTokens.length} stocks`
  );

  return {
    mode: 'live',
    timestamp: new Date().toISOString(),
    cashFlowTrend,
    lastStockTotals: {
      nse: Math.round(lastNse),
      bse: Math.round(lastBse),
      weighted: Math.round(lastWeighted),
    },
  };
}

// ─── GET Handler ───

export async function GET(request: NextRequest) {
  try {
    // Check cache
    if (cachedResponse && Date.now() - cachedAt < CACHE_TTL_MS) {
      console.log('[HistCashFlow] Returning cached response');
      return NextResponse.json(cachedResponse);
    }

    const configured = applyKiteCredsFromRequest(request.url);
    if (!configured) {
      return NextResponse.json({
        mode: 'demo', timestamp: new Date().toISOString(),
        cashFlowTrend: [], lastStockTotals: { nse: 0, bse: 0, weighted: 0 },
      });
    }

    const data = await fetchHistoricalCashFlow();
    cachedResponse = data;
    cachedAt = Date.now();
    return NextResponse.json(data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[HistCashFlow] Error:', errMsg);
    return NextResponse.json({
      mode: 'error', timestamp: new Date().toISOString(),
      cashFlowTrend: [], lastStockTotals: { nse: 0, bse: 0, weighted: 0 },
      error: errMsg,
    });
  }
}
