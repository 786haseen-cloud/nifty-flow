/**
 * Zerodha Kite API Integration
 *
 * Connects to Kite Connect REST API for real NSE/BSE market data.
 * When KITE_API_KEY + KITE_ACCESS_TOKEN are set in .env, real data flows.
 * Otherwise, falls back to demo data.
 *
 * Setup:
 * 1. Go to https://developers.kite.trade
 * 2. Create an app → get API Key + Secret
 * 3. Login: https://kite.zerodha.com/connect/login?api_key=YOUR_KEY
 * 4. After login, capture request_token from redirect URL
 * 5. Call /api/kite/auth?request_token=xxx to generate access_token
 * 6. Put access_token in .env → KITE_ACCESS_TOKEN=xxx
 * 7. Redeploy
 *
 * Access tokens expire daily at midnight. Re-login each morning.
 */

const KITE_BASE = 'https://api.kite.trade';

// ─── Config ───

export function isKiteConfigured(): boolean {
  return !!(
    process.env.KITE_API_KEY &&
    process.env.KITE_ACCESS_TOKEN
  );
}

function kiteHeaders() {
  return {
    'Authorization': `enctoken ${process.env.KITE_ACCESS_TOKEN || ''}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

// ─── Types ───

export interface KiteQuote {
  instrumentToken: number;
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  netChange: number;
  averagePrice: number;
  oi: number;
  oiDayHigh: number;
  oiDayLow: number;
}

export interface KiteInstrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingSymbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrumentType: string;
  strike: number;
  lotSize: number;
  expiry: string;
}

export interface KiteHistoricalCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Auth ───

/**
 * Generate access_token from request_token (one-time, after login redirect)
 */
export async function generateSession(requestToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const apiKey = process.env.KITE_API_KEY;
  const apiSecret = process.env.KITE_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    // Kite uses checksum = sha256(api_key + request_token + api_secret)
    const { createHash } = await import('crypto');
    const checksum = createHash('sha256')
      .update(apiKey + requestToken + apiSecret)
      .digest('hex');

    const res = await fetch(`${KITE_BASE}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: apiKey,
        request_token: requestToken,
        checksum,
      }).toString(),
    });

    const data = await res.json();
    if (data.status === 'success' && data.data) {
      return {
        accessToken: data.data.access_token,
        refreshToken: data.data.refresh_token || '',
      };
    }
    console.error('[Kite] Session error:', data.message);
    return null;
  } catch (err) {
    console.error('[Kite] generateSession failed:', err);
    return null;
  }
}

// ─── Instruments ───

// Cache all instruments from ALL exchanges (Kite returns one CSV with NSE+BSE+NFO+BFO+CDS+MCX)
let instrumentsCache: KiteInstrument[] | null = null;
let instrumentsCacheTime = 0;

/**
 * Fetch all instruments from Kite (cached for 1 hour)
 * Kite returns a single CSV with all exchanges: NSE, BSE, NFO, BFO, CDS, MCX
 * We filter by exchange after caching
 */
export async function getInstruments(exchange?: string): Promise<KiteInstrument[]> {
  // Return from cache if fresh
  if (instrumentsCache && Date.now() - instrumentsCacheTime < 3600000) {
    return exchange ? instrumentsCache.filter(i => i.exchange === exchange) : instrumentsCache;
  }

  try {
    const res = await fetch(`${KITE_BASE}/instruments`, { headers: kiteHeaders() });
    const text = await res.text();

    // Kite returns CSV format
    const lines = text.trim().split('\n');
    const instruments: KiteInstrument[] = [];

    for (let i = 1; i < lines.length; i++) { // skip header
      const cols = lines[i].split(',');
      if (cols.length < 15) continue;
      instruments.push({
        instrumentToken: parseInt(cols[0]) || 0,
        exchangeToken: parseInt(cols[1]) || 0,
        tradingSymbol: cols[2],
        name: cols[3] || '',
        exchange: cols[4] || '',
        segment: cols[5] || '',
        instrumentType: cols[7] || '',
        strike: parseFloat(cols[8]) || 0,
        lotSize: parseInt(cols[6]) || 1,
        expiry: cols[9] || '',
      });
    }

    instrumentsCache = instruments;
    instrumentsCacheTime = Date.now();
    return exchange ? instruments.filter(i => i.exchange === exchange) : instruments;
  } catch (err) {
    console.error('[Kite] instruments fetch failed:', err);
    return [];
  }
}

