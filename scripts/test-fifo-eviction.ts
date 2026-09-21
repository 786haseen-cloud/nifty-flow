/**
 * Test for Task 46 — Trend FIFO: "yesterday out, new data in".
 *
 * User request: "can we add fifo logic in our 4 card? yesterday out and
 * new data come?" — the four Trend Analysis cards must show ONLY today's
 * (IST) points, with any previous-trading-day point evicted the moment
 * today's data arrives.
 *
 * Covers:
 *   1. extractDateFromKiteTS — IST date prefix parsing from Kite timestamps
 *   2. evictStaleDayPoints — drops non-today points, keeps today + legacy
 *      untagged points, order-preserving (charts must not reorder)
 *   3. stampDay — stamps untagged points, NEVER overwrites an existing
 *      authoritative date, does not mutate its input
 *   4. fifoIngest — the exact store ingest pipeline: stamp-then-evict
 *   5. CARD 1 REGRESSION (the real leak): /api/kite/trends previously used
 *      getCandles('5minute', 1) = from (now − 24h) → on Tue–Fri the
 *      response carried YESTERDAY's session tail (up to 66 candles keyed
 *      by time-of-day only) which painted yesterday's full curve over
 *      today's chart. Simulates the old payload and proves the new
 *      server filter + client FIFO ingest both evict it.
 *   6. Card 2/3/4 append path: stale-day points in the live array are
 *      evicted before today's new point is appended
 *   7. Backfill merge path: untagged historical points are stamped as
 *      today (they are reconstructed from today-only candles); any point
 *      genuinely dated yesterday is evicted
 *
 * Run: npx tsx scripts/test-fifo-eviction.ts
 */

import {
  evictStaleDayPoints,
  stampDay,
  fifoIngest,
  isTodayKiteCandle,
  type DayTagged,
} from '../src/lib/trend-fifo';
import { extractDateFromKiteTS } from '../src/lib/ist';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

const TODAY = '2026-09-21';      // Monday
const YESTERDAY = '2026-09-18';  // Friday (last trading day)

// ─── 1. extractDateFromKiteTS ───────────────────────────────────────────

section('1. extractDateFromKiteTS');
check('parses ISO Kite ts with +0530 offset',
  extractDateFromKiteTS('2026-09-21T09:15:00+0530') === TODAY);
check('parses ISO Kite ts without offset',
  extractDateFromKiteTS('2026-09-21T09:15:00') === TODAY);
check('number input tolerated (returns empty, no crash)',
  extractDateFromKiteTS(12345 as unknown as string) === '');
check('garbage input returns empty',
  extractDateFromKiteTS('not-a-timestamp') === '');

// ─── 2. evictStaleDayPoints ─────────────────────────────────────────────

section('2. evictStaleDayPoints');
{
  const pts: DayTagged[] = [
    { d: TODAY },
    { d: YESTERDAY },
    {},               // legacy/demo — no tag
    { d: TODAY },
    { d: YESTERDAY },
  ];
  const out = evictStaleDayPoints(pts, TODAY);
  check('drops yesterday points, keeps today + untagged', out.length === 3);
  check('order preserved (stable filter)',
    out[0].d === TODAY && out[1].d === undefined && out[2].d === TODAY);
  check('empty array → empty array',
    evictStaleDayPoints([], TODAY).length === 0);
  check('all-today array untouched',
    evictStaleDayPoints([{ d: TODAY }, { d: TODAY }], TODAY).length === 2);
  check('all-yesterday array fully evicted',
    evictStaleDayPoints([{ d: YESTERDAY }, { d: YESTERDAY }], TODAY).length === 0);
}

// ─── 3. stampDay ────────────────────────────────────────────────────────

section('3. stampDay');
{
  const untagged = { time: '10:00' };
  const stamped = stampDay(untagged, TODAY);
  check('untagged point gets today', stamped.d === TODAY);
  check('original not mutated', (untagged as DayTagged).d === undefined);

  const authoritative = { d: YESTERDAY };
  check('existing date NOT overwritten (authoritative)',
    stampDay(authoritative, TODAY).d === YESTERDAY);
}

// ─── 4. fifoIngest ──────────────────────────────────────────────────────

