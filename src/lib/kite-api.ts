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
 * Uses InstrumentSpec for correct exchange, segment, lot size, strike step
 * Returns all CE + PE instruments for the current expiry near ATM
 */
export async function getOptionInstruments(
  symbol: string,
  spotPrice: number,
  strikesAroundOverride?: number,
): Promise<KiteInstrument[]> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return [];

  // Fetch instruments from the correct exchange (NSE or BSE)
  const instruments = await getInstruments(spec.exchange);

  // Filter options using spec
  const indexOptions = instruments.filter(i =>
    i.segment === spec.segment &&
    i.instrumentType === spec.instrumentType &&
    (i.name.toUpperCase().includes(symbol.toUpperCase()) ||
     i.tradingSymbol.toUpperCase().includes(symbol.toUpperCase()))
  );

  if (indexOptions.length === 0) return [];

  // Get unique expiries, sort by nearest
  const expiries = [...new Set(indexOptions.map(i => i.expiry))].sort();

  // Use nearest expiry that's not expired
  const today = new Date();
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];

  // Filter to nearest expiry
  const expiryOptions = indexOptions.filter(i => i.expiry === nearestExpiry);

  // Round ATM strike using the CORRECT strike step for this instrument
  const step = spec.strikeStep;
  const atmStrike = Math.round(spotPrice / step) * step;

  // Get strikes around ATM (spec-based)
  const strikesAround = strikesAroundOverride ?? spec.strikesAround;
  const strikes = Array.from({ length: strikesAround * 2 + 1 }, (_, i) =>
    atmStrike - strikesAround * step + i * step
  );

  return expiryOptions.filter(i => strikes.includes(i.strike));
}

/**
 * Build options flow data from quotes + OI changes
 * Uses InstrumentSpec for correct lot size and strike step
 */
