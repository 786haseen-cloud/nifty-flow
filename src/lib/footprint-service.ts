/**
 * Footprint baseline store — Upstash persistence for the Live Smart-Money
 * Footprint panel's day-baseline.
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHY: the magnet-scan route runs on Vercel serverless — in-memory state
 * dies on cold start. The footprint's ΔOI math needs the FIRST capture of
 * the IST day to survive, so the baseline (futures OI + strike-level OI/
 * volume snapshot) is persisted once per day per symbol.
 *
 * STORAGE DESIGN (free-tier friendly):
 *   Key:    footprint:baselines:YYYY-MM-DD   (ONE key holds ALL symbols)
 *   TTL:    2 days (auto-cleanup; yesterday's baseline is worthless)
 *   Writes: 1/day (first scan that sees missing symbols) → ~1-3/day
 *   Reads:  only on cold start (in-memory memo serves the rest of the
 *           day) → a handful per day
 *
 * SEMANTICS: first-capture-wins. mergeFootprintBaselines never overwrites
 * an existing symbol entry — two concurrent instances racing at 9:16 both
 * write essentially the same data and the last write is harmless.
 *
 * ⚠️ Same @upstash/redis auto-deserialization trap as participant-service:
 * redis.get() may return an ALREADY-PARSED object. decodeJson handles both
 * shapes (object → as-is, string → JSON.parse). Do NOT double-parse.
 */

import { Redis } from '@upstash/redis';
import type { FootprintBaseline } from './footprint';

// ─── Lazy Redis client (singleton — same pattern as participant-service) ───

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
        '[footprint-service] Upstash env vars missing — baselines are memory-only. ' +
          'Footprint deltas reset on every Vercel cold start.'
      );
    }
    return null;
  }
  try {
    _redis = new Redis({ url, token });
  } catch (err) {
    console.warn('[footprint-service] Failed to init Redis client:', err);
    _redis = null;
  }
  return _redis;
}

// ─── Key + decode helpers ───

const TTL_SECONDS = 2 * 24 * 60 * 60; // 2 days — yesterday's baseline is worthless

function baselineKey(date: string): string {
  return `footprint:baselines:${date}`;
}

/**
 * Safely decode a value read from Upstash Redis — handles BOTH the
 * auto-deserialized object shape and the raw string shape.
 * (See participant-service.ts decodeJson for the full bug story.)
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

// ─── In-memory memo (per warm instance) ───

let memoDate: string | null = null;
let memoData: Record<string, FootprintBaseline> = {};

// ─── Public API ───

/**
 * Load the day's baselines. Served from the in-memory memo after the
 * first read (baselines only grow via merge, which updates the memo).
 */
export async function getFootprintBaselines(
  date: string,
): Promise<Record<string, FootprintBaseline>> {
  if (memoDate === date) return memoData;

  const redis = getRedis();
  if (!redis) {
    memoDate = date;
    memoData = {};
    return memoData;
  }

  try {
    const raw = await redis.get(baselineKey(date));
    const parsed = decodeJson<Record<string, FootprintBaseline>>(raw);
    memoDate = date;
    memoData = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[footprint-service] baseline read failed:', err);
    memoDate = date;
    memoData = {};
  }
  return memoData;
}

/**
 * Add NEW symbol baselines for the day (first-capture-wins — existing
 * entries are never overwritten). Updates the memo immediately and
 * persists the merged object to Upstash. Returns true when a write
 * happened. Non-fatal on Redis failure (panel degrades to memory-only).
 */
export async function mergeFootprintBaselines(
  date: string,
  additions: Record<string, FootprintBaseline>,
): Promise<boolean> {
  const keys = Object.keys(additions);
  if (keys.length === 0) return false;

  // Ensure the memo is loaded for today before merging
  const current = await getFootprintBaselines(date);
  let changed = false;
  for (const sym of keys) {
    if (!current[sym]) {
      current[sym] = additions[sym];
      changed = true;
    }
  }
  if (!changed) return false;

  const redis = getRedis();
  if (!redis) return false;

  try {
    await redis.set(baselineKey(date), JSON.stringify(current), { ex: TTL_SECONDS });
    return true;
  } catch (err) {
    console.warn('[footprint-service] baseline write failed:', err);
    return false;
  }
}

/** Test helper — reset the in-memory memo (does NOT touch Upstash). */
export function resetFootprintMemoForTest(): void {
  memoDate = null;
  memoData = {};
}
