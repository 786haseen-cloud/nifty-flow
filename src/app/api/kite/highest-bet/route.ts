/**
 * Highest Bet Tracker API
 * GET /api/kite/highest-bet
 *
 * Returns raw snapshot data for ALL 19 symbols (4 indices + 15 stocks).
 * Frontend diffs consecutive snapshots to compute per-interval flow
 * and tracks day's highest bet per type per symbol.
 *
 * Uses 2 batch Kite API calls (efficient):
 * 1. All spot/cash prices
 * 2. All option + future quotes
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getInstruments,
  getQuotes,
  INDEX_SPECS,
  STOCK_SPECS,
  KITE_FNO_ALT_NAMES,
  type KiteQuote,
  type StrikeFlowData,
} from '@/lib/kite-api';
import { applyKiteCredsFromRequest } from '@/lib/kite-route-helper';
import { istTodayISO } from '@/lib/ist';

// ─── Types ───

export interface SymbolBetData {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spotPrice: number;
  spotVolume: number;
  spotChange: number;
  futOI: number;
  futPrice: number;
  futLotSize: number;
  lotSize: number;
  strikeStep: number;
  strikes: StrikeFlowData[];
}

export interface VIXQuote {
  value: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  dayOpen: number;
}

export interface HighestBetResponse {
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  symbols: SymbolBetData[];
  vix?: VIXQuote;
  error?: string;
}

// ─── Black-Scholes helpers (local copy for this route) ───

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

// ─── LIVE MODE: Batch fetch all 19 symbols ───

async function fetchLiveData(): Promise<HighestBetResponse> {
  const allSpecs = [...INDEX_SPECS, ...STOCK_SPECS];

  // Step 1: Get ALL instruments from cache (single CSV, cached 1hr)
  const allInstruments = await getInstruments();
  if (allInstruments.length === 0) {
    return { mode: 'error', timestamp: new Date().toISOString(), symbols: [], error: 'Instruments CSV empty' };
  }

  // Step 2: Find cash + future instruments for each symbol
  interface SymbolPrep {
    symbol: string;
    name: string;
    type: 'index' | 'stock';
    isIndex: boolean;
    cashToken: number;
    futToken: number;
    futLotSize: number;
    optExchange: string;
    instrumentType: string;
  }

  const prepared: SymbolPrep[] = [];
  const cashTokenList: string[] = [];

  for (const spec of allSpecs) {
    const isIndex = spec.instrumentType === 'OPTIDX';
    const optExchange = isIndex ? (spec.symbol === 'SENSEX' ? 'BFO' : 'NFO') : 'NFO';
    const cashExchange = spec.symbol === 'SENSEX' ? 'BSE' : 'NSE';
    const cashType = isIndex ? 'INDEX' : 'EQ';
    const futType = isIndex ? 'FUTIDX' : 'FUTSTK';

    // Find cash/spot instrument
    // In 2025+ Kite CSV: index cash instruments have instrumentType='EQ' + segment='INDICES',
    // but kite-api.ts normalizer converts these to 'INDEX'. Stock cash instruments stay 'EQ'.
    // Name mapping: Kite uses 'NIFTY 50', 'NIFTY BANK', 'NIFTY FIN SERVICE', 'SENSEX'
    // while our spec.symbol uses 'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'.
    const KITE_INDEX_NAMES: Record<string, string[]> = {
      'NIFTY': ['NIFTY 50', 'NIFTY'],
      'BANKNIFTY': ['NIFTY BANK', 'BANKNIFTY'],
      'FINNIFTY': ['NIFTY FIN SERVICE', 'FINNIFTY'],
      'SENSEX': ['SENSEX'],
    };
    const altNames = KITE_INDEX_NAMES[spec.symbol] || [spec.symbol];
    const cashInst = allInstruments.find(i =>
      i.exchange === cashExchange &&
      i.instrumentType === cashType &&
      (altNames.some(n => i.tradingSymbol.toUpperCase() === n.toUpperCase()) ||
        altNames.some(n => i.name.toUpperCase().includes(n.toUpperCase())))
    ) || allInstruments.find(i =>
      // Fallback: match by segment 'INDICES' for indices (in case normalizer didn't run)
      isIndex && i.exchange === cashExchange &&
      i.segment === 'INDICES' &&
      (altNames.some(n => i.tradingSymbol.toUpperCase().includes(n.toUpperCase())) ||
        altNames.some(n => i.name.toUpperCase().includes(n.toUpperCase())))
    );

    if (!cashInst) continue;

    const KITE_STOCK_NAMES: Record<string, string[]> = {
      'LT': ['LARSEN', 'LT'],
      'MARUTI': ['MARUTI SUZUKI', 'MARUTI'],
      'HINDUNILVR': ['HINDUSTAN UNILEVER', 'HINDUNILVR'],
      'TATAMOTORS': ['TATA MOTORS', 'TMCV', 'TMPV'],
    };
    const altStockNames = KITE_STOCK_NAMES[spec.symbol.toUpperCase()] || [spec.symbol.toUpperCase()];
    // Find current-month future instrument
    const futures = allInstruments.filter(i =>
      i.exchange === optExchange &&
      i.instrumentType === futType &&
      altStockNames.some(n =>
        i.name.toUpperCase().includes(n.toUpperCase()) ||
        i.tradingSymbol.toUpperCase().includes(n.toUpperCase())
      )
    );
    const todayStr = istTodayISO();
    const nearestExpiry = [...new Set(futures.map(f => f.expiry))].sort()
      .find(e => e >= todayStr);
    const futInst = nearestExpiry
      ? futures.find(f => f.expiry === nearestExpiry) || null
      : null;

    prepared.push({
      symbol: spec.symbol,
      name: spec.name,
      type: isIndex ? 'index' : 'stock',
      isIndex,
      cashToken: cashInst.instrumentToken,
      futToken: futInst?.instrumentToken || 0,
      futLotSize: futInst?.lotSize || 0,
      optExchange,
      instrumentType: spec.instrumentType,
    });
    cashTokenList.push(String(cashInst.instrumentToken));
  }

  if (prepared.length === 0) {
    return { mode: 'error', timestamp: new Date().toISOString(), symbols: [], error: 'No instruments found' };
  }

  // Step 2.5: Find and quote VIX
  let vixQuote: VIXQuote | undefined;
  try {
    const vixInst = allInstruments.find(i =>
      i.exchange === 'NSE' &&
      i.instrumentType === 'INDEX' &&
      i.tradingSymbol.toUpperCase() === 'INDIA VIX'
    );
    if (vixInst) {
      const vixQ = await getQuotes([String(vixInst.instrumentToken)]);
      if (!('_error' in vixQ)) {
        const vq = Object.values(vixQ)[0] as KiteQuote;
        if (vq?.lastPrice) {
          const vixClose = vq.close || vq.lastPrice;
          vixQuote = {
            value: vq.lastPrice,
            change: Math.round((vq.lastPrice - vixClose) * 100) / 100,
            changePercent: vixClose > 0 ? Math.round(((vq.lastPrice - vixClose) / vixClose) * 10000) / 100 : 0,
            dayHigh: vq.dayHigh || vq.lastPrice,
            dayLow: vq.dayLow || vq.lastPrice,
            dayOpen: vq.open || vq.lastPrice,
          };
        }
      }
    }
  } catch (e) {
    console.warn('[HighestBet] VIX fetch failed:', e);
  }

  // Step 3: Batch quote cash instruments → spot prices
  const cashQuotes = await getQuotes(cashTokenList);
  if ('_error' in cashQuotes) {
    return { mode: 'error', timestamp: new Date().toISOString(), symbols: [], error: String(cashQuotes._error) };
  }

  // Build token → quote map
  const tokenQuoteMap: Record<string, KiteQuote> = {};
  for (const [key, q] of Object.entries(cashQuotes)) {
    tokenQuoteMap[key] = q as KiteQuote;
  }

  // Step 4: For each symbol, find option instruments near ATM
  interface OptPrep {
    prep: SymbolPrep;
    spotPrice: number;
    spotQuote: KiteQuote;
    lotSize: number;
    strikeStep: number;
    expiry: string;
    optTokenStrikes: { token: number; strike: number; isCE: boolean }[];
  }

  const optPrepared: OptPrep[] = [];
  const allOptTokens: string[] = [];
  const allFutTokens: string[] = [];

  for (const prep of prepared) {
    const spotQuote = tokenQuoteMap[String(prep.cashToken)];
    if (!spotQuote || !spotQuote.lastPrice || spotQuote.lastPrice <= 0) continue;

    const spotPrice = spotQuote.lastPrice;

    // Find option instruments from cached list.
    //
    // Kite CSV 2025+: segment is 'NFO-OPT'/'BFO-OPT' (not 'NFO'/'BFO'),
    // but prep.optExchange is 'NFO'/'BFO'. So we match by exchange
    // (which equals the last segment component) rather than exact segment equality.
    // The instrumentType filter works because kite-api.ts normalizes new types
    // ('CE'/'PE') back to legacy ('OPTIDX'/'OPTSTK') when parsing the CSV.
    //
    // Stock name mapping: Kite uses underlying name for F&O (e.g. 'LARSEN & TOUBRO'
    // for LT options, 'MARUTI SUZUKI INDIA' for MARUTI options). We map our short
    // symbol to the possible Kite names/tradingSymbol prefixes.
    // Stock alt-name mapping for F&O underlying name mismatches
    const KITE_STOCK_NAMES: Record<string, string[]> = {
      'LT': ['LARSEN', 'LT'],
      'MARUTI': ['MARUTI SUZUKI', 'MARUTI'],
      'HINDUNILVR': ['HINDUSTAN UNILEVER', 'HINDUNILVR'],
      'TATAMOTORS': ['TATA MOTORS', 'TMCV', 'TMPV'],
    };
    // CRITICAL FIX: For index symbols, use KITE_FNO_ALT_NAMES which includes
    // Kite's actual CSV names (e.g. 'NIFTY BANK' for BANKNIFTY options).
    // Without this, BANKNIFTY/FINNIFTY option lookups find zero instruments.
    const altNames = prep.isIndex
      ? (KITE_FNO_ALT_NAMES[prep.symbol] || [prep.symbol])
      : (KITE_STOCK_NAMES[prep.symbol.toUpperCase()] || [prep.symbol.toUpperCase()]);
    const opts = allInstruments.filter(i =>
      i.exchange === prep.optExchange &&
      i.instrumentType === prep.instrumentType &&
      altNames.some(n =>
        i.name.toUpperCase().includes(n.toUpperCase()) ||
        i.tradingSymbol.toUpperCase().includes(n.toUpperCase())
      )
    );
    if (opts.length === 0) {
      console.warn(`[HighestBet] No options found for ${prep.symbol} (exchange=${prep.optExchange}, type=${prep.instrumentType}, altNames=[${altNames.join(',')}])`);
      continue;
    }

    const lotSize = opts[0].lotSize || 1;

    // Derive strike step dynamically
    const uniqueStrikes = [...new Set(opts.map(o => o.strike))].sort((a, b) => a - b);
    let strikeStep = 50;
    if (uniqueStrikes.length >= 2) {
      const gaps: Record<number, number> = {};
      for (let i = 1; i < uniqueStrikes.length; i++) {
        const gap = Math.round((uniqueStrikes[i] - uniqueStrikes[i - 1]) * 100) / 100;
        gaps[gap] = (gaps[gap] || 0) + 1;
      }
      strikeStep = parseFloat(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]) || 50;
    }

    // Nearest expiry
    const todayStr = istTodayISO();
    const nearestExpiry = [...new Set(opts.map(o => o.expiry))].sort()
      .find(e => e >= todayStr) || opts[0].expiry;

    const expiryOpts = opts.filter(o => o.expiry === nearestExpiry);
    const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;

    // 11 strikes: ATM ± 5
    const strikeList = Array.from({ length: 11 }, (_, i) =>
      atmStrike - 5 * strikeStep + i * strikeStep
    );

    const filteredOpts = expiryOpts.filter(o => strikeList.includes(o.strike));

    const optTokenStrikes: { token: number; strike: number; isCE: boolean }[] = [];
    for (const inst of filteredOpts) {
      const isCE = inst.tradingSymbol.endsWith('CE');
      optTokenStrikes.push({ token: inst.instrumentToken, strike: inst.strike, isCE });
      allOptTokens.push(String(inst.instrumentToken));
    }

    if (prep.futToken > 0) {
      allFutTokens.push(String(prep.futToken));
    }

    optPrepared.push({
      prep,
      spotPrice,
      spotQuote,
      lotSize,
      strikeStep,
      expiry: nearestExpiry,
      optTokenStrikes,
    });
  }

  // Step 5: Batch quote all option + future tokens
  const allTokens = [...allOptTokens, ...allFutTokens];
  if (allTokens.length === 0) {
    return { mode: 'error', timestamp: new Date().toISOString(), symbols: [], error: 'No option/future tokens found' };
  }

  const optFutQuotes = await getQuotes(allTokens);
  if ('_error' in optFutQuotes) {
    return { mode: 'error', timestamp: new Date().toISOString(), symbols: [], error: String(optFutQuotes._error) };
  }

  const optQuoteMap: Record<string, KiteQuote> = {};
  for (const [key, q] of Object.entries(optFutQuotes)) {
    optQuoteMap[key] = q as KiteQuote;
  }

  // Step 6: Build response
  const symbols: SymbolBetData[] = [];

  for (const od of optPrepared) {
    const { prep, spotPrice, spotQuote, lotSize, strikeStep, expiry, optTokenStrikes } = od;

    // Future quote
    let futOI = 0, futPrice = 0;
    if (prep.futToken > 0) {
      const fq = optQuoteMap[String(prep.futToken)];
      if (fq) { futOI = fq.oi || 0; futPrice = fq.lastPrice || 0; }
    }

    // Group option tokens by strike
    const strikeMap = new Map<number, { ceToken: number; peToken: number }>();
    for (const ot of optTokenStrikes) {
      if (!strikeMap.has(ot.strike)) strikeMap.set(ot.strike, { ceToken: 0, peToken: 0 });
      const entry = strikeMap.get(ot.strike)!;
      if (ot.isCE) entry.ceToken = ot.token;
      else entry.peToken = ot.token;
    }

    const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;

    // Time to expiry for delta calculation
    const now = new Date();
    const expiryDate = new Date(expiry);
    const daysToExpiry = Math.max(0.5, (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const T = daysToExpiry / 365;

    const strikes: StrikeFlowData[] = [];
    for (const [strike, { ceToken, peToken }] of strikeMap.entries()) {
      const ceQ = optQuoteMap[String(ceToken)];
      const peQ = optQuoteMap[String(peToken)];

      strikes.push({
        strike,
        isATM: strike === atmStrike,
        ceLTP: ceQ?.lastPrice || 0,
        peLTP: peQ?.lastPrice || 0,
        ceOI: ceQ?.oi || 0,
        peOI: peQ?.oi || 0,
        ceVol: ceQ?.volume || 0,
        peVol: peQ?.volume || 0,
        ceDelta: Math.abs(bsDelta(true, spotPrice, strike, T)),
        peDelta: Math.abs(bsDelta(false, spotPrice, strike, T)),
        ceToken,
        peToken,
      });
    }
    strikes.sort((a, b) => a.strike - b.strike);

    // Spot change as % from previous close
    const close = spotQuote.close || spotQuote.lastPrice || 1;
    const spotChange = close > 0 ? ((spotPrice - close) / close) * 100 : 0;

    symbols.push({
      symbol: prep.symbol,
      name: prep.name,
      type: prep.type,
      spotPrice,
      spotVolume: spotQuote.volume || 0,
      spotChange: Math.round(spotChange * 100) / 100,
      futOI,
      futPrice,
      futLotSize: prep.futLotSize,
      lotSize,
      strikeStep,
      strikes,
    });
  }

  return {
    mode: 'live',
    timestamp: new Date().toISOString(),
    symbols,
    vix: vixQuote,
  };
}

// ─── DEMO MODE ───
// Module-level cache: produce stable demo data with small perturbations
// between polls so the frontend can compute meaningful OI diffs.
let _prevDemoResponse: HighestBetResponse | null = null;

function generateDemoData(): HighestBetResponse {
  const allSpecs = [...INDEX_SPECS, ...STOCK_SPECS];
  const basePrices: Record<string, number> = {
    NIFTY: 24350, BANKNIFTY: 51200, SENSEX: 80450, FINNIFTY: 23100,
    RELIANCE: 2950, TCS: 3850, HDFCBANK: 1680, INFY: 1860,
    ICICIBANK: 1245, HINDUNILVR: 2380, SBIN: 815, BHARTIARTL: 1620,
    ITC: 465, KOTAKBANK: 1780, LT: 3540, AXISBANK: 1145,
    BAJFINANCE: 7150, MARUTI: 12450, TATAMOTORS: 955,
  };

  const lotSizes: Record<string, number> = {
    NIFTY: 75, BANKNIFTY: 30, SENSEX: 10, FINNIFTY: 50,
    RELIANCE: 250, TCS: 150, HDFCBANK: 550, INFY: 600,
    ICICIBANK: 700, HINDUNILVR: 300, SBIN: 1500, BHARTIARTL: 475,
    ITC: 1600, KOTAKBANK: 400, LT: 150, AXISBANK: 900,
    BAJFINANCE: 125, MARUTI: 50, TATAMOTORS: 2250,
  };

  const strikeSteps: Record<string, number> = {
    NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50,
    RELIANCE: 20, TCS: 10, HDFCBANK: 10, INFY: 10,
    ICICIBANK: 10, HINDUNILVR: 10, SBIN: 5, BHARTIARTL: 10,
    ITC: 5, KOTAKBANK: 10, LT: 20, AXISBANK: 10,
    BAJFINANCE: 50, MARUTI: 50, TATAMOTORS: 10,
  };

  const prev = _prevDemoResponse;
  const spotJitter = prev ? (Math.random() - 0.5) * 5 : 0;

  const symbols: SymbolBetData[] = allSpecs.map(spec => {
    const base = basePrices[spec.symbol] || 1000;
    const prevSym = prev?.symbols.find(s => s.symbol === spec.symbol);
    // Stable spot: base + small cumulative jitter
    const prevSpot = prevSym?.spotPrice || base;
    const spotPrice = Math.round((prevSpot + spotJitter + (Math.random() - 0.5) * 2) * 100) / 100;
    const lotSize = lotSizes[spec.symbol] || 100;
    const strikeStep = strikeSteps[spec.symbol] || 10;
    const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;
    const T = 3 / 365;

    const strikes: StrikeFlowData[] = Array.from({ length: 11 }, (_, i) => {
      const strike = atmStrike - 5 * strikeStep + i * strikeStep;
      const prevStrike = prevSym?.strikes.find(s => s.strike === strike);
      // Small OI perturbation: ±0.5% → realistic 30s delta
      const ceOI = prevStrike
        ? Math.max(1000, prevStrike.ceOI + Math.round((Math.random() - 0.48) * prevStrike.ceOI * 0.005))
        : Math.floor(Math.random() * 5000000 + 100000);
      const peOI = prevStrike
        ? Math.max(1000, prevStrike.peOI + Math.round((Math.random() - 0.48) * prevStrike.peOI * 0.005))
        : Math.floor(Math.random() * 5000000 + 100000);
      const ceLTP = prevStrike
        ? Math.max(0.5, prevStrike.ceLTP + (Math.random() - 0.45) * 3)
        : Math.max(0.5, (spotPrice - strike) * (0.3 + Math.random() * 0.2) + Math.random() * 20);
      const peLTP = prevStrike
        ? Math.max(0.5, prevStrike.peLTP + (Math.random() - 0.55) * 3)
        : Math.max(0.5, (strike - spotPrice) * (0.3 + Math.random() * 0.2) + Math.random() * 20);
      return {
        strike,
        isATM: strike === atmStrike,
        ceLTP,
        peLTP,
        ceOI,
        peOI,
        ceVol: Math.floor(Math.random() * 200000 + 1000),
        peVol: Math.floor(Math.random() * 200000 + 1000),
        ceDelta: Math.abs(bsDelta(true, spotPrice, strike, T)),
        peDelta: Math.abs(bsDelta(false, spotPrice, strike, T)),
        ceToken: 100000 + Math.floor(Math.random() * 100000),
        peToken: 200000 + Math.floor(Math.random() * 100000),
      };
    });

    const prevFutOI = prevSym?.futOI || Math.floor(Math.random() * 20000000 + 500000);
    const futOI = Math.max(1000, prevFutOI + Math.round((Math.random() - 0.5) * 50000));

    return {
      symbol: spec.symbol,
      name: spec.name,
      type: spec.instrumentType === 'OPTIDX' ? 'index' as const : 'stock' as const,
      spotPrice,
      spotVolume: prevSym?.spotVolume || Math.floor(Math.random() * 50000000 + 1000000),
      spotChange: prevSym?.spotChange || Math.round((Math.random() - 0.5) * 400) / 100,
      futOI,
      futPrice: Math.round((spotPrice * (1 + (Math.random() - 0.5) * 0.002)) * 100) / 100,
      futLotSize: lotSize,
      lotSize,
      strikeStep,
      strikes,
    };
  });

  const result: HighestBetResponse = {
    mode: 'demo',
    timestamp: new Date().toISOString(),
    symbols,
  };
  _prevDemoResponse = result;
  return result;
}

// ─── GET Handler ───

export async function GET(request: NextRequest) {
  try {
    const configured = applyKiteCredsFromRequest(request.url);
    if (!configured) {
      return NextResponse.json(generateDemoData());
    }
    const debug = request.nextUrl.searchParams.get('debug') === '1';
    const data = await fetchLiveData();
    // Fallback to demo when live returns error (e.g. market closed, no tokens)
    if (data.mode === 'error' || data.symbols.length === 0) {
      console.warn('[HighestBet] Live mode returned empty/error, falling back to demo:', data.error);

      // In debug mode, return the actual error + diagnostic info instead of silent demo fallback
      if (debug) {
        // Pull diagnostics from the module-level cache
        const allInstruments = await getInstruments();
        const sampleNiftyOpts = allInstruments
          .filter(i => i.exchange === 'NFO' && i.instrumentType === 'OPTIDX')
          .slice(0, 3)
          .map(i => ({ tradingSymbol: i.tradingSymbol, name: i.name, expiry: i.expiry, strike: i.strike, lotSize: i.lotSize }));

        return NextResponse.json({
          ...data,
          debug: {
            mode: data.mode,
            error: data.error,
            symbolsCount: data.symbols.length,
            timestamp: new Date().toISOString(),
            instrumentsCacheSize: allInstruments.length,
            sampleNFO_OPTIDX_instruments: sampleNiftyOpts,
            cashQuoteStatus: 'untested',  // set elsewhere if needed
          }
        });
      }
      return NextResponse.json(generateDemoData());
    }
    return NextResponse.json(data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[HighestBet] Error:', errMsg);
    return NextResponse.json({
      mode: 'error',
      timestamp: new Date().toISOString(),
      symbols: [],
      error: errMsg,
    });
  }
}