// ─── Quotes (Real-time) ───

/**
 * Get real-time quotes for instruments
 * iTokens: comma-separated instrument tokens or "NSE:NIFTY 50" format
 */
export async function getQuotes(instruments: string[]): Promise<Record<string, KiteQuote>> {
  if (!isKiteConfigured()) return {};

  try {
    const iList = instruments.join(',');
    const res = await fetch(`${KITE_BASE}/quote?i=${encodeURIComponent(iList)}`, {
      headers: kiteHeaders(),
    });

    const data = await res.json();
    if (data.status !== 'success' || !data.data) return {};

    const quotes: Record<string, KiteQuote> = {};
    for (const [key, q] of Object.entries(data.data as Record<string, any>)) {
      quotes[key] = {
        instrumentToken: q.instrument_token || 0,
        lastPrice: q.last_price || 0,
        open: q.ohlc?.open || 0,
        high: q.ohlc?.high || 0,
        low: q.ohlc?.low || 0,
        close: q.ohlc?.close || 0,
        volume: q.volume || 0,
        netChange: q.net_change || 0,
        averagePrice: q.average_price || 0,
        oi: q.oi || 0,
        oiDayHigh: q.oi_day_high || 0,
        oiDayLow: q.oi_day_low || 0,
      };
    }
    return quotes;
  } catch (err) {
    console.error('[Kite] quote error:', err);
    return {};
  }
}

// ─── Historical Candles ───

/**
 * Get historical candle data for price line chart
 * instrumentToken: numeric token from instruments list
 * interval: "minute", "3minute", "5minute", "15minute", "30minute", "hour", "day"
 */
export async function getCandles(
  instrumentToken: number,
  interval: string = '15minute',
  days: number = 1,
): Promise<KiteHistoricalCandle[]> {
  if (!isKiteConfigured()) return [];

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  try {
    const res = await fetch(
      `${KITE_BASE}/instruments/historical/${instrumentToken}/${interval}?from=${fmt(fromDate)}&to=${fmt(toDate)}&continuous=0`,
      { headers: kiteHeaders() }
    );

    const data = await res.json();
    if (data.status !== 'success' || !data.data?.candles) return [];

    return (data.data.candles as any[][]).map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  } catch (err) {
    console.error('[Kite] candles error:', err);
    return [];
  }
}

// ─── Option Chain ───

/**
 * Get option chain for an index or stock
 * Uses InstrumentSpec for correct exchange, segment
 * Fetches lot size + strike step DYNAMICALLY from Kite CSV
 * Returns all CE + PE instruments for the current expiry near ATM
 */