export async function getOptionsFlow(symbol: string, spotPrice: number) {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return null;

  const optInstruments = await getOptionInstruments(symbol, spotPrice);
  if (optInstruments.length === 0) return null;

  // Build instrument keys for batch quote
  const iKeys = optInstruments.map(i => `${i.exchange}:${i.tradingSymbol}`);

  // Batch fetch quotes (max ~500 per call)
  const quotes = await getQuotes(iKeys);
  if (Object.keys(quotes).length === 0) return null;

  // Group by strike → build flow data
  const strikes = new Map<number, { callBuy: number; putBuy: number; callWrite: number; putWrite: number; callOI: number; putOI: number; callVol: number; putVol: number; }>();

  // Use correct strike step from spec
  const atmStrike = Math.round(spotPrice / spec.strikeStep) * spec.strikeStep;

  for (const inst of optInstruments) {
    const key = `${inst.exchange}:${inst.tradingSymbol}`;
    const q = quotes[key];
    if (!q) continue;

    if (!strikes.has(inst.strike)) {
      strikes.set(inst.strike, { callBuy: 0, putBuy: 0, callWrite: 0, putWrite: 0, callOI: 0, putOI: 0, callVol: 0, putVol: 0 });
    }
    const s = strikes.get(inst.strike)!;

    // Flow = volume × lotSize × avgPrice (real money flow)
    const flow = q.volume * spec.lotSize * q.averagePrice;

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

// ─── Instrument Specifications: Lot Size + Strike Step + Exchanges ───
// Every index and stock has DIFFERENT lot size and strike step.
// This is critical for correct options flow calculation.

export interface InstrumentSpec {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  segment: string;           // NFO = NSE F&O, BFO = BSE F&O
  instrumentType: string;    // OPTIDX / OPTSTK
  lotSize: number;
  strikeStep: number;        // Gap between consecutive strikes
  strikesAround: number;     // How many strikes around ATM (±N)
  kiteSymbol: string;        // Kite quote symbol
}

// ═══ INDEX SPECIFICATIONS ═══
export const INDEX_SPECS: InstrumentSpec[] = [
  {
    symbol: 'NIFTY',
    name: 'Nifty 50',
    exchange: 'NSE',
    segment: 'NFO',
    instrumentType: 'OPTIDX',
    lotSize: 25,
    strikeStep: 50,
    strikesAround: 5,        // 11 strikes: ATM ±5
    kiteSymbol: 'NSE:NIFTY 50',
  },
  {
    symbol: 'SENSEX',
    name: 'Sensex',
    exchange: 'BSE',
    segment: 'BFO',          // BSE F&O segment
    instrumentType: 'OPTIDX',
    lotSize: 15,
    strikeStep: 100,
    strikesAround: 5,
    kiteSymbol: 'BSE:SENSEX',
  },
  {
    symbol: 'BANKNIFTY',
    name: 'Bank Nifty',
    exchange: 'NSE',
    segment: 'NFO',
    instrumentType: 'OPTIDX',
    lotSize: 15,
    strikeStep: 100,
    strikesAround: 5,
    kiteSymbol: 'NSE:NIFTY BANK',
  },
  {
    symbol: 'FINNIFTY',
    name: 'Fin Nifty',
    exchange: 'NSE',
    segment: 'NFO',
    instrumentType: 'OPTIDX',
    lotSize: 25,
    strikeStep: 50,
    strikesAround: 5,
    kiteSymbol: 'NSE:NIFTY FIN SERVICE',
  },
];

// ═══ STOCK F&O SPECIFICATIONS ═══
// 15 major NSE F&O stocks with their lot sizes and strike steps
// BSE has NO stock options — only NSE
export const STOCK_SPECS: InstrumentSpec[] = [
  { symbol: 'RELIANCE',   name: 'Reliance Industries', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 250, strikeStep: 20,  strikesAround: 4, kiteSymbol: 'NSE:RELIANCE' },
  { symbol: 'TCS',        name: 'Tata Consultancy',    exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 150, strikeStep: 40,  strikesAround: 4, kiteSymbol: 'NSE:TCS' },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank',           exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 550, strikeStep: 10,  strikesAround: 4, kiteSymbol: 'NSE:HDFCBANK' },
  { symbol: 'INFY',       name: 'Infosys',             exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 300, strikeStep: 20,  strikesAround: 4, kiteSymbol: 'NSE:INFY' },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 350, strikeStep: 10,  strikesAround: 4, kiteSymbol: 'NSE:ICICIBANK' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever',  exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 300, strikeStep: 20,  strikesAround: 4, kiteSymbol: 'NSE:HINDUNILVR' },
  { symbol: 'SBIN',       name: 'State Bank of India', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 750, strikeStep: 5,   strikesAround: 4, kiteSymbol: 'NSE:SBIN' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 1250,strikeStep: 5,   strikesAround: 4, kiteSymbol: 'NSE:BHARTIARTL' },
  { symbol: 'ITC',        name: 'ITC Limited',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 1600,strikeStep: 2.5, strikesAround: 4, kiteSymbol: 'NSE:ITC' },
  { symbol: 'KOTAKBANK',  name: 'Kotak Mahindra Bank', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 300, strikeStep: 10,  strikesAround: 4, kiteSymbol: 'NSE:KOTAKBANK' },
  { symbol: 'LT',         name: 'Larsen & Toubro',     exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 150, strikeStep: 20,  strikesAround: 4, kiteSymbol: 'NSE:LT' },
  { symbol: 'AXISBANK',   name: 'Axis Bank',            exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 900, strikeStep: 5,   strikesAround: 4, kiteSymbol: 'NSE:AXISBANK' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 125, strikeStep: 50,  strikesAround: 4, kiteSymbol: 'NSE:BAJFINANCE' },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 50,  strikeStep: 100, strikesAround: 4, kiteSymbol: 'NSE:MARUTI' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors',         exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', lotSize: 275, strikeStep: 10,  strikesAround: 4, kiteSymbol: 'NSE:TATAMOTORS' },
];

// Helper: get spec by symbol
export function getInstrumentSpec(symbol: string): InstrumentSpec | undefined {
  return INDEX_SPECS.find(s => s.symbol === symbol) ||
         STOCK_SPECS.find(s => s.symbol === symbol);
}

// Stock F&O list (symbols only, for backwards compat)
export const KITE_STOCK_FO = STOCK_SPECS.map(s => s.symbol);
