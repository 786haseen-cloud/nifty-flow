/**
 * Signal History — 7-day rolling persistence layer backed by Upstash Redis.
 *
 * ─── What this module does ─────────────────────────────────────────────
 *
 *  1. PERSIST     — every time a symbol's signal *changes meaningfully*
 *                   (direction flip, strength tier change, or score move ≥2.0),
 *                   the entry is appended to a per-symbol Redis sorted set
 *                   keyed by timestamp. Each key has a 7-day TTL — old data
 *                   auto-evicts, so we never exceed free-tier storage.
 *
 *  2. RESOLVE     — when a NEW signal is written, we look at the PREVIOUS
 *                   signal for that symbol and back-fill its `outcome` field
 *                   (win / loss / partial / expired) by comparing the spot
 *                   at signal-time vs. the spot 30 minutes later (or until
 *                   the signal flipped, whichever came first).
 *
 *  3. PATTERN-MATCH — given a fresh signal, query the last 7 days for
 *                     similar setups (same symbol, same direction, similar
 *                     score band, same OI buildup mode) and return a hit
 *                     summary: total / wins / losses / winRate / avgMove.
 *                     Used by the dashboard to show "Last 5 similar: 4/5
 *                     CALL won (+0.8% avg)" and to bump confidence by ±2.
 *
 * ─── Free-tier budget (Upstash 10k commands/day) ──────────────────────
 *
 *  Writes:  ~5 state-changes per symbol per session × 19 symbols = ~95/day
 *  Reads:   ~19 pattern-match queries/poll × 60 polls × 6.5h = ~7,400/day
 *           BUT we only run pattern-match when direction ≠ WAIT and cache
 *           results in-memory for 90s → effective ~3,000 reads/day
 *  Outcome: 1 zadd/update per signal flip = ~95/day
 *  ───────────────────────────────────────────────────────────────────
 *  Total ≈ ~3,200 commands/day — well under 10k limit ✅
 *
 * ─── Graceful degradation ─────────────────────────────────────────────
 *
 *  If `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` env vars are
 *  missing (local dev, unconfigured prod), every function returns `null`
 *  or a no-op result. The dashboard still works — just without history.
 */

import { Redis } from '@upstash/redis';
import type { PatternMatchSummary } from './magnet-engine';

// ─── Types ───

export type SignalDirection = 'CALL' | 'PUT' | 'WAIT';
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
export type OiBuildupMode =
  | 'long_buildup' | 'short_buildup'
  | 'long_unwinding' | 'short_covering' | 'neutral';

export interface SignalHistoryEntry {
  /** Symbol ticker (e.g. "NIFTY 50", "RELIANCE"). */
  symbol: string;
  /** Unix ms when signal was generated. */
  ts: number;
  /** Spot price at signal time. */
  spot: number;
  /** Signal direction. */
  direction: SignalDirection;
  /** Signal strength tier. */
  strength: SignalStrength;
  /** Final signed score (-15..+15). */
  score: number;
  /** Confidence 0-100. */
  confidence: number;
  /** Max pain at signal time. */
  maxPain: number;
  /** Magnet zone center. */
  magnetCenter: number;
  /** Zero-gamma flip level (or null). */
  zeroGamma: number | null;
  /** Pinning probability 0-100. */
  pinning: number;
  /** Futures basis % (or null). */
  basisPct: number | null;
  /** ATM IV skew pp (or null). */
  ivSkewPct: number | null;
  /** OI buildup mode. */
  oiBuildup: OiBuildupMode;
  /** India VIX (or null). */
  vix: number | null;
  /**
   * Outcome — filled in LATER when the next signal for this symbol is
   * written (or when the symbol flips direction). null = unresolved.
   */
  outcome?: 'win' | 'loss' | 'partial' | 'expired' | null;
  /** Spot move (%) between this signal and the next (or +30min). */
  outcomeMovePct?: number | null;
}

/** Re-export PatternMatchSummary so callers can import from either module. */
export type PatternMatchResult = PatternMatchSummary;

// ─── Lazy Redis client (singleton) ───

let _redis: Redis | null = null;
let _redisChecked = false;

