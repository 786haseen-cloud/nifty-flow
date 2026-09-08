/**
 * Participant Service — Daily FII / DII / Client / PropDesk flow persistence
 * backed by Upstash Redis, with Factor 12 scoring for the magnet engine.
 *
 * ─── What this module does ─────────────────────────────────────────────
 *
 *  1. STORE      — user pastes daily NSE participant-wise net buy/sell
 *                  numbers (in ₹ Crore) via /api/participants/daily.
 *                  Stored under key `participants:YYYY-MM-DD` with a 30-day
 *                  TTL (longer than signal history — we want backtest data).
 *
 *  2. FETCH      — magnet-scan route calls getMostRecentParticipantFlow()
 *                  once per scan to fetch the most recent trading day's
 *                  data (could be 1-4 days old depending on weekends /
 *                  holidays). This is basket-level — same bias applied to
 *                  all 19 symbols. Result cached for 5 min in-memory.
 *
 *  3. SCORE      — computeParticipantBias() converts the 4 numbers into a
 *                  single ±2.0 signed score for Factor 12 of the magnet
 *                  engine. Logic:
 *
 *                    SMART MONEY (FII + PropDesk) → primary direction
 *                    RETAIL (Client)             → contrarian fade
 *                    DII                          → counterweight (absorbs
 *                                                   FII flow, dampens signal)
 *
 *                  Calibration (subject to Phase 2 tuning after 2-3 weeks
 *                  of accumulated data):
 *                    Smart > +2500 Cr → +2.0 (max CALL bias)
 *                    Smart < -2500 Cr → -2.0 (max PUT bias)
 *                    Retail > +2000 Cr → -0.4 (fade retail buying)
 *                    Retail < -2000 Cr → +0.4 (fade retail selling)
 *                    DII opposing smart → ±0.5 dampener
 *
 *  4. HISTORY    — getRecentParticipantFlow() returns last N days for UI
 *                  display (7-day bar chart on the dashboard).
 *
 * ─── Free-tier budget ──────────────────────────────────────────────────
 *
 *  Writes:   1 per day (user paste) = ~30/month
 *  Reads:    1 cached lookup per magnet-scan poll × 60 polls × 6.5h
 *            BUT cached for 5 min → ~78 reads/day
 *  ─────────────────────────────────────────────────────────────────────
 *  Total ≈ ~80 commands/day — negligible vs. signal-history's ~3,200.
 *
 * ─── Graceful degradation ─────────────────────────────────────────────
 *
 *  If Upstash env vars are missing OR no participant data has been pasted
 *  yet, every function returns null. The magnet engine treats Factor 12
 *  as 0 (neutral) — engine still works, just without the institutional
 *  bias input.
 */

import { Redis } from '@upstash/redis';
import { istDateStr } from './ist';

// ─── Types ───

export interface ParticipantFlow {
  /** IST trading-day date in YYYY-MM-DD format (the day this flow is FOR). */
  date: string;
  /** FII net buy/sell in ₹ Crore (signed: + = net buy, − = net sell). */
  fii: number;
  /** DII net buy/sell in ₹ Crore. */
  dii: number;
  /** Client (retail) net buy/sell in ₹ Crore. */
  client: number;
  /** Proprietary desk net buy/sell in ₹ Crore. */
  propdesk: number;
  /** Unix ms when this entry was stored. */
  ts: number;
  /** Optional source / notes field (e.g. "NSE archive CSV"). */
  source?: string;
}

export interface ParticipantBiasResult {
  /** Signed score contribution for magnet engine Factor 12. ±2.0 max. */
  weight: number;
  /** 'bull' / 'bear' / 'neutral' — for the reasons[] array. */
  direction: 'bull' | 'bear' | 'neutral';
  /** Human-readable explanation for the signal reasons list. */
  detail: string;
  /** Reference to the source ParticipantFlow entry (null when no data). */
  source: ParticipantFlow | null;
}

// ─── Lazy Redis client (singleton — same pattern as signal-history) ───

let _redis: Redis | null = null;
let _redisChecked = false;

