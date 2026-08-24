/**
 * Trends API — Price candles + Dual-exchange cash flow
 * GET /api/kite/trends
 *
 * Returns:
 * 1. Nifty 50 5-min candles for intraday price trend line
 * 2. Dual-exchange (NSE + BSE) cash quotes for 15 F&O stocks
 *
 * Used by the Trend Analysis tab for price + cash flow visualization.
 * Options flow is computed client-side from /api/kite/highest-bet snapshots.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getInstruments,
  getQuotes,
  getCandles,
  NIFTY50_TOKEN,
  STOCK_SPECS,
  type KiteQuote,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';

// ─── Types ───

export interface NiftyCandle {
  time: string;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface StockCashFlow {
  symbol: string;
  name: string;
  nseLtp: number;
  nseOpen: number;
  nseChange: number;
  nseVolume: number;
  nseCashFlow: number;   // (lastPrice - open) * volume
  bseLtp: number;
  bseOpen: number;
  bseChange: number;
  bseVolume: number;
  bseCashFlow: number;
  combinedFlow: number;  // NSE + BSE cash flow
  niftyWeight: number;  // Weight in Nifty 50 %
  weightedFlow: number; // combinedFlow * niftyWeight / 100
}

export interface TrendResponse {
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  niftyCandles: NiftyCandle[];
  stockCashFlow: StockCashFlow[];
  error?: string;
}

// Nifty 50 weights for the 15 F&O stocks
const NIFTY_WEIGHTS: Record<string, number> = {
  HDFCBANK: 9.97, ICICIBANK: 9.09, RELIANCE: 7.92, BHARTIARTL: 5.55,
  LT: 4.25, SBIN: 3.95, INFY: 3.67, AXISBANK: 3.13,
  BAJFINANCE: 2.61, KOTAKBANK: 2.58, ITC: 2.40, TCS: 2.16,
  HINDUNILVR: 2.06, MARUTI: 2.06, TATAMOTORS: 1.87,
};

// ─── LIVE MODE ───

async function fetchTrendData(): Promise<TrendResponse> {
  // Step 1: Fetch Nifty 50 candles (5-min, today)
  const candles = await getCandles(NIFTY50_TOKEN, '5minute', 1);

  // Step 2: Get all instruments (cached) to find BSE tokens
  const allInstruments = await getInstruments();
  if (allInstruments.length === 0) {
    return {
      mode: 'error',
      timestamp: new Date().toISOString(),
      niftyCandles: [],
      stockCashFlow: [],
      error: 'Instruments CSV empty',
    };
  }

  // Step 3: Find NSE + BSE cash instrument tokens for 15 stocks
  interface TokenMeta {
    token: string;
    symbol: string;
    name: string;
    exchange: 'NSE' | 'BSE';
    weight: number;
  }

  const tokenList: string[] = [];
  const tokenMetaMap: Record<string, TokenMeta> = {};

  for (const spec of STOCK_SPECS) {
    const weight = NIFTY_WEIGHTS[spec.symbol] || 2.0;

    // Find NSE:EQ instrument
    const nseInst = allInstruments.find(
      (i) =>
        i.exchange === 'NSE' &&
        i.instrumentType === 'EQ' &&
        i.tradingSymbol.toUpperCase() === spec.symbol.toUpperCase()
    );

    // Find BSE:EQ instrument
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

    if (nseInst) {
      const t = String(nseInst.instrumentToken);
      tokenList.push(t);
      tokenMetaMap[t] = { token: t, symbol: spec.symbol, name: spec.name, exchange: 'NSE', weight };
    }
    if (bseInst) {
      const t = String(bseInst.instrumentToken);
      tokenList.push(t);
      tokenMetaMap[t] = { token: t, symbol: spec.symbol, name: spec.name, exchange: 'BSE', weight };
    }
  }

  if (tokenList.length === 0) {
    return {
      mode: 'error',
      timestamp: new Date().toISOString(),
      niftyCandles: [],
      stockCashFlow: [],
      error: 'No stock tokens found',
    };
  }

  // Step 4: Batch quote all tokens
  const quotes = await getQuotes(tokenList);
  if ('_error' in quotes) {
    return {
      mode: 'error',
      timestamp: new Date().toISOString(),
      niftyCandles: [],
      stockCashFlow: [],
      error: String(quotes._error),
    };
  }

  // Step 5: Process quotes into StockCashFlow[]
  const stockMap = new Map<string, { nse: KiteQuote | null; bse: KiteQuote | null; name: string; weight: number }>();

  for (const [token, q] of Object.entries(quotes)) {
    const meta = tokenMetaMap[token];
    if (!meta) continue;

    if (!stockMap.has(meta.symbol)) {
      stockMap.set(meta.symbol, { nse: null, bse: null, name: meta.name, weight: meta.weight });
    }
    const entry = stockMap.get(meta.symbol)!;
    if (meta.exchange === 'NSE') entry.nse = q as KiteQuote;
    else entry.bse = q as KiteQuote;
  }

  const stockCashFlow: StockCashFlow[] = [];
  for (const [symbol, data] of stockMap.entries()) {
    const nse = data.nse;
    const bse = data.bse;

    const nseLtp = nse?.lastPrice || 0;
    const nseOpen = nse?.open || 0;
    const nseVol = nse?.volume || 0;
    const nseChange = nseOpen > 0 ? ((nseLtp - nseOpen) / nseOpen) * 100 : 0;
    const nseCF = (nseLtp - nseOpen) * nseVol;

    const bseLtp = bse?.lastPrice || 0;
    const bseOpen = bse?.open || 0;
    const bseVol = bse?.volume || 0;
    const bseChange = bseOpen > 0 ? ((bseLtp - bseOpen) / bseOpen) * 100 : 0;
    const bseCF = (bseLtp - bseOpen) * bseVol;

    const combined = nseCF + bseCF;

    stockCashFlow.push({
      symbol,
      name: data.name,
      nseLtp: Math.round(nseLtp * 100) / 100,
      nseOpen: Math.round(nseOpen * 100) / 100,
      nseChange: Math.round(nseChange * 100) / 100,
      nseVolume: nseVol,
      nseCashFlow: Math.round(nseCF),
      bseLtp: Math.round(bseLtp * 100) / 100,
      bseOpen: Math.round(bseOpen * 100) / 100,
      bseChange: Math.round(bseChange * 100) / 100,
      bseVolume: bseVol,
      bseCashFlow: Math.round(bseCF),
      combinedFlow: Math.round(combined),
      niftyWeight: data.weight,
      weightedFlow: Math.round(combined * data.weight / 100),
    });
  }

  stockCashFlow.sort((a, b) => Math.abs(b.weightedFlow) - Math.abs(a.weightedFlow));

  // Step 6: Process candles
  const niftyCandles: NiftyCandle[] = candles.map((c) => {
    const d = new Date(c.timestamp);
    return {
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      close: c.close,
      high: c.high,
      low: c.low,
      volume: c.volume,
    };
  });

  return {
    mode: 'live',
    timestamp: new Date().toISOString(),
    niftyCandles,
    stockCashFlow,
  };
}

// ─── DEMO MODE ───

function generateDemoTrends(): TrendResponse {
 const niftyCandles: NiftyCandle[] = [];
  let price = 24350;

  for (let i = 0; i < 75; i++) {
    const totalMin = 9 * 60 + 15 + i * 5;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 15 || (h === 15 && m > 40)) break;

    price += (Math.random() - 0.48) * 15;
    const high = price + Math.random() * 10;
    const low = price - Math.random() * 10;

    niftyCandles.push({
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      close: Math.round(price * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      volume: Math.floor(Math.random() * 5000000 + 1000000),
    });
  }

  const stockCashFlow: StockCashFlow[] = STOCK_SPECS.map((spec) => {
    const w = NIFTY_WEIGHTS[spec.symbol] || 2.0;
    const basePrice = 1000 + Math.random() * 3000;
    const nseCF = (Math.random() - 0.45) * 500000000;
    const bseCF = (Math.random() - 0.45) * 100000000;
    const combined = nseCF + bseCF;

    return {
      symbol: spec.symbol,
      name: spec.name,
      nseLtp: Math.round(basePrice * 100) / 100,
      nseOpen: Math.round((basePrice - 5) * 100) / 100,
      nseChange: Math.round((Math.random() - 0.5) * 400) / 100,
      nseVolume: Math.floor(Math.random() * 10000000 + 500000),
      nseCashFlow: Math.round(nseCF),
      bseLtp: Math.round(basePrice * 100) / 100,
      bseOpen: Math.round((basePrice - 3) * 100) / 100,
      bseChange: Math.round((Math.random() - 0.5) * 400) / 100,
      bseVolume: Math.floor(Math.random() * 2000000 + 100000),
      bseCashFlow: Math.round(bseCF),
      combinedFlow: Math.round(combined),
      niftyWeight: w,
      weightedFlow: Math.round(combined * w / 100),
    };
  });

  stockCashFlow.sort((a, b) => Math.abs(b.weightedFlow) - Math.abs(a.weightedFlow));

  return {
    mode: 'demo',
    timestamp: new Date().toISOString(),
    niftyCandles,
    stockCashFlow,
  };
}

// ─── GET Handler ───

export async function GET(request: NextRequest) {
  try {
    const configured = applyKiteCredsFromRequest(request.url);
    if (!configured) {
      return NextResponse.json(generateDemoTrends());
    }

    const data = await fetchTrendData();
    if (data.mode === 'error' || (data.niftyCandles.length === 0 && data.stockCashFlow.length === 0)) {
      console.warn('[Trends] Live returned empty, falling back to demo');
      return NextResponse.json(generateDemoTrends());
    }

    return NextResponse.json(data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Trends] Error:', errMsg);
    return NextResponse.json({
      mode: 'error',
      timestamp: new Date().toISOString(),
      niftyCandles: [],
      stockCashFlow: [],
      error: errMsg,
    });
  }
}