/**
 * Get the Upstash Redis client, or null if env vars aren't configured.
 * Memoized after first call.
 */
function getRedis(): Redis | null {
  if (_redisChecked) return _redis;
  _redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Silent — graceful degradation. Log once on first server-side access.
    if (typeof console !== 'undefined') {
      console.info(
        '[signal-history] Upstash env vars missing — running in no-persistence mode. ' +
        'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to enable 7-day history.'
      );
    }
    return null;
  }
  try {
    _redis = new Redis({ url, token });
  } catch (err) {
    console.warn('[signal-history] Failed to init Redis client:', err);
    _redis = null;
  }
  return _redis;
}

// ─── Key helpers ───

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function historyKey(symbol: string): string {
  // Sanitize symbol (some have spaces / special chars)
  const safe = symbol.replace(/[^A-Za-z0-9_-]/g, '_');
  return `sig:${safe}:history`;
}

function lastEntryKey(symbol: string): string {
  const safe = symbol.replace(/[^A-Za-z0-9_-]/g, '_');
  return `sig:${safe}:last`;
}

// ─── Write throttling state (in-memory, per serverless instance) ───

interface LastWriteMemo {
  direction: SignalDirection;
  strength: SignalStrength;
  score: number;
  ts: number;
}
const lastWriteMemo = new Map<string, LastWriteMemo>();
const MIN_WRITE_INTERVAL_MS = 60_000;       // never write more than 1/min per symbol
const SCORE_DELTA_THRESHOLD = 2.0;          // also write on score escalation within tier

/**
 * Should we persist a new entry, or is this signal "same-old"?
 * Writes are throttled to:
 *   - direction change, OR
 *   - strength tier change, OR
 *   - score moved by ≥2.0 since last write, OR
 *   - first write for this symbol (no memo)
 * AND at least MIN_WRITE_INTERVAL_MS since the last write.
 */
function shouldPersist(symbol: string, sig: {
  direction: SignalDirection;
  strength: SignalStrength;
  score: number;
}): boolean {
  const now = Date.now();
  const memo = lastWriteMemo.get(symbol);
  if (!memo) return true;
  if (now - memo.ts < MIN_WRITE_INTERVAL_MS) return false;
  if (memo.direction !== sig.direction) return true;
  if (memo.strength !== sig.strength) return true;
  if (Math.abs(memo.score - sig.score) >= SCORE_DELTA_THRESHOLD) return true;
  return false;
}

// ─── Public API: persistSignal ───

/**
 * Persist a signal entry to Redis, with write throttling.
 *
 * Side effects:
 *   - Resolves the PREVIOUS entry's outcome by comparing spot at prev ts
 *     vs. spot at this ts (or +30min, whichever is earlier).
 *   - Updates the `last` memo for throttle decisions.
 *
 * Returns the persisted entry (with assigned ts), or null if throttled / Redis unavailable.
 */