function getRedis(): Redis | null {
  if (_redisChecked) return _redis;
  _redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (typeof console !== 'undefined') {
      console.info(
        '[participant-service] Upstash env vars missing — running in no-persistence mode. ' +
        'Factor 12 (Participant Bias) will return 0 / neutral.'
      );
    }
    return null;
  }
  try {
    _redis = new Redis({ url, token });
  } catch (err) {
    console.warn('[participant-service] Failed to init Redis client:', err);
    _redis = null;
  }
  return _redis;
}

// ─── Key helpers ───

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — longer than signal history (backtest data)
const KEY_PREFIX = 'participants';

/**
 * Safely decode a value read from Upstash Redis.
 *
 * ⚠️ CRITICAL: @upstash/redis (v1.38+) auto-deserializes REST responses —
 * the base Command class's default deserializer (parseResponse → parseRecursive)
 * runs JSON.parse on every string response. Since all our saves store
 * JSON.stringify(entry), a plain `redis.get()` returns the ALREADY-PARSED
 * object, not a string. Calling JSON.parse() on that object throws
 * "SyntaxError: [object Object] is not valid JSON" — which the surrounding
 * try/catch silently swallows, making every read return null/[] while
 * saves succeed. This exact bug shipped once (saved data never appeared
 * in history / Factor 12 stayed neutral).
 *
 * decodeJson handles BOTH shapes safely:
 *   - object  → already deserialized by the client, return as-is
 *   - string  → JSON.parse it (upstash only skips auto-parse when the
 *               stored value isn't valid JSON, or deserialization is off)
 */
function decodeJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function participantKey(date: string): string {
  // date is YYYY-MM-DD — already URL-safe
  return `${KEY_PREFIX}:${date}`;
}

// ─── 5-minute in-memory cache for "most recent flow" ───
// Participant data only changes once a day (after user paste), so a 5-min
// cache means we hit Redis ~78 times/day instead of ~3,900. Cached per
// serverless instance — Vercel cold-starts will rebuild the cache.

interface CachedBias {
  ts: number;
  bias: ParticipantBiasResult;
}
const biasCache = new Map<string, CachedBias>();
const BIAS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Public API: saveParticipantFlow ───

/**
 * Save (or overwrite) a day's participant flow entry.
 * Validates the input — FII/DII/Client/PropDesk must be finite numbers.
 * Returns the stored ParticipantFlow, or null if Redis unavailable / invalid.
 */
export async function saveParticipantFlow(
  entry: Omit<ParticipantFlow, 'ts'> & { ts?: number }
): Promise<ParticipantFlow | null> {
  const redis = getRedis();
  if (!redis) return null;

  // Validate
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`Invalid date format: "${entry.date}" — expected YYYY-MM-DD`);
  }
  for (const field of ['fii', 'dii', 'client', 'propdesk'] as const) {
    if (typeof entry[field] !== 'number' || !Number.isFinite(entry[field])) {
      throw new Error(`Invalid ${field} value: ${entry[field]} — expected finite number (Cr)`);
    }
  }

  const now = entry.ts ?? Date.now();
  const fullEntry: ParticipantFlow = {
    date: entry.date,
    fii: Math.round(entry.fii * 100) / 100,
    dii: Math.round(entry.dii * 100) / 100,
    client: Math.round(entry.client * 100) / 100,
    propdesk: Math.round(entry.propdesk * 100) / 100,
    ts: now,
    source: entry.source,
  };

  try {
    const key = participantKey(entry.date);
    await redis.set(key, JSON.stringify(fullEntry), { ex: TTL_SECONDS });

    // Invalidate the bias cache so the next magnet-scan fetches fresh data
    biasCache.delete('most-recent');

    return fullEntry;
  } catch (err) {
    console.warn(`[participant-service] saveParticipantFlow(${entry.date}) failed:`, err);
    return null;
  }
}

// ─── Public API: getParticipantFlowByDate ───

export async function getParticipantFlowByDate(date: string): Promise<ParticipantFlow | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(participantKey(date));
    if (!raw) return null;
    return decodeJson<ParticipantFlow>(raw);
  } catch (err) {
    console.warn(`[participant-service] getParticipantFlowByDate(${date}) failed:`, err);
    return null;
  }
}