export async function getOptionInstruments(
  symbol: string,
  spotPrice: number,
  strikesAroundOverride?: number,
): Promise<{ instruments: KiteInstrument[]; meta: InstrumentMeta }> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return { instruments: [], meta: { lotSize: 1, strikeStep: 50 } };

  // Fetch instruments from the correct exchange (NSE or BSE)
  const instruments = await getInstruments(spec.exchange);

  // Filter options using spec
  const indexOptions = instruments.filter(i =>
    i.segment === spec.segment &&
    i.instrumentType === spec.instrumentType &&
    (i.name.toUpperCase().includes(symbol.toUpperCase()) ||
     i.tradingSymbol.toUpperCase().includes(symbol.toUpperCase()))
  );

  if (indexOptions.length === 0) return { instruments: [], meta: { lotSize: 1, strikeStep: 50 } };

  // Get unique expiries, sort by nearest
  const expiries = [...new Set(indexOptions.map(i => i.expiry))].sort();

  // Use nearest expiry that's not expired
  const today = new Date();
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];

  // Filter to nearest expiry
  const expiryOptions = indexOptions.filter(i => i.expiry === nearestExpiry);

  // Get lot size from first option (all same for same underlying)
  const lotSize = expiryOptions[0]?.lotSize || 1;

  // Derive strike step DYNAMICALLY from actual strike gaps
  const strikes = [...new Set(expiryOptions.map(i => i.strike))].sort((a, b) => a - b);
  let strikeStep = 50;
  if (strikes.length >= 2) {
    const gaps: Record<number, number> = {};
    for (let i = 1; i < strikes.length; i++) {
      const gap = Math.round((strikes[i] - strikes[i - 1]) * 100) / 100; // handle 2.5 etc
      gaps[gap] = (gaps[gap] || 0) + 1;
    }
    strikeStep = parseFloat(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]) || 50;
  }

  // Round ATM strike using the DYNAMIC strike step
  const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;

  // Get strikes around ATM
  const strikesAround = strikesAroundOverride ?? spec.strikesAround;
  const strikeList = Array.from({ length: strikesAround * 2 + 1 }, (_, i) =>
    atmStrike - strikesAround * strikeStep + i * strikeStep
  );

  const filtered = expiryOptions.filter(i => strikeList.includes(i.strike));

  return {
    instruments: filtered,
    meta: { lotSize, strikeStep },
  };
}

/**
 * Build options flow data from quotes + OI changes
 * Lot size and strike step come DYNAMICALLY from Kite's CSV
 */
export async function getOptionsFlow(symbol: string, spotPrice: number) {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return null;

  const { instruments: optInstruments, meta } = await getOptionInstruments(symbol, spotPrice);
  if (optInstruments.length === 0) return null;

  // Build instrument keys for batch quote
  const iKeys = optInstruments.map(i => `${i.exchange}:${i.tradingSymbol}`);

  // Batch fetch quotes (max ~500 per call)
  const quotes = await getQuotes(iKeys);
  if (Object.keys(quotes).length === 0) return null;

  // Group by strike → build flow data
  const strikes = new Map<number, { callBuy: number; putBuy: number; callWrite: number; putWrite: number; callOI: number; putOI: number; callVol: number; putVol: number; }>();

  // Use DYNAMIC strike step and lot size from CSV
  const atmStrike = Math.round(spotPrice / meta.strikeStep) * meta.strikeStep;

  for (const inst of optInstruments) {
    const key = `${inst.exchange}:${inst.tradingSymbol}`;
    const q = quotes[key];
    if (!q) continue;

    if (!strikes.has(inst.strike)) {
      strikes.set(inst.strike, { callBuy: 0, putBuy: 0, callWrite: 0, putWrite: 0, callOI: 0, putOI: 0, callVol: 0, putVol: 0 });
    }
    const s = strikes.get(inst.strike)!;

    // Flow = volume × lotSize (from CSV) × avgPrice (real money flow)
    const flow = q.volume * meta.lotSize * q.averagePrice;

    if (inst.tradingSymbol.endsWith('CE')) {
      s.callBuy = flow * 0.6;
      s.callWrite = flow * 0.4;
      s.callOI = q.oi;
      s.callVol = q.volume;
    } else if (inst.tradingSymbol.endsWith('PE')) {
      s.putBuy = flow * 0.6;
      s.putWrite = flow * 0.4;
      s.putOI = q.oi;
      s.putVol = q.volume;
    }
  }

  // Build result
  return Array.from(strikes.entries()).map(([strike, flow]) => ({
    strike,
    isATM: strike === atmStrike,
    ...flow,
    bullishFlow: flow.callBuy + flow.putWrite,
    bearishFlow: flow.putBuy + flow.callWrite,
    netFlow: (flow.callBuy + flow.putWrite) - (flow.putBuy + flow.callWrite),
  })).sort((a, b) => a.strike - b.strike);
}

// ─── NSE Index Token Map ───

export const KITE_INDEX_INSTRUMENTS = {
  NIFTY:      'NSE:NIFTY 50',
  SENSEX:     'BSE:SENSEX',           // ← BSE, not NSE!
  BANKNIFTY: 'NSE:NIFTY BANK',
  FINNIFTY:   'NSE:NIFTY FIN SERVICE',
};