export async function persistSignal(
  entry: Omit<SignalHistoryEntry, 'ts' | 'outcome' | 'outcomeMovePct'> & { ts?: number }
): Promise<SignalHistoryEntry | null> {
  const redis = getRedis();
  if (!redis) return null;

  // Throttle check
  if (!shouldPersist(entry.symbol, entry)) {
    return null;
  }

  const now = entry.ts ?? Date.now();
  const fullEntry: SignalHistoryEntry = {
    ...entry,
    ts: now,
    outcome: null,
    outcomeMovePct: null,
  };

  const hKey = historyKey(entry.symbol);
  const lKey = lastEntryKey(entry.symbol);

  try {
    // 1. Resolve outcome of the previous entry for this symbol.
    //    Read last entry from the sorted set (max score = most recent).
    const lastEntries = await redis.zrange<SignalHistoryEntry[]>(hKey, -1, -1);
    const lastEntry = lastEntries?.[0];
    if (lastEntry && lastEntry.outcome === null) {
      // Outcome horizon: from prev signal → either now or prev+30min, whichever is earlier
      const horizonMs = 30 * 60 * 1000;
      const elapsedMs = now - lastEntry.ts;
      const resolvedAt = Math.min(now, lastEntry.ts + horizonMs);
      // We don't have a series of spot readings between, so we use the spot
      // at the NEW signal (which is `entry.spot`) as the "post" price, and
      // lastEntry.spot as the "pre" price.
      const movePct = ((entry.spot - lastEntry.spot) / lastEntry.spot) * 100;

      // If we exceeded the 30-min horizon, mark as expired
      // (signal took too long / we missed intermediate polls)
      let outcome: SignalHistoryEntry['outcome'];
      if (elapsedMs > horizonMs) {
        outcome = 'expired';
      } else if (lastEntry.direction === 'CALL') {
        outcome = movePct > 0.15 ? 'win' : movePct < -0.15 ? 'loss' : 'partial';
      } else if (lastEntry.direction === 'PUT') {
        outcome = movePct < -0.15 ? 'win' : movePct > 0.15 ? 'loss' : 'partial';
      } else {
        outcome = 'expired'; // WAIT — no directional bet
      }

      // Patch the previous entry's outcome
      const patched: SignalHistoryEntry = {
        ...lastEntry,
        outcome,
        outcomeMovePct: Math.round(movePct * 100) / 100,
      };
      // Replace in sorted set: remove old, add patched (same score = ts)
      await redis.zrem(hKey, JSON.stringify(lastEntry));
      await redis.zadd(hKey, { score: lastEntry.ts, member: JSON.stringify(patched) });
      await redis.expire(hKey, TTL_SECONDS);
    }

    // 2. Append the new entry
    const member = JSON.stringify(fullEntry);
    await redis.zadd(hKey, { score: now, member });
    await redis.expire(hKey, TTL_SECONDS);

    // 3. Update last-entry pointer (separate small key for fast lookup)
    await redis.set(lKey, member, { ex: TTL_SECONDS });

    // 4. Update in-memory throttle memo
    lastWriteMemo.set(entry.symbol, {
      direction: entry.direction,
      strength: entry.strength,
      score: entry.score,
      ts: now,
    });

    return fullEntry;
  } catch (err) {
    console.warn(`[signal-history] persistSignal(${entry.symbol}) failed:`, err);
    return null;
  }
}

// ─── Pattern-match cache (in-memory, per serverless instance) ───

interface CachedPattern {
  ts: number;
  result: PatternMatchResult;
}
const patternCache = new Map<string, CachedPattern>();
const PATTERN_CACHE_TTL_MS = 90_000; // 90s — pattern match stats don't change fast

// ─── Public API: patternMatch ───

/**
 * Find similar past setups for the given signal context.
 *
 * Similarity criteria (all must match):
 *   - Same symbol
 *   - Same direction (CALL/PUT only — WAIT is never matched)
 *   - Score within ±2.0 of current score
 *   - Same OI buildup mode (LB/SB/LU/SC/neutral)
 *   - Within last 7 days
 *
 * Returns a summary with win/loss counts and suggested confidence boost.
 * Returns null if Redis unavailable or direction is WAIT.
 */