// ─── Public API: getMostRecentParticipantFlow ───

/**
 * Walk backwards day-by-day from today (IST) until we find a stored entry.
 * Stops after `maxLookback` days (default 14 — covers weekends, holidays,
 * and the typical "user forgot to paste for a few days" gap).
 *
 * Returns null if no entry found OR Redis unavailable.
 */
export async function getMostRecentParticipantFlow(
  maxLookback: number = 14
): Promise<ParticipantFlow | null> {
  const redis = getRedis();
  if (!redis) return null;

  const todayIST = istDateStr(); // YYYY-MM-DD
  const [yy, mm, dd] = todayIST.split('-').map(Number);
  if (!yy || !mm || !dd) return null;

  try {
    for (let offset = 1; offset <= maxLookback; offset++) {
      const d = new Date(Date.UTC(yy, mm - 1, dd - offset));
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const raw = await redis.get(participantKey(dateStr));
      if (raw) {
        const entry = decodeJson<ParticipantFlow>(raw);
        if (entry) return entry;
      }
    }
    return null;
  } catch (err) {
    console.warn('[participant-service] getMostRecentParticipantFlow failed:', err);
    return null;
  }
}

// ─── Public API: getRecentParticipantFlow (for UI history) ───

/**
 * Get the last N days of participant flow entries (most recent first).
 * Walks backwards day-by-day from today (IST) and collects stored entries
 * until we have N or hit maxLookback.
 *
 * Cost: ≤ N + weekends/holidays Redis GETs (worst case ~20 for N=7).
 */
export async function getRecentParticipantFlow(
  limit: number = 7,
  maxLookback: number = 30
): Promise<ParticipantFlow[]> {
  const redis = getRedis();
  if (!redis) return [];

  const todayIST = istDateStr();
  const [yy, mm, dd] = todayIST.split('-').map(Number);
  if (!yy || !mm || !dd) return [];

  const results: ParticipantFlow[] = [];

  try {
    for (let offset = 0; offset < maxLookback && results.length < limit; offset++) {
      const d = new Date(Date.UTC(yy, mm - 1, dd - offset));
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const raw = await redis.get(participantKey(dateStr));
      if (raw) {
        const entry = decodeJson<ParticipantFlow>(raw);
        if (entry) results.push(entry);
      }
    }
    return results; // most-recent-first
  } catch (err) {
    console.warn('[participant-service] getRecentParticipantFlow failed:', err);
    return [];
  }
}

// ─── Public API: computeParticipantBias (Factor 12 scoring) ───

/**
 * Convert a ParticipantFlow entry into a signed ±2.0 score for the magnet
 * engine's Factor 12.
 *
 * MODEL
 * -----
 *   Smart money = FII + PropDesk  (the "informed" side — leads direction)
 *   Retail      = Client          (usually wrong at extremes — contrarian)
 *   DII         = DII             (counterbalance — absorbs FII flow)
 *
 *   smartDirection = sign(FII + PropDesk)
 *   smartMagnitude = |FII + PropDesk| in Cr
 *
 *   baseScore     = smartDirection × min(2.0, smartMagnitude / 1250)
 *                   → ±2.0 max when smart > 2500 Cr
 *
 *   contrarianAdj = -retail / 5000
 *                   → ±0.4 max when |retail| > 2000 Cr
 *                   (retail buying → fade to bear; retail selling → fade to bull)
 *
 *   diiDampenAdj  = if sign(DII) ≠ smartDirection:
 *                     -smartDirection × min(0.5, |DII| / 2000)
 *                   else: 0
 *                   → ±0.5 max dampener when DII opposes smart
 *
 *   factor12 = clamp(baseScore + contrarianAdj + diiDampenAdj, -2.0, +2.0)
 *
 * Returns a neutral 0 result when entry is null (no data).
 */
