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

import { toIST, istKiteDateFormat } from './ist';

// ─── Config ───

// Module-level credential override (set by API routes from query params)
let _overrideApiKey = '';
let _overrideAccessToken = '';

/**
 * Set credential override (called by API routes when frontend passes creds via query params)
 */
export function setKiteOverride(apiKey?: string, accessToken?: string): void {
  _overrideApiKey = apiKey || '';
  _overrideAccessToken = accessToken || '';
}

export function isKiteConfigured(): boolean {
  return !!(
    (process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN) ||
    (_overrideApiKey && _overrideAccessToken)
  );
}

function kiteHeaders() {
  const apiKey = _overrideApiKey || process.env.KITE_API_KEY || '';
  const accessToken = _overrideAccessToken || process.env.KITE_ACCESS_TOKEN || '';
  return {
    'Authorization': `token ${apiKey}:${accessToken}`,
    'X-Kite-Version': '3',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

// Exported so debug routes can replay raw Kite calls for diagnostics.
export { kiteHeaders };

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
  dayHigh: number;
  dayLow: number;
}

export interface KiteInstrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingSymbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrumentType: string;   // normalized: OPTIDX / OPTSTK / FUTIDX / FUTSTK / EQ / INDEX (legacy) or CE / PE / FUT (new Kite CSV)
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
  oi: number;  // Open Interest — only present for F&O instruments
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
 * Invalidate the in-memory instruments cache.
 * Use after credential changes (e.g. user switched from expired → valid token)
 * to force a fresh CSV download on the next getInstruments() call.
 */
export function invalidateInstrumentsCache(): void {
  instrumentsCache = null;
  instrumentsCacheTime = 0;
}

/**
 * Fetch all instruments from Kite (cached for 1 hour)
 * Kite returns a single CSV with all exchanges: NSE, BSE, NFO, BFO, CDS, MCX
 * We filter by exchange after caching
 *
 * @param exchange Optional exchange filter (e.g. 'NFO' returns only NFO F&O instruments)
 * @param forceRefresh Bypass the 1-hour cache and re-download. Useful when creds change.
 */
export async function getInstruments(exchange?: string, forceRefresh?: boolean): Promise<KiteInstrument[]> {
  // Return from cache if fresh (and not forced to refresh)
  if (!forceRefresh && instrumentsCache && Date.now() - instrumentsCacheTime < 3600000) {
    return exchange ? instrumentsCache.filter(i => i.exchange === exchange) : instrumentsCache;
  }

  try {
    const res = await fetch(`${KITE_BASE}/instruments`, { headers: kiteHeaders() });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Kite] instruments API ${res.status}: ${errText}`);
      return [];
    }
    const text = await res.text();

    // Kite returns CSV format
    const lines = text.trim().split('\n');
    const instruments: KiteInstrument[] = [];

    // Kite CSV column order (2025+ format):
    // 0:instrument_token 1:exchange_token 2:tradingsymbol 3:name 4:last_price
    // 5:expiry 6:strike 7:tick_size 8:lot_size 9:instrument_type 10:segment 11:exchange
    //
    // Kite changed the CSV format in 2025:
    //   OLD: instrument_type was 'OPTIDX'/'OPTSTK'/'FUTIDX'/'FUTSTK'/'EQ'/'INDEX'
    //        segment was 'NFO'/'BFO'/'NSE'/'BSE'
    //   NEW: instrument_type is 'CE'/'PE'/'FUT'/'EQ'
    //        segment is 'NFO-OPT'/'NFO-FUT'/'NFO'/'BFO-OPT'/'BFO-FUT'/'NSE'/'BSE'
    // To avoid breaking the rest of the code (which filters by OPTIDX/OPTSTK/FUTIDX/FUTSTK),
    // we normalize the new format back to the legacy types.
    //
    // Disambiguation: in the new CSV, ALL options (index + stock) are CE/PE — there is no
    // index-vs-stock hint in the row itself. We use the `name` column to decide:
    //   - If the underlying name matches a known F&O index (NIFTY, BANKNIFTY, FINNIFTY,
    //     SENSEX, BANKEX, MIDCPNIFTY, etc.) → OPTIDX / FUTIDX
    //   - Otherwise (RELIANCE, TCS, HDFCBANK, ...) → OPTSTK / FUTSTK
    // The set below is checked at parse time (cheap Set.has lookup).
    const KNOWN_FNO_INDICES = new Set([
      'NIFTY', 'NIFTY 50',
      'BANKNIFTY', 'NIFTY BANK',
      'FINNIFTY', 'NIFTY FIN SERVICE',
      'SENSEX', 'BANKEX',
      'MIDCPNIFTY', 'NIFTY MID SELECT', 'NIFTY PSE',
    ]);
    const normalizeInstrumentType = (rawType: string, segment: string, name: string): string => {
      // Keep legacy values as-is (in case Kite reverts or some entries still use old format)
      if (rawType === 'OPTIDX' || rawType === 'OPTSTK' || rawType === 'FUTIDX' || rawType === 'FUTSTK' ||
          rawType === 'INDEX') {
        return rawType;
      }
      // CRITICAL FIX: In the 2025+ Kite CSV, cash index instruments (NIFTY 50, SENSEX, etc.)
      // have instrument_type='EQ' and segment='INDICES'. We must normalize these to 'INDEX'
      // so that downstream lookups (e.g. highest-bet finding cash instruments) can filter by
      // instrumentType === 'INDEX' instead of the ambiguous 'EQ' (which also matches stocks).
      if (rawType === 'EQ' && segment === 'INDICES') {
        return 'INDEX';
      }
      // Regular EQ stocks stay as 'EQ'
      if (rawType === 'EQ') {
        return rawType;
      }
      const nameUpper = name.toUpperCase();
      const isIndex = KNOWN_FNO_INDICES.has(nameUpper);
      if (rawType === 'CE' || rawType === 'PE') {
        // BFO always has index options only (SENSEX/BANKEX). NFO has both index + stock.
        return isIndex ? 'OPTIDX' : 'OPTSTK';
      }
      if (rawType === 'FUT') {
        return isIndex ? 'FUTIDX' : 'FUTSTK';
      }
      return rawType;
    };

    for (let i = 1; i < lines.length; i++) { // skip header
      const cols = lines[i].split(',');
      if (cols.length < 12) continue;
      const rawType = cols[9] || '';
      const segment = cols[10] || '';
      // Kite wraps the `name` field in double quotes (e.g. "NIFTY").
      // Strip them so name-based filters (e.g. .includes('NIFTY')) work correctly.
      const rawName = cols[3] || '';
      const name = rawName.startsWith('"') && rawName.endsWith('"')
        ? rawName.slice(1, -1)
        : rawName;
      instruments.push({
        instrumentToken: parseInt(cols[0]) || 0,
        exchangeToken: parseInt(cols[1]) || 0,
        tradingSymbol: cols[2],
        name,
        exchange: cols[11] || '',
        segment,
        instrumentType: normalizeInstrumentType(rawType, segment, name),
        strike: parseFloat(cols[6]) || 0,
        lotSize: parseInt(cols[8]) || 1,
        expiry: cols[5] || '',
      });
    }

    instrumentsCache = instruments;
    instrumentsCacheTime = Date.now();
    return exchange ? instruments.filter(i => i.exchange === exchange) : instruments;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Kite] instruments fetch failed:', errMsg);
    // Return empty but set error flag for callers to detect
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
    // Strategy: Use instrument tokens (numeric) instead of trading symbols.
    // Tokens have no encoding issues on any platform.
    // Build a map from token → original instrument key for response mapping.
    const tokenToKey: Record<string, string> = {};
    const tokenList: string[] = [];

    for (const inst of instruments) {
      // If it's a numeric token, use directly
      if (/^\d+$/.test(inst)) {
        tokenToKey[inst] = inst;
        tokenList.push(inst);
      } else {
        // Look up token from KITE_INDEX_INSTRUMENTS
        const found = Object.entries(KITE_INDEX_INSTRUMENTS).find(
          ([, v]) => v.symbol === inst
        );
        if (found) {
          const tok = String(found[1].token);
          tokenToKey[tok] = inst;
          tokenList.push(tok);
        } else {
          // Fallback 1: look up from cached instruments CSV
          const cachedInsts = await getInstruments();
          const csvMatch = cachedInsts.find(
            i => i.tradingSymbol === inst.replace(/^[A-Z]+:/, '') ||
                 `${i.exchange}:${i.tradingSymbol}` === inst
          );
          if (csvMatch) {
            const tok = String(csvMatch.instrumentToken);
            tokenToKey[tok] = inst;
            tokenList.push(tok);
          } else {
            // Fallback 2: use the instrument string as-is
            tokenToKey[inst] = inst;
            tokenList.push(inst);
          }
        }
      }
    }

    const iList = tokenList.join(',');
    // Kite requires SEPARATE 'i' query params for multiple instruments.
    // ?i=256265&i=260105 works, but ?i=256265,260105 returns empty data.
    // Chunk into batches of 100 to avoid URL length limits and API throttling.
    const CHUNK_SIZE = 100;
    const allQuotes: Record<string, KiteQuote> = {};

    for (let chunkStart = 0; chunkStart < tokenList.length; chunkStart += CHUNK_SIZE) {
      const chunk = tokenList.slice(chunkStart, chunkStart + CHUNK_SIZE);
      const params = chunk.map(t => `i=${t}`).join('&');
      const res = await fetch(`${KITE_BASE}/quote?${params}`, {
        headers: kiteHeaders(),
      });

      // Log non-success for debugging
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Kite] quote API ${res.status}: ${errText}`);
        if (Object.keys(allQuotes).length === 0) {
          return { _error: `HTTP ${res.status}: ${errText}` } as any;
        }
        continue; // partial success — return what we have
      }

      const data = await res.json();
      if (data.status !== 'success' || !data.data) {
        console.error('[Kite] quote API error:', JSON.stringify(data));
        if (Object.keys(allQuotes).length === 0) {
          return { _error: data.message || 'Unknown error' } as any;
        }
        continue;
      }

      for (const [key, q] of Object.entries(data.data as Record<string, any>)) {
        const displayKey = tokenToKey[key] || key;
        allQuotes[displayKey] = {
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
          dayHigh: q.ohlc?.high || 0,
          dayLow: q.ohlc?.low || 0,
        };
      }
    }

    return allQuotes;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Kite] quote error:', errMsg);
    return { _error: `Exception: ${errMsg}` } as any;
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

  // Kite historical API expects IST dates. Use centralized IST helpers.
  const toDate = toIST(new Date());
  const fromDate = toIST(new Date());
  fromDate.setDate(fromDate.getDate() - days);

  try {
    const fromStr = istKiteDateFormat(fromDate);
    const toStr = istKiteDateFormat(toDate);
    // URL-encode the date strings (they contain a space: "2026-08-25 09:15")
    const url = `${KITE_BASE}/instruments/historical/${instrumentToken}/${interval}?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&continuous=0`;

    const res = await fetch(url, { headers: kiteHeaders() });

    // Surface HTTP-level errors (403 expired token, 429 rate limit, etc.)
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Kite] candles HTTP ${res.status} for token ${instrumentToken}: ${errText.substring(0, 300)}`);
      return [];
    }

    const data = await res.json();
    if (data.status !== 'success' || !data.data?.candles) {
      console.error('[Kite] candles non-success: status=%s, message=%s, from=%s, to=%s',
        data.status, data.message || 'no message', fromStr, toStr);
      return [];
    }

    return (data.data.candles as any[][]).map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      oi: c[6] || 0,  // c[6] = OI (F&O only), undefined for cash
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Kite] candles error:', errMsg);
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

  // IMPORTANT: F&O options/futures are NOT on the cash exchange.
  //   - NIFTY index spot is on exchange='NSE', but NIFTY OPTIONS are on exchange='NFO'
  //   - SENSEX spot is on exchange='BSE', but SENSEX OPTIONS are on exchange='BFO'
  //   - Stock (RELIANCE/TCS/...) spot is on exchange='NSE', but their OPTIONS are on exchange='NFO'
  // So we use spec.segment ('NFO' or 'BFO') — which equals the F&O exchange column in
  // Kite's CSV — NOT spec.exchange ('NSE'/'BSE', which is the cash exchange).
  // If you call getInstruments(spec.exchange) you'll only get cash/index instruments,
  // and the option filter below will return ZERO matches.
  const instruments = await getInstruments(spec.segment);

  // Filter options using spec.
  //
  // Kite changed their CSV format in 2025:
  //   OLD: segment='NFO'/'BFO', instrument_type='OPTIDX'/'OPTSTK'
  //   NEW: segment='NFO-OPT'/'BFO-OPT', instrument_type='CE'/'PE' (we normalize to OPTIDX)
  //
  // So we use a "starts with" match on segment (so 'NFO' matches both 'NFO' and 'NFO-OPT'),
  // and an equality match on instrumentType (we've already normalized new → legacy).
  // Also check searchAliases for symbols whose Kite names don't contain the symbol
  // (e.g. FINNIFTY → Kite uses "NIFTY FIN SERVICE" / "NIFTYFIN" in trading symbols).
  const symUpper = symbol.toUpperCase();
  const aliases = (spec.searchAliases || []).map(a => a.toUpperCase());
  const searchTerms = [symUpper, ...aliases];

  const indexOptions = instruments.filter(i => {
    if (!(i.segment.startsWith(spec.segment) && i.instrumentType === spec.instrumentType)) {
      return false;
    }
    const nameUp = i.name.toUpperCase();
    const tsUp = i.tradingSymbol.toUpperCase();
    return searchTerms.some(term => nameUp.includes(term) || tsUp.includes(term));
  });

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
 * Get the nearest-expiry FUTURE instrument for a symbol.
 *
 * Used by the magnet-scan route to compute futures basis (cost-of-carry)
 * as an independent directional signal — premium = longs paying up to
 * hold (bullish), discount = longs unwinding (bearish).
 *
 * Returns the future's `instrumentToken` (for getQuotes) and `tradingSymbol`
 * (for display), or null if no future contract is found.
 *
 * @param symbol  underlying symbol (e.g. 'NIFTY', 'RELIANCE')
 */
export async function getFutureInstrument(
  symbol: string,
): Promise<{ instrumentToken: number; tradingSymbol: string; expiry: string; lotSize: number } | null> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return null;

  // Futures live on the same segment as options (NFO/BFO)
  const instruments = await getInstruments(spec.segment);

  // Determine expected instrumentType: FUTIDX for indices, FUTSTK for stocks
  const isIndex = spec.instrumentType === 'OPTIDX';
  const futType = isIndex ? 'FUTIDX' : 'FUTSTK';

  const symUpper = symbol.toUpperCase();
  const aliases = (spec.searchAliases || []).map(a => a.toUpperCase());
  const searchTerms = [symUpper, ...aliases];

  // Filter: must be a future, name/tradingSymbol must match
  const futures = instruments.filter(i => {
    if (i.instrumentType !== futType) return false;
    if (!i.segment.startsWith(spec.segment)) return false;
    const nameUp = i.name.toUpperCase();
    const tsUp = i.tradingSymbol.toUpperCase();
    return searchTerms.some(term => nameUp.includes(term) || tsUp.includes(term));
  });

  if (futures.length === 0) return null;

  // Get unique expiries, sort by nearest
  const expiries = [...new Set(futures.map(i => i.expiry))].sort();
  const today = new Date();
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];

  // Pick the future contract with nearest expiry
  const futureContract = futures.find(i => i.expiry === nearestExpiry);
  if (!futureContract) return null;

  return {
    instrumentToken: futureContract.instrumentToken,
    tradingSymbol: futureContract.tradingSymbol,
    expiry: futureContract.expiry,
    lotSize: futureContract.lotSize,
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

  // Build instrument keys for batch quote — use instrument TOKENS (numeric, no encoding issues)
  const iKeys = optInstruments.map(i => String(i.instrumentToken));

  // Batch fetch quotes
  const quotes = await getQuotes(iKeys);
  if (Object.keys(quotes).length === 0) return null;

  // Group by strike → build flow data
  const strikes = new Map<number, { callBuy: number; putBuy: number; callWrite: number; putWrite: number; callOI: number; putOI: number; callVol: number; putVol: number; }>();

  // Use DYNAMIC strike step and lot size from CSV
  const atmStrike = Math.round(spotPrice / meta.strikeStep) * meta.strikeStep;

  for (const inst of optInstruments) {
    // Quotes are keyed by instrument token (string)
    const key = String(inst.instrumentToken);
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
// We store BOTH the trading symbol (for display) and instrument token (for API calls).
// Instrument tokens are numeric — no encoding issues on any platform.

export const KITE_INDEX_INSTRUMENTS: Record<string, { symbol: string; token: number }> = {
  NIFTY:      { symbol: 'NSE:NIFTY 50',           token: 256265 },
  SENSEX:     { symbol: 'BSE:SENSEX',              token: 265 },
  BANKNIFTY:  { symbol: 'NSE:NIFTY BANK',         token: 260105 },
  FINNIFTY:   { symbol: 'NSE:NIFTY FIN SERVICE',  token: 257801 },
};

// Legacy string map (used by quote route)
export const KITE_INDEX_SYMBOLS: Record<string, string> = {};
for (const [k, v] of Object.entries(KITE_INDEX_INSTRUMENTS)) {
  KITE_INDEX_SYMBOLS[k] = v.symbol;
}

// Shared alt-name mapping for Kite index name mismatches.
// Kite's CSV uses different names than our short symbols:
//   NIFTY 50, NIFTY BANK, NIFTY FIN SERVICE vs NIFTY, BANKNIFTY, FINNIFTY.
// Use this in ALL instrument lookups (cash + options + futures).
export const KITE_FNO_ALT_NAMES: Record<string, string[]> = {
  'NIFTY':     ['NIFTY 50', 'NIFTY'],
  'BANKNIFTY': ['NIFTY BANK', 'BANKNIFTY'],
  'FINNIFTY':  ['NIFTY FIN SERVICE', 'FINNIFTY'],
  'SENSEX':    ['SENSEX'],
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
  kiteSymbol: string;        // Kite quote symbol (used for spot price by default)
  spotKiteSymbol?: string;   // Override for spot price if cash ticker differs from F&O ticker
  searchAliases?: string[];  // Extra strings to match Kite option names/tradingSymbols
}

// ═══ INDEX SPECIFICATIONS ═══
export const INDEX_SPECS: InstrumentSpec[] = [
  { symbol: 'NIFTY',      name: 'Nifty 50',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 4, kiteSymbol: 'NSE:NIFTY 50' },
  { symbol: 'SENSEX',     name: 'Sensex',            exchange: 'BSE', segment: 'BFO', instrumentType: 'OPTIDX', strikesAround: 4, kiteSymbol: 'BSE:SENSEX' },
  { symbol: 'BANKNIFTY',  name: 'Bank Nifty',        exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 4, kiteSymbol: 'NSE:NIFTY BANK' },
  { symbol: 'FINNIFTY',   name: 'Fin Nifty',         exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX', strikesAround: 4, kiteSymbol: 'NSE:NIFTY FIN SERVICE', searchAliases: ['NIFTYFIN', 'NIFTY FIN SERVICE'] },
];

// ═══ STOCK F&O SPECIFICATIONS ═══
// BSE has NO stock options — only NSE
export const STOCK_SPECS: InstrumentSpec[] = [
  { symbol: 'RELIANCE',   name: 'Reliance Industries', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:RELIANCE' },
  { symbol: 'TCS',        name: 'Tata Consultancy',    exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:TCS' },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank',           exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:HDFCBANK' },
  { symbol: 'INFY',       name: 'Infosys',             exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:INFY' },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:ICICIBANK' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever',  exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:HINDUNILVR', searchAliases: ['HINDUSTAN UNILEVER'] },
  { symbol: 'SBIN',       name: 'State Bank of India', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:SBIN' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:BHARTIARTL' },
  { symbol: 'ITC',        name: 'ITC Limited',          exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:ITC' },
  { symbol: 'KOTAKBANK',  name: 'Kotak Mahindra Bank', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:KOTAKBANK' },
  { symbol: 'LT',         name: 'Larsen & Toubro',     exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:LT', searchAliases: ['L&T', 'LARSEN'] },
  { symbol: 'AXISBANK',   name: 'Axis Bank',            exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:AXISBANK' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:BAJFINANCE', searchAliases: ['BAJAJ FINANCE'] },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki',       exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:MARUTI' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors (TMCV)', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK', strikesAround: 4, kiteSymbol: 'NSE:TMCV', spotKiteSymbol: 'NSE:TATAMOTORS', searchAliases: ['TMCV', 'TATA MOTORS'] },
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

  // Fetch instruments from the F&O exchange (NFO/BFO), NOT the cash exchange (NSE/BSE).
  // See getOptionInstruments() for the full explanation.
  const allInstruments = await getInstruments(spec.segment);

  // Filter to this symbol's options for current/near expiry.
  // Use startsWith on segment to match both legacy 'NFO' and new 'NFO-OPT' formats.
  const symbolOpts = allInstruments.filter(i =>
    i.segment.startsWith(spec.segment) &&
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

// ─── All symbols available for Strike Flow Map ───
export const STRIKE_FLOW_SYMBOLS = [
  ...INDEX_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'index' as const })),
  ...STOCK_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'stock' as const })),
];

// ─── Black-Scholes Delta Calculator ───
// Approximate delta for options when Kite doesn't provide Greeks.
// Uses the standard normal CDF approximation (Abramowitz & Stegun).

function normCDF(x: number): number {
  // Rational approximation (max error ~7.5e-8)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate Black-Scholes delta for an option
 * @param isCall - true for CE, false for PE
 * @param S - Spot price
 * @param K - Strike price
 * @param T - Time to expiry in years (e.g., 3/365 for 3 days)
 * @param r - Risk-free rate (default 0.065 = 6.5%)
 * @param sigma - Implied volatility (if 0, estimate from moneyness)
 */
function bsDelta(isCall: boolean, S: number, K: number, T: number, r: number = 0.065, sigma: number = 0): number {
  if (T <= 0 || S <= 0 || K <= 0) return isCall ? 0.5 : -0.5;
  // If no IV provided, estimate from moneyness
  if (sigma <= 0) {
    const moneyness = (S - K) / S;
    sigma = 0.12 + Math.abs(moneyness) * 0.3; // rough estimate: 12-42%
  }
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const delta = normCDF(d1);
  return isCall ? delta : delta - 1;
}

// ─── Strike Flow Snapshot ───
// Returns raw per-strike data for the frontend to compute 4-color flow.
// The frontend stores previous snapshot and diffs OI/price changes.
// This avoids Vercel serverless state loss between cold starts.

export interface StrikeFlowSnapshot {
  timestamp: string;
  symbol: string;
  spotPrice: number;
  atmStrike: number;
  lotSize: number;
  strikeStep: number;
  expiry: string;
  strikes: StrikeFlowData[];
}

export interface StrikeFlowData {
  strike: number;
  isATM: boolean;
  ceLTP: number;
  peLTP: number;
  ceOI: number;
  peOI: number;
  ceVol: number;
  peVol: number;
  ceDelta: number;
  peDelta: number;
  ceToken: number;
  peToken: number;
}

/**
 * Get raw strike flow snapshot — per-strike OI, LTP, volume, delta.
 * Frontend diffs consecutive snapshots to compute 4-color flow.
 * Fetches 9 strikes around ATM (±4 × strikeStep).
 */
export async function getStrikeFlowSnapshot(
  symbol: string,
  spotPrice: number,
): Promise<StrikeFlowSnapshot | null> {
  const spec = getInstrumentSpec(symbol);
  if (!spec) return null;

  // Get instruments for nearest expiry, 4 strikes each side = 9 total
  const { instruments: optInstruments, meta } = await getOptionInstruments(symbol, spotPrice, 4);
  if (optInstruments.length === 0) return null;

  // Batch fetch quotes using instrument tokens
  const iKeys = optInstruments.map(i => String(i.instrumentToken));
  const quotes = await getQuotes(iKeys);
  if ('_error' in quotes) return null;

  const atmStrike = Math.round(spotPrice / meta.strikeStep) * meta.strikeStep;

  // Group by strike
  const strikeMap = new Map<number, { ce: KiteInstrument | null; pe: KiteInstrument | null }>();
  for (const inst of optInstruments) {
    if (!strikeMap.has(inst.strike)) {
      strikeMap.set(inst.strike, { ce: null, pe: null });
    }
    const entry = strikeMap.get(inst.strike)!;
    if (inst.tradingSymbol.endsWith('CE')) entry.ce = inst;
    else if (inst.tradingSymbol.endsWith('PE')) entry.pe = inst;
  }

  // Calculate time to expiry
  const expiry = optInstruments[0]?.expiry || '';
  const now = new Date();
  const expiryDate = new Date(expiry);
  const daysToExpiry = Math.max(0.5, (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const T = daysToExpiry / 365;

  // Build strike data
  const strikes: StrikeFlowData[] = [];
  for (const [strike, { ce, pe }] of strikeMap.entries()) {
    const ceQuote = ce ? quotes[String(ce.instrumentToken)] : null;
    const peQuote = pe ? quotes[String(pe.instrumentToken)] : null;

    const ceLTP = ceQuote?.lastPrice || 0;
    const peLTP = peQuote?.lastPrice || 0;
    const ceOI = ceQuote?.oi || 0;
    const peOI = peQuote?.oi || 0;
    const ceVol = ceQuote?.volume || 0;
    const peVol = peQuote?.volume || 0;

    // Compute delta via Black-Scholes
    const ceDelta = Math.abs(bsDelta(true, spotPrice, strike, T));
    const peDelta = Math.abs(bsDelta(false, spotPrice, strike, T));

    strikes.push({
      strike,
      isATM: strike === atmStrike,
      ceLTP,
      peLTP,
      ceOI,
      peOI,
      ceVol,
      peVol,
      ceDelta,
      peDelta,
      ceToken: ce?.instrumentToken || 0,
      peToken: pe?.instrumentToken || 0,
    });
  }

  strikes.sort((a, b) => a.strike - b.strike);

  return {
    timestamp: new Date().toISOString(),
    symbol,
    spotPrice,
    atmStrike,
    lotSize: meta.lotSize,
    strikeStep: meta.strikeStep,
    expiry,
    strikes,
  };
}
