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

let instrumentsCache: KiteInstrument[] | null = null;
let instrumentsCacheTime = 0;

/**
 * Fetch all instruments from Kite (cached for 1 hour)
 */
export async function getInstruments(exchange: string = 'NSE'): Promise<KiteInstrument[]> {
  if (instrumentsCache && Date.now() - instrumentsCacheTime < 3600000) {
    return instrumentsCache.filter(i => i.exchange === exchange);
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
    return instruments.filter(i => i.exchange === exchange);
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
 * Get option chain for an index
 * Returns all CE + PE instruments for the current expiry near ATM
 */
export async function getOptionInstruments(
  indexName: string, // e.g. "NIFTY", "BANKNIFTY"
  spotPrice: number,
  strikesAround: number = 5,
): Promise<KiteInstrument[]> {
  const instruments = await getInstruments('NSE');

  // Filter options for this index
  const optSegment = `NFO`;
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  // Find current expiry (nearest Thursday for weekly, or last Thu of month for monthly)
  const indexOptions = instruments.filter(i =>
    i.segment === optSegment &&
    i.instrumentType === (indexName === 'NIFTY' || indexName === 'BANKNIFTY' ? 'OPTIDX' : 'OPTSTK') &&
    i.name.toUpperCase().includes(indexName.toUpperCase())
  );

  if (indexOptions.length === 0) return [];

  // Get unique expiries, sort by nearest
  const expiries = [...new Set(indexOptions.map(i => i.expiry))].sort();

  // Use nearest expiry that's not expired
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];

  // Filter to nearest expiry
  const expiryOptions = indexOptions.filter(i => i.expiry === nearestExpiry);

  // Round ATM strike
  const step = indexName === 'NIFTY' ? 50 : indexName === 'BANKNIFTY' ? 100 : 50;
  const atmStrike = Math.round(spotPrice / step) * step;

  // Get strikes around ATM
  const strikes = Array.from({ length: strikesAround * 2 + 1 }, (_, i) =>
    atmStrike - strikesAround * step + i * step
  );

  return expiryOptions.filter(i => strikes.includes(i.strike));
}

/**
 * Build options flow data from quotes + OI changes
 */
export async function getOptionsFlow(indexName: string, spotPrice: number) {
  const optInstruments = await getOptionInstruments(indexName, spotPrice);
  if (optInstruments.length === 0) return null;

  // Build instrument keys for batch quote
  const iKeys = optInstruments.map(i => `${i.exchange}:${i.tradingSymbol}`);

  // Batch fetch quotes (max ~500 per call)
  const quotes = await getQuotes(iKeys);
  if (Object.keys(quotes).length === 0) return null;

  // Group by strike → build flow data
  const strikes = new Map<number, { callBuy: number; putBuy: number; callWrite: number; putWrite: number; callOI: number; putOI: number; callVol: number; putVol: number; }>();

  const step = indexName === 'NIFTY' ? 50 : 100;
  const atmStrike = Math.round(spotPrice / step) * step;

  for (const inst of optInstruments) {
    const key = `${inst.exchange}:${inst.tradingSymbol}`;
    const q = quotes[key];
    if (!q) continue;

    if (!strikes.has(inst.strike)) {
      strikes.set(inst.strike, { callBuy: 0, putBuy: 0, callWrite: 0, putWrite: 0, callOI: 0, putOI: 0, callVol: 0, putVol: 0 });
    }
    const s = strikes.get(inst.strike)!;

    // Approximate flow from volume × avg price
    const flow = q.volume * q.averagePrice;
    // Simplified: volume = buying, OI increase = writing
    const oiChange = q.oi; // Current OI as proxy (need previous OI for actual change)

    if (inst.tradingSymbol.endsWith('CE')) {
      s.callBuy = flow * 0.6;       // Approximate buy portion
      s.callWrite = flow * 0.4;      // Approximate write portion
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
  SENSEX:     'NSE:NIFTY 50',       // BSE:SENSEX not directly available, use NSE proxy
  BANKNIFTY: 'NSE:NIFTY BANK',
  FINNIFTY:   'NSE:NIFTY FIN SERVICE',
};

// Nifty 50 instrument token for historical candles
export const NIFTY50_TOKEN = 256265;

// Stock F&O list (15 major NSE F&O stocks)
export const KITE_STOCK_FO = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TATAMOTORS',
];