export function computeParticipantBias(entry: ParticipantFlow | null): ParticipantBiasResult {
  if (!entry) {
    return {
      weight: 0,
      direction: 'neutral',
      detail: 'No recent participant flow data — paste yesterday\'s FII/DII/Client/PropDesk numbers to enable Factor 12',
      source: null,
    };
  }

  const smart = entry.fii + entry.propdesk;
  const retail = entry.client;
  const dii = entry.dii;

  const smartDirection = smart > 0 ? 1 : smart < 0 ? -1 : 0;
  const smartMag = Math.abs(smart);

  // Base score: smart money direction, scaled ±2.0 max
  const baseScore = smartDirection * Math.min(2.0, smartMag / 1250);

  // Contrarian: fade retail at extremes
  const contrarianAdj = -retail / 5000;

  // DII dampener: when DII opposes smart money, the net market impact is reduced
  let diiDampenAdj = 0;
  if (smartDirection !== 0 && Math.sign(dii) !== smartDirection && dii !== 0) {
    diiDampenAdj = -smartDirection * Math.min(0.5, Math.abs(dii) / 2000);
  }

  const raw = baseScore + contrarianAdj + diiDampenAdj;
  const weight = Math.max(-2.0, Math.min(2.0, Math.round(raw * 100) / 100));

  // Direction label
  let direction: ParticipantBiasResult['direction'];
  if (weight > 0.15) direction = 'bull';
  else if (weight < -0.15) direction = 'bear';
  else direction = 'neutral';

  // Build detail string
  const smartLabel = smartDirection > 0 ? 'buying' : smartDirection < 0 ? 'selling' : 'flat';
  const retailLabel = retail > 200 ? 'heavy buying' : retail < -200 ? 'heavy selling' : 'balanced';
  const diiLabel = dii > 200 ? 'absorbing FII sells' : dii < -200 ? 'absorbing FII buys' : 'neutral';
  const detail =
    `${entry.date}: Smart (FII+Prop) ${smart >= 0 ? '+' : ''}${smart.toFixed(0)} Cr (${smartLabel}); ` +
    `Retail ${retail >= 0 ? '+' : ''}${retail.toFixed(0)} Cr (${retailLabel}); ` +
    `DII ${dii >= 0 ? '+' : ''}${dii.toFixed(0)} Cr (${diiLabel}). ` +
    `Factor 12 = ${weight >= 0 ? '+' : ''}${weight.toFixed(2)}`;

  return { weight, direction, detail, source: entry };
}

// ─── Public API: getCachedParticipantBias ───

/**
 * Get the most recent participant bias with a 5-minute in-memory cache.
 * This is what the magnet-scan route calls — once per scan, even though
 * the scan computes signals for 19 symbols (the bias is basket-level).
 *
 * Returns a neutral 0 result when:
 *   - Redis isn't configured, OR
 *   - No participant data has been pasted yet, OR
 *   - The most recent entry is older than 14 days (stale)
 */
export async function getCachedParticipantBias(): Promise<ParticipantBiasResult> {
  // Cache check
  const cached = biasCache.get('most-recent');
  if (cached && Date.now() - cached.ts < BIAS_CACHE_TTL_MS) {
    return cached.bias;
  }

  const entry = await getMostRecentParticipantFlow(14);
  const bias = computeParticipantBias(entry);

  biasCache.set('most-recent', { ts: Date.now(), bias });
  return bias;
}

// ═══════════════════════════════════════════════════════════════════
// POSITIONING STORAGE (Phase 2b/2c preparation)
// ═══════════════════════════════════════════════════════════════════
//
// Stores NSE F&O participant OI + Volume reports (Reports 2 + 3) so we
// can build Phase 2b (futures positioning) and Phase 2c (aggregate
// option footprint) factors after 2-3 weeks of accumulation.
//
// TTL: 35 days — covers 5 weekly cycles + buffer for monthly comparisons.
//
// Key schema:
//   participant_positioning:YYYY-MM-DD:fao_oi   → Report 2 (OI snapshot)
//   participant_positioning:YYYY-MM-DD:fao_vol  → Report 3 (volume snapshot)
//
// Cost: 2 writes/day when user uploads both files. Negligible read cost
// (Phase 2b will cache reads like Factor 12 does).

