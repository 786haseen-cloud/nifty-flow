/**
 * Trend FIFO — "yesterday OUT, new data IN" (Task 46).
 *
 * USER REQUEST: "can we add fifo logic in our 4 card? yesterday out and
 * new data come?" — the four Trend Analysis cards (Nifty 50 Intraday
 * Price Trend, Net Cash Flow — 15 Stocks, Index Options Money Flow,
 * Stock Options Money Flow) must show ONLY the current IST trading day's
 * points, with any previous-day point evicted the moment today's data
 * arrives — first in, first out at the DAY boundary.
 *
 * WHY A PER-POINT DATE TAG: trend points are keyed by time-of-day only
 * ('09:15', '09:15:00' …) with no date, so any stale-day point that slips
 * past the store's day-rollover clear (rehydrated localStorage, a backfill
 * merge edge case, a server path returning another session's candles —
 * exactly what getCandles('5minute', 1) did for Card 1 on Tue–Fri) is
 * indistinguishable from today's data and paints over it on the shared
 * 09:15→15:40 x-axis. Tagging every point with its IST date (`d`) makes
 * eviction a trivial, testable filter.
 *
 * PURE FUNCTIONS ONLY — no React, no zustand, no Date.now() — so the FIFO
 * guarantee is unit-testable (scripts/test-fifo-eviction.ts).
 */

import { extractDateFromKiteTS } from './ist';

/** Minimal shape any day-evictable trend point satisfies. */
export interface DayTagged {
  /** IST trading date 'YYYY-MM-DD'. Absent = legacy/demo point (kept). */
  d?: string | null;
}

/**
 * FIFO day-eviction: keep only points belonging to `todayIST`.
 *
 * Points WITHOUT a date tag are KEPT for backward compatibility — data
 * persisted by a pre-Task-46 build (localStorage `trend-store-v2`) and
 * demo-mode points carry no `d`; they were all ingested "today" in the
 * sense that the store's istDate rollover already cleared cross-day data
 * for them. From Task 46 on, every ingest path stamps `d`, so the
 * missing-tag case disappears after one trading day.
 *
 * Order-preserving (stable filter) — chart x-sequences must not reorder.
 */
export function evictStaleDayPoints<T extends DayTagged>(points: T[], todayIST: string): T[] {
  return points.filter((p) => !p.d || p.d === todayIST);
}

/**
 * Stamp a point with `todayIST` when it carries no date tag.
 * Points that already carry a date are returned untouched — the original
 * (server/Kite) date is authoritative and must NOT be overwritten, or a
 * stale-day leak would masquerade as today's data.
 */
export function stampDay<T extends DayTagged>(point: T, todayIST: string): T {
  if (point.d) return point;
  return { ...point, d: todayIST };
}

/**
 * Stamp + evict in one pass — the exact sequence every ingest path runs:
 *   1. stamp untagged points as today (they were just fetched/created now),
 *   2. evict anything whose authoritative date is NOT today.
 */
export function fifoIngest<T extends DayTagged>(points: T[], todayIST: string): T[] {
  return evictStaleDayPoints(points.map((p) => stampDay(p, todayIST)), todayIST);
}

/**
 * True when a Kite historical candle belongs to `todayIST`.
 * Thin wrapper over extractDateFromKiteTS so candle pipelines read
 * declaratively and the date-prefix contract lives in exactly one place.
 */
export function isTodayKiteCandle(kiteTimestamp: string | number, todayIST: string): boolean {
  return extractDateFromKiteTS(kiteTimestamp) === todayIST;
}