// Nifty 50 instrument token for historical candles
export const NIFTY50_TOKEN = 256265;

// ─── Instrument Specifications ───
// Lot sizes and strike steps are fetched DYNAMICALLY from Kite's master CSV.
// They change with every NSE revision — so we never hardcode them.
// Here we only define exchange, segment, and how many strikes around ATM.

export interface InstrumentSpec {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  segment: string;           // NFO = NSE F&O, BFO = BSE F&O
  instrumentType: string;    // OPTIDX / OPTSTK
  strikesAround: number;     // How many strikes around ATM (±N)
  kiteSymbol: string;        // Kite quote symbol
}

// ═══ INDEX SPECIFICATIONS ═══
export const INDEX_SPECS: InstrumentSpec[] = [
  { symbol: 'NIFTY',      name: 'Nifty 50',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 5, kiteSymbol: 'NSE:NIFTY 50' },
  { symbol: 'SENSEX',     name: 'Sensex',            exchange: 'BSE', segment: 'BFO', instrumentType: 'OPTIDX', strikesAround: 5, kiteSymbol: 'BSE:SENSEX' },
  { symbol: 'BANKNIFTY',  name: 'Bank Nifty',        exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 5, kiteSymbol: 'NSE:NIFTY BANK' },
  { symbol: 'FINNIFTY',   name: 'Fin Nifty',         exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 5, kiteSymbol: 'NSE:NIFTY FIN SERVICE' },
];