// ─── Types ───

export type PositioningReportType = 'fao_oi' | 'fao_vol';

export interface ParticipantPositioning {
  /** IST trading-day date (YYYY-MM-DD). */
  date: string;
  /** Which NSE report — 'fao_oi' (snapshot) or 'fao_vol' (today's trades). */
  reportType: PositioningReportType;
  /** Per-participant long/short contract counts. */
  positioning: {
    client: { longContracts: number; shortContracts: number };
    dii: { longContracts: number; shortContracts: number };
    fii: { longContracts: number; shortContracts: number };
    pro: { longContracts: number; shortContracts: number };
  };
  /** Unix ms when stored. */
  ts: number;
}

const POSITIONING_TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days
const POSITIONING_KEY_PREFIX = 'participant_positioning';

function positioningKey(date: string, reportType: PositioningReportType): string {
  return `${POSITIONING_KEY_PREFIX}:${date}:${reportType}`;
}

// ─── Public API: saveParticipantPositioning ───

/**
 * Save a day's participant positioning entry (Report 2 or Report 3).
 * Validates inputs and stores under `participant_positioning:DATE:TYPE`.
 */
export async function saveParticipantPositioning(
  entry: Omit<ParticipantPositioning, 'ts'> & { ts?: number }
): Promise<ParticipantPositioning | null> {
  const redis = getRedis();
  if (!redis) return null;

  // Validate
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`Invalid date format: "${entry.date}" — expected YYYY-MM-DD`);
  }
  if (entry.reportType !== 'fao_oi' && entry.reportType !== 'fao_vol') {
    throw new Error(`Invalid reportType: "${entry.reportType}" — expected 'fao_oi' or 'fao_vol'`);
  }
  if (!entry.positioning) {
    throw new Error('Missing positioning object');
  }

  const now = entry.ts ?? Date.now();
  const fullEntry: ParticipantPositioning = {
    date: entry.date,
    reportType: entry.reportType,
    positioning: entry.positioning,
    ts: now,
  };

  try {
    const key = positioningKey(entry.date, entry.reportType);
    await redis.set(key, JSON.stringify(fullEntry), { ex: POSITIONING_TTL_SECONDS });
    return fullEntry;
  } catch (err) {
    console.warn(`[participant-service] saveParticipantPositioning(${entry.date}, ${entry.reportType}) failed:`, err);
    return null;
  }
}

// ─── Public API: getParticipantPositioningByDate ───

export async function getParticipantPositioningByDate(
  date: string,
  reportType: PositioningReportType
): Promise<ParticipantPositioning | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(positioningKey(date, reportType));
    if (!raw) return null;
    return decodeJson<ParticipantPositioning>(raw);
  } catch (err) {
    console.warn(`[participant-service] getParticipantPositioningByDate(${date}, ${reportType}) failed:`, err);
    return null;
  }
}

// ─── Public API: getRecentPositioning ───

/**
 * Get the last N days of positioning entries for a given report type.
 * Walks backwards day-by-day from today (IST) until N entries found or
 * maxLookback reached. Returns most-recent-first.
 */