export async function patternMatch(
  symbol: string,
  direction: SignalDirection,
  score: number,
  oiBuildup: OiBuildupMode,
): Promise<PatternMatchResult | null> {
  if (direction === 'WAIT') return null;
  const redis = getRedis();
  if (!redis) return null;

  // Cache check
  const cacheKey = `${symbol}:${direction}:${Math.round(score * 2) / 2}:${oiBuildup}`;
  const cached = patternCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PATTERN_CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const hKey = historyKey(symbol);

    // Pull all entries from last 7 days (typically <100 per symbol)
    const rawEntries = await redis.zrange<SignalHistoryEntry[]>(hKey, sevenDaysAgo, Date.now(), {
      byScore: true,
    });
    if (!rawEntries || rawEntries.length === 0) {
      const empty: PatternMatchResult = {
        total: 0, wins: 0, losses: 0, expired: 0,
        winRate: 0, avgMovePct: 0, confidenceBoost: 0,
        summary: 'No historical data yet',
      };
      patternCache.set(cacheKey, { ts: Date.now(), result: empty });
      return empty;
    }

    // Filter to similar setups
    const similar = rawEntries.filter((e) => {
      if (e.direction !== direction) return false;
      if (Math.abs(e.score - score) > 2.0) return false;
      if (e.oiBuildup !== oiBuildup) return false;
      return true;
    });

    if (similar.length === 0) {
      const empty: PatternMatchResult = {
        total: 0, wins: 0, losses: 0, expired: 0,
        winRate: 0, avgMovePct: 0, confidenceBoost: 0,
        summary: 'No similar setups in last 7 days',
      };
      patternCache.set(cacheKey, { ts: Date.now(), result: empty });
      return empty;
    }

    // Tally outcomes
    let wins = 0, losses = 0, expired = 0, partial = 0;
    let moveSum = 0;
    let moveCount = 0;
    for (const e of similar) {
      if (e.outcome === 'win') wins++;
      else if (e.outcome === 'loss') losses++;
      else if (e.outcome === 'expired') expired++;
      else if (e.outcome === 'partial') partial++;
      // Use absolute move (already signed in predicted direction at write time)
      if (typeof e.outcomeMovePct === 'number') {
        // Re-sign: outcomeMovePct is raw spot % move; re-sign relative to direction
        let move = e.outcomeMovePct;
        if (direction === 'PUT') move = -move;
        moveSum += move;
        moveCount++;
      }
    }

    const resolved = wins + losses + partial;
    const winRate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    const avgMovePct = moveCount > 0
      ? Math.round((moveSum / moveCount) * 100) / 100
      : 0;

    // Confidence boost calibration:
    //   ≥5 samples + ≥70% win rate → +2.0
    //   ≥3 samples + ≥65% win rate → +1.0
    //   ≥3 samples + ≤35% win rate → -2.0 (counter-signal — fade it)
    //   else                        → 0
    let confidenceBoost = 0;
    if (resolved >= 5 && winRate >= 70) confidenceBoost = 2.0;
    else if (resolved >= 3 && winRate >= 65) confidenceBoost = 1.0;
    else if (resolved >= 3 && winRate <= 35) confidenceBoost = -2.0;

    // Build summary string
    let summary: string;
    if (resolved === 0) {
      summary = `${similar.length} similar setups (pending resolution)`;
    } else if (confidenceBoost > 0) {
      summary = `${wins}/${resolved} similar ${direction} setups won (${winRate}%, avg ${avgMovePct >= 0 ? '+' : ''}${avgMovePct}%)`;
    } else if (confidenceBoost < 0) {
      summary = `⚠ ${wins}/${resolved} won — pattern is bearish for ${direction}`;
    } else {
      summary = `${wins}/${resolved} won (${winRate}%, avg ${avgMovePct >= 0 ? '+' : ''}${avgMovePct}%)`;
    }

    const result: PatternMatchResult = {
      total: similar.length,
      wins,
      losses,
      expired,
      winRate,
      avgMovePct,
      confidenceBoost,
      summary,
    };
    patternCache.set(cacheKey, { ts: Date.now(), result });
    return result;
  } catch (err) {
    console.warn(`[signal-history] patternMatch(${symbol}) failed:`, err);
    return null;
  }
}

// ─── Public API: getRecentHistory (for UI "history" view) ───

/**
 * Get the last N signal entries for a symbol (most recent first).
 * Useful for a "Recent signals" panel.
 */
export async function getRecentHistory(
  symbol: string,
  limit: number = 20,
): Promise<SignalHistoryEntry[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const hKey = historyKey(symbol);
    const entries = await redis.zrange<SignalHistoryEntry[]>(hKey, -limit, -1);
    if (!entries) return [];
    // Return most-recent-first
    return entries.reverse();
  } catch (err) {
    console.warn(`[signal-history] getRecentHistory(${symbol}) failed:`, err);
    return [];
  }
}

// ─── Health check (optional, for /api/health endpoint) ───

export async function checkRedisHealth(): Promise<{ ok: boolean; message: string }> {
  const redis = getRedis();
  if (!redis) {
    return { ok: false, message: 'Upstash env vars not configured (no-persistence mode)' };
  }
  try {
    const pong = await redis.ping();
    return { ok: pong === 'PONG', message: pong === 'PONG' ? 'Redis OK' : `Unexpected: ${pong}` };
  } catch (err) {
    return { ok: false, message: `Ping failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