// ═══ STOCK F&O SPECIFICATIONS ═══
// BSE has NO stock options — only NSE
export const STOCK_SPECS: InstrumentSpec[] = [
  { symbol: 'RELIANCE',   name: 'Reliance Industries', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:RELIANCE' },
  { symbol: 'TCS',        name: 'Tata Consultancy',    exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:TCS' },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank',           exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:HDFCBANK' },
  { symbol: 'INFY',       name: 'Infosys',             exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:INFY' },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:ICICIBANK' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever',  exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:HINDUNILVR' },
  { symbol: 'SBIN',       name: 'State Bank of India', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:SBIN' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:BHARTIARTL' },
  { symbol: 'ITC',        name: 'ITC Limited',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:ITC' },
  { symbol: 'KOTAKBANK',  name: 'Kotak Mahindra Bank', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:KOTAKBANK' },
  { symbol: 'LT',         name: 'Larsen & Toubro',     exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:LT' },
  { symbol: 'AXISBANK',   name: 'Axis Bank',            exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:AXISBANK' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:BAJFINANCE' },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:MARUTI' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors',         exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:TATAMOTORS' },
];

// Helper: get spec by symbol
export function getInstrumentSpec(symbol: string): InstrumentSpec | undefined {
  return INDEX_SPECS.find(s => s.symbol === symbol) ||
         STOCK_SPECS.find(s => s.symbol === symbol);
}

// ─── Dynamic Lot Size + Strike Step from Kite CSV ───
// Lot sizes change with NSE revisions (e.g., Nifty went from 50→25→75→65 etc.)
// Strike steps can also change.
// We derive BOTH from Kite's instrument master CSV at runtime.

export interface InstrumentMeta {
  lotSize: number;
  strikeStep: number;
}

/**
 * Derive lot size and strike step from Kite instruments CSV
 * - lotSize: from the option instrument's lot_size field
 * - strikeStep: derived from the gap between adjacent strikes
 */
export async function getInstrumentMeta(
  symbol: string,
  spotPrice: number,
): Promise<InstrumentMeta> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return { lotSize: 1, strikeStep: 50 }; // fallback

  // Fetch all instruments for this symbol's exchange
  const allInstruments = await getInstruments(spec.exchange);

  // Filter to this symbol's options for current/near expiry
  const symbolOpts = allInstruments.filter(i =>
    i.segment === spec.segment &&
    i.instrumentType === spec.instrumentType &&
    (i.name.toUpperCase().includes(symbol.toUpperCase()) ||
     i.tradingSymbol.toUpperCase().includes(symbol.toUpperCase()))
  );

  if (symbolOpts.length === 0) {
    return { lotSize: 1, strikeStep: 50 }; // fallback
  }

  // Get lot size from the first matching option (all have same lot size for same underlying)
  const lotSize = symbolOpts[0].lotSize || 1;

  // Derive strike step from unique sorted strikes near ATM
  const nearestExpiry = [...new Set(symbolOpts.map(i => i.expiry))].sort()
    .find(e => new Date(e) >= new Date(new Date().toDateString()));

  const expiryOpts = nearestExpiry
    ? symbolOpts.filter(i => i.expiry === nearestExpiry)
    : symbolOpts;

  // Get unique strikes, sorted
  const strikes = [...new Set(expiryOpts.map(i => i.strike))].sort((a, b) => a - b);

  // Find strikes near ATM and compute step from adjacent gaps
  let strikeStep = 50; // default fallback
  if (strikes.length >= 2) {
    // Use the most common gap between adjacent strikes
    const gaps: Record<number, number> = {};
    for (let i = 1; i < strikes.length; i++) {
      const gap = Math.round(strikes[i] - strikes[i - 1]);
      gaps[gap] = (gaps[gap] || 0) + 1;
    }
    // Most frequent gap = the strike step
    strikeStep = parseInt(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]) || 50;
  }

  return { lotSize, strikeStep };
}

// Stock F&O list (symbols only, for backwards compat)
export const KITE_STOCK_FO = STOCK_SPECS.map(s => s.symbol);

// ─── Strike Flow Map — Black-Scholes helpers ───

/**
 * Standard Normal CDF using Abramowitz & Stegun rational approximation
 * Same as the user's Google Script normCDF + erf
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normCDF(x: number): number {
  return (1.0 + erf(x / Math.sqrt(2.0))) / 2.0;
}

/**
 * Black-Scholes delta calculator
 * Uses IV estimation from moneyness when not available from Kite
 */
export function bsDelta(isCall: boolean, S: number, K: number, T: number, r: number, sigma: number): number {
  if (T < 0.0001) T = 0.0001;
  if (sigma < 0.01) sigma = 0.15;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  if (isCall) {
    return normCDF(d1);
  } else {
    return normCDF(d1) - 1;
  }
}

// ─── Strike Flow Snapshot Types ───

export interface StrikeFlowQuote {
  instrumentToken: number;
  tradingSymbol: string;
  lastPrice: number;
  oi: number;
  volume: number;
  averagePrice: number;
  ohlcHigh: number;
  ohlcLow: number;
  ohlcOpen: number;
  ohlcClose: number;
}

export interface StrikeFlowStrike {
  strike: number;
  isATM: boolean;
  ce: StrikeFlowQuote | null;
  pe: StrikeFlowQuote | null;
  ceDelta: number;
  peDelta: number;
}

export interface StrikeFlowSnapshot {
  mode: 'kite' | 'demo';
  timestamp: string;
  symbol: string;
  spotPrice: number;
  atmStrike: number;
  lotSize: number;
  strikeStep: number;
  expiry: string;
  strikes: StrikeFlowStrike[];
}

// ─── Strike Flow Snapshot Fetcher ───

/**
 * Get a strike flow snapshot for any symbol (index or stock)
 * Returns raw data — flow computation happens on the client
 */
export async function getStrikeFlowSnapshot(
  symbol: string,
  spotPrice?: number,
): Promise<StrikeFlowSnapshot | null> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return null;

  // 1. Fetch spot price if not provided
  if (!spotPrice || spotPrice <= 0) {
    const quotes = await getQuotes([spec.kiteSymbol]);
    const spotQ = quotes[spec.kiteSymbol];
    spotPrice = spotQ?.lastPrice || 0;
  }
  if (spotPrice <= 0) return null;

  // 2. Get option instruments near ATM
  const { instruments, meta } = await getOptionInstruments(symbol, spotPrice);
  if (instruments.length === 0) return null;

  // 3. Batch fetch quotes for all CE/PE instruments
  const iKeys = instruments.map(i => `${i.exchange}:${i.tradingSymbol}`);
  const quotes = await getQuotes(iKeys);
  if (Object.keys(quotes).length === 0) return null;

  // 4. Find nearest expiry string from instruments
  const expiries = [...new Set(instruments.map(i => i.expiry))].sort();
  const today = new Date();
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];

  // 5. Compute ATM strike
  const atmStrike = Math.round(spotPrice / meta.strikeStep) * meta.strikeStep;

  // 6. Calculate T (time to expiry in years)
  const expiryDate = nearestExpiry ? new Date(nearestExpiry) : new Date();
  // Set expiry to 15:40 IST (market close) on expiry day
  expiryDate.setHours(15, 40, 0, 0);
  const now = new Date();
  const T = Math.max((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365), 0.0001);
  const r = 0.06; // risk-free rate

  // 7. Build strike data with delta
  const strikeMap = new Map<number, StrikeFlowStrike>();

  for (const inst of instruments) {
    const key = `${inst.exchange}:${inst.tradingSymbol}`;
    const q = quotes[key];
    if (!q) continue;

    if (!strikeMap.has(inst.strike)) {
      strikeMap.set(inst.strike, {
        strike: inst.strike,
        isATM: inst.strike === atmStrike,
        ce: null,
        pe: null,
        ceDelta: 0,
        peDelta: 0,
      });
    }

    const s = strikeMap.get(inst.strike)!;
    const isCall = inst.tradingSymbol.endsWith('CE');

    const quote: StrikeFlowQuote = {
      instrumentToken: q.instrumentToken,
      tradingSymbol: inst.tradingSymbol,
      lastPrice: q.lastPrice,
      oi: q.oi,
      volume: q.volume,
      averagePrice: q.averagePrice,
      ohlcHigh: q.high,
      ohlcLow: q.low,
      ohlcOpen: q.open,
      ohlcClose: q.close,
    };

    if (isCall) {
      s.ce = quote;
      // Estimate IV from option price using moneyness heuristic
      const moneyness = spotPrice / inst.strike;
      let sigma: number;
      if (moneyness > 1.05) sigma = 0.12;
      else if (moneyness > 1.02) sigma = 0.15;
      else if (moneyness > 0.98) sigma = 0.20;
      else if (moneyness > 0.95) sigma = 0.25;
      else sigma = 0.35;
      // Refine: if LTP > 0, use rough IV from price
      if (q.lastPrice > 0) {
        const intrinsic = Math.max(0, isCall ? spotPrice - inst.strike : inst.strike - spotPrice);
        if (q.lastPrice > intrinsic + 1) {
          // Has time value — IV is at least moderate
          sigma = Math.max(sigma, 0.15);
        }
      }
      s.ceDelta = bsDelta(true, spotPrice, inst.strike, T, r, sigma);
    } else {
      s.pe = quote;
      const moneyness = spotPrice / inst.strike;
      let sigma: number;
      if (moneyness < 0.95) sigma = 0.12;
      else if (moneyness < 0.98) sigma = 0.15;
      else if (moneyness < 1.02) sigma = 0.20;
      else if (moneyness < 1.05) sigma = 0.25;
      else sigma = 0.35;
      if (q.lastPrice > 0) {
        const intrinsic = Math.max(0, inst.strike - spotPrice);
        if (q.lastPrice > intrinsic + 1) {
          sigma = Math.max(sigma, 0.15);
        }
      }
      s.peDelta = bsDelta(false, spotPrice, inst.strike, T, r, sigma);
    }
  }

  // 8. Sort strikes
  const strikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

  return {
    mode: 'kite',
    timestamp: new Date().toISOString(),
    symbol,
    spotPrice,
    atmStrike,
    lotSize: meta.lotSize,
    strikeStep: meta.strikeStep,
    expiry: nearestExpiry || '',
    strikes,
  };
}

// ─── All Strike Flow Symbols ───

export const STRIKE_FLOW_SYMBOLS = [
  ...INDEX_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'index' as const })),
  ...STOCK_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'stock' as const })),
];