export async function getRecentPositioning(
  reportType: PositioningReportType,
  limit: number = 7,
  maxLookback: number = 35
): Promise<ParticipantPositioning[]> {
  const redis = getRedis();
  if (!redis) return [];

  const todayIST = istDateStr();
  const [yy, mm, dd] = todayIST.split('-').map(Number);
  if (!yy || !mm || !dd) return [];

  const results: ParticipantPositioning[] = [];

  try {
    for (let offset = 0; offset < maxLookback && results.length < limit; offset++) {
      const d = new Date(Date.UTC(yy, mm - 1, dd - offset));
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const raw = await redis.get(positioningKey(dateStr, reportType));
      if (raw) {
        const entry = decodeJson<ParticipantPositioning>(raw);
        if (entry) results.push(entry);
      }
    }
    return results; // most-recent-first
  } catch (err) {
    console.warn(`[participant-service] getRecentPositioning(${reportType}) failed:`, err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// OPTION CHAIN SNAPSHOT STORAGE (Phase 2e preparation)
// ═══════════════════════════════════════════════════════════════════
//
// Stores end-of-day option chain snapshots per symbol per day so we can
// build Phase 2e (strike-level OI buildup patterns) after 4-6 weeks of
// accumulation. Snapshot is taken at 3:25 PM IST (5 min before close)
// by the magnet-scan route.
//
// TTL: 60 days — enough for 2 monthly cycles of strike-level analysis.
//
// Key schema:
//   optionchain:SYMBOL:YYYY-MM-DD → top 11 strikes × 2 sides × key fields
//
// Cost: ~19 writes/day (one per symbol at close). Storage ~3 KB/symbol/day.

export interface OptionChainSnapshotStrike {
  strike: number;
  ceOI: number;
  ceLTP: number;
  peOI: number;
  peLTP: number;
}

export interface OptionChainSnapshot {
  /** Symbol (e.g. "NIFTY 50", "RELIANCE"). */
  symbol: string;
  /** IST trading-day date (YYYY-MM-DD). */
  date: string;
  /** IST time of snapshot (HH:MM:SS). */
  time: string;
  /** Spot at snapshot. */
  spot: number;
  /** ATM strike. */
  atmStrike: number;
  /** Strike step (50 for NIFTY, 100 for stocks, etc.). */
  strikeStep: number;
  /** Expiry date string (from Kite instrument). */
  expiry: string;
  /** Days to expiry at snapshot. */
  daysToExpiry: number;
  /** Top 11 strikes × 2 sides. */
  strikes: OptionChainSnapshotStrike[];
  /** Unix ms when stored. */
  ts: number;
}

const OPTIONCHAIN_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days
const OPTIONCHAIN_KEY_PREFIX = 'optionchain';

function optionChainKey(symbol: string, date: string): string {
  // Sanitize symbol (some have spaces / special chars)
  const safe = symbol.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${OPTIONCHAIN_KEY_PREFIX}:${safe}:${date}`;
}

// ─── In-memory "already snapshotted today" memo ───
// Prevents re-snapshotting on every poll after 3:25 PM. Reset when the
// IST date changes.
const snapshotMemo = new Map<string, string>(); // symbol → IST date string

function shouldSnapshotToday(symbol: string, istDate: string): boolean {
  const last = snapshotMemo.get(symbol);
  if (last === istDate) return false;
  return true;
}

function markSnapshotted(symbol: string, istDate: string): void {
  snapshotMemo.set(symbol, istDate);
}

// ─── Public API: saveOptionChainSnapshot ───

/**
 * Save an end-of-day option chain snapshot for a symbol.
 * Idempotent within a day — if already snapshotted for this IST date,
 * returns null without writing (avoids burning Redis writes on every poll).
 */
export async function saveOptionChainSnapshot(
  entry: Omit<OptionChainSnapshot, 'ts'> & { ts?: number }
): Promise<OptionChainSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;

  // Idempotency check — skip if already snapshotted today
  if (!shouldSnapshotToday(entry.symbol, entry.date)) {
    return null;
  }

  const now = entry.ts ?? Date.now();
  const fullEntry: OptionChainSnapshot = {
    ...entry,
    ts: now,
  };

  try {
    const key = optionChainKey(entry.symbol, entry.date);
    await redis.set(key, JSON.stringify(fullEntry), { ex: OPTIONCHAIN_TTL_SECONDS });
    markSnapshotted(entry.symbol, entry.date);
    return fullEntry;
  } catch (err) {
    console.warn(`[participant-service] saveOptionChainSnapshot(${entry.symbol}, ${entry.date}) failed:`, err);
    return null;
  }
}

// ─── Public API: getOptionChainSnapshot ───

export async function getOptionChainSnapshot(
  symbol: string,
  date: string
): Promise<OptionChainSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(optionChainKey(symbol, date));
    if (!raw) return null;
    return decodeJson<OptionChainSnapshot>(raw);
  } catch (err) {
    console.warn(`[participant-service] getOptionChainSnapshot(${symbol}, ${date}) failed:`, err);
    return null;
  }
}