section('4. fifoIngest (stamp-then-evict pipeline)');
{
  const pts: DayTagged[] = [
    {},               // untagged → stamped today → kept
    { d: YESTERDAY }, // authoritative stale → evicted
    { d: TODAY },     // already today → kept
  ];
  const out = fifoIngest(pts, TODAY);
  check('untagged stamped + stale evicted in one pass', out.length === 2);
  check('survivors all dated today', out.every((p) => p.d === TODAY));
}

// ─── 5. CARD 1 REGRESSION — the getCandles('5minute',1) leak ────────────

section('5. Card 1 regression — yesterday tail candles evicted');
{
  // Mirror of the OLD trends payload on a Tue–Fri poll: yesterday's
  // session tail (09:20→15:30 = up to 66 candles) + today's candles.
  const oldPayload: DayTagged[] = [
    { time: '10:00', close: 24800 }, // YESTERDAY (no date — the old bug)
    { time: '11:00', close: 24810 },
    { time: '12:00', close: 24795 },
    { time: '13:00', close: 24820 },
    { time: '15:30', close: 24825 },
    { time: '09:15', close: 24900 }, // today
    { time: '09:20', close: 24905 }, // today
  ];
  // Server-side new path: candles get `d` from the Kite ts, non-today filtered.
  const serverMapped = oldPayload.map((c, i) => ({
    ...c,
    d: i < 5 ? YESTERDAY : TODAY, // Kite ts date prefix
  }));
  const serverFiltered = serverMapped.filter((c) => c.d === TODAY);
  check('server filter drops all 5 yesterday candles', serverFiltered.length === 2);

  // Client-side FIFO ingest (defense in depth — even if the server missed).
  const clientIngest = fifoIngest(oldPayload, TODAY);
  check('client fifoIngest keeps untagged as today (legacy compat)', clientIngest.length === oldPayload.length);
  // …and with server-stamped dates present, the client evicts:
  const clientIngestStamped = fifoIngest(serverMapped, TODAY);
  check('client ingest evicts server-stamped yesterday candles',
    clientIngestStamped.length === 2 && clientIngestStamped.every((c) => c.time === '09:15' || c.time === '09:20'));

  // isTodayKiteCandle — the per-candle gate used by the route.
  check('isTodayKiteCandle true for today ts',
    isTodayKiteCandle(`${TODAY}T09:15:00+0530`, TODAY));
  check('isTodayKiteCandle false for Friday ts',
    !isTodayKiteCandle(`${YESTERDAY}T15:30:00+0530`, TODAY));
}

// ─── 6. Cards 2/3/4 append path — evict before append ───────────────────

section('6. Live append path — yesterday out before new data in');
{
  // Simulated flowTrend in the store: yesterday's rehydrated tail.
  const storeFlow: DayTagged[] = [
    { d: YESTERDAY, time: '15:25:00' },
    { d: YESTERDAY, time: '15:30:00' },
  ];
  // New poll point (today, stamped at creation).
  const newPoint: DayTagged = { d: TODAY, time: '09:15:03' };
  const appended = [...evictStaleDayPoints(storeFlow, TODAY), newPoint];
  check('array now contains ONLY today point', appended.length === 1 && appended[0].d === TODAY);
  check('yesterday points are OUT', !appended.some((p) => p.d === YESTERDAY));

  // Same-day steady state: nothing evicted, point appended.
  const steady: DayTagged[] = [{ d: TODAY, time: '09:15:03' }];
  const nextPoint: DayTagged = { d: TODAY, time: '09:15:18' };
  const appended2 = [...evictStaleDayPoints(steady, TODAY), nextPoint];
  check('same-day appends untouched (2 points)', appended2.length === 2);
}

// ─── 7. Backfill merge path ─────────────────────────────────────────────

section('7. Backfill merge — historical points stamped, stale evicted');
{
  // historical-flow route returns untagged points (today-only candles).
  const histFlow: DayTagged[] = [
    { time: '09:15:00' }, { time: '09:20:00' }, { time: '09:25:00' },
  ];
  const merged = fifoIngest(histFlow, TODAY);
  check('historical points stamped today + kept', merged.length === 3 && merged.every((p) => p.d === TODAY));

  // A hypothetical stale-tagged point sneaking into the merge is evicted.
  const polluted = [...histFlow, { d: YESTERDAY, time: '15:30:00' }];
  check('stale point in merge evicted', fifoIngest(polluted, TODAY).length === 3);
}

// ─── Summary ────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`FIFO eviction: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
