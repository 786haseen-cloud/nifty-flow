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
    const raw = await redis.get<string>(participantKey(date));
    if (!raw) return null;
    return JSON.parse(raw) as ParticipantFlow;
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
      const raw = await redis.get<string>(participantKey(dateStr));
      if (raw) {
        return JSON.parse(raw) as ParticipantFlow;
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
      const raw = await redis.get<string>(participantKey(dateStr));
      if (raw) {
        results.push(JSON.parse(raw) as ParticipantFlow);
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
