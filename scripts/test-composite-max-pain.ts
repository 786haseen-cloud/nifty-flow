/**
 * Test for Task 41 — Composite Max Pain Magnet.
 *
 * 1. Expiry calendar: NSE Tuesday / BSE Thursday detection, weekly vs
 *    monthly, tier classification.
 * 2. Composite computation: equal-weighted vs OI-weighted pull, per-symbol
 *    contribution, direction verdict.
 *
 * Run: npx tsx scripts/test-composite-max-pain.ts
 */
import { getExpiryContext, shortExpirySummary } from '../src/lib/expiry-calendar';
import {
  computeCompositeMaxPain,
  formatPullCr,
  formatPullPct,
  type MaxPainScanItem,
} from '../src/lib/composite-max-pain';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ─── Expiry calendar tests ───
console.log('\n[1] Expiry calendar — NSE Tuesday / BSE Thursday detection');

// Construct IST-shifted dates by setting UTC fields directly.
// Note: istNow() returns Date whose UTC fields are IST values, so when we
// build test dates we set UTC fields to IST values too.
function istDate(year: number, monthIdx: number, day: number, dowExpected?: number): Date {
  const d = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0)); // noon IST
  if (dowExpected !== undefined) {
    const got = d.getUTCDay();
    if (got !== dowExpected) {
      throw new Error(`Expected ${year}-${monthIdx + 1}-${day} to be DOW ${dowExpected}, got ${got}`);
    }
  }
  return d;
}

// Sep 2026 calendar (Tue=2, Thu=4):
//  Tue Sep 1   — weekly
//  Tue Sep 8   — weekly
//  Tue Sep 15  — weekly
//  Tue Sep 22  — weekly
//  Tue Sep 29  — LAST Tue → MONTHLY (NSE super-basket)
//  Thu Sep 3   — weekly
//  Thu Sep 10  — weekly
//  Thu Sep 17  — weekly
//  Thu Sep 24  — LAST Thu → MONTHLY (BSE SENSEX)
// Let me verify: Sep 2026 — let me check the actual last Tuesday.
// Sep has 30 days. Sep 30, 2026 — what day of week is that?
// Using Date.UTC(2026, 8, 30):
const sep301 = new Date(Date.UTC(2026, 8, 30, 12, 0, 0));
console.log(`    (verifying) Sep 30, 2026 IST dow = ${sep301.getUTCDay()} (2=Tue, 4=Thu)`);
const sep29 = new Date(Date.UTC(2026, 8, 29, 12, 0, 0));
console.log(`    (verifying) Sep 29, 2026 IST dow = ${sep29.getUTCDay()} (2=Tue, 4=Thu)`);
const sep24 = new Date(Date.UTC(2026, 8, 24, 12, 0, 0));
console.log(`    (verifying) Sep 24, 2026 IST dow = ${sep24.getUTCDay()} (2=Tue, 4=Thu)`);

// Test: Sep 29 2026 — should be NSE MONTHLY
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 29, 12, 0, 0)));
  assert(ctx.nseExpiryType === 'MONTHLY', `Sep 29 2026 → NSE MONTHLY (got ${ctx.nseExpiryType})`);
  assert(ctx.bseExpiryType === 'NONE', `Sep 29 2026 → BSE NONE (got ${ctx.bseExpiryType})`);
  assert(ctx.tier === 1, `Sep 29 2026 → TIER 1 (got ${ctx.tier})`);
  assert(ctx.magnetStrength === 'STRONGEST', `Sep 29 2026 → STRONGEST (got ${ctx.magnetStrength})`);
  assert(ctx.tierLabel.includes('Super Monthly'), `Sep 29 2026 → label has "Super Monthly" (got "${ctx.tierLabel}")`);
}

// Test: Sep 24 2026 — should be BSE MONTHLY (last Thursday)
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 24, 12, 0, 0)));
  assert(ctx.bseExpiryType === 'MONTHLY', `Sep 24 2026 → BSE MONTHLY (got ${ctx.bseExpiryType})`);
  assert(ctx.nseExpiryType === 'NONE', `Sep 24 2026 → NSE NONE (got ${ctx.nseExpiryType})`);
  assert(ctx.tier === 1, `Sep 24 2026 → TIER 1 (got ${ctx.tier})`);
  assert(ctx.magnetStrength === 'STRONG', `Sep 24 2026 → STRONG (got ${ctx.magnetStrength})`);
  assert(ctx.tierLabel.includes('SENSEX Monthly'), `Sep 24 2026 → label has "SENSEX Monthly" (got "${ctx.tierLabel}")`);
}

// Test: Sep 22 2026 (Tuesday but not last) — should be NSE WEEKLY
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 22, 12, 0, 0)));
  assert(ctx.nseExpiryType === 'WEEKLY', `Sep 22 2026 → NSE WEEKLY (got ${ctx.nseExpiryType})`);
  assert(ctx.tier === 2, `Sep 22 2026 → TIER 2 (got ${ctx.tier})`);
  assert(ctx.magnetStrength === 'STRONG', `Sep 22 2026 → STRONG (got ${ctx.magnetStrength})`);
  assert(ctx.tierLabel.includes('NIFTY Weekly'), `Sep 22 2026 → label has "NIFTY Weekly" (got "${ctx.tierLabel}")`);
}

// Test: Sep 17 2026 (Thursday but not last) — should be BSE WEEKLY
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 17, 12, 0, 0)));
  assert(ctx.bseExpiryType === 'WEEKLY', `Sep 17 2026 → BSE WEEKLY (got ${ctx.bseExpiryType})`);
  assert(ctx.tier === 2, `Sep 17 2026 → TIER 2 (got ${ctx.tier})`);
  assert(ctx.tierLabel.includes('SENSEX Weekly'), `Sep 17 2026 → label has "SENSEX Weekly" (got "${ctx.tierLabel}")`);
}

// Test: Sep 28 2026 (Monday) — T-1 day before NSE Tuesday → TIER 3
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 28, 12, 0, 0)));
  assert(ctx.nseExpiryType === 'NONE', `Sep 28 2026 → NSE NONE (got ${ctx.nseExpiryType})`);
  assert(ctx.daysToNSEExpiry === 1, `Sep 28 2026 → 1 day to NSE expiry (got ${ctx.daysToNSEExpiry})`);
  assert(ctx.tier === 3, `Sep 28 2026 → TIER 3 (got ${ctx.tier})`);
  assert(ctx.magnetStrength === 'BUILDING', `Sep 28 2026 → BUILDING (got ${ctx.magnetStrength})`);
}

// Test: Sep 23 2026 (Wednesday) — T-1 before BSE Thursday → TIER 3
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 23, 12, 0, 0)));
  assert(ctx.daysToBSEExpiry === 1, `Sep 23 2026 → 1 day to BSE expiry (got ${ctx.daysToBSEExpiry})`);
  assert(ctx.tier === 3, `Sep 23 2026 → TIER 3 (got ${ctx.tier})`);
}

// Test: Sep 9 2026 (Wednesday, mid-week, far from any expiry) → TIER 4 drift
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 9, 12, 0, 0)));
  // Wed Sep 9 — days to NSE Tuesday = 6 (next Tue is Sep 15), days to BSE Thu = 1 (Sep 10)
  // Wait — Sep 9 is Wed, next Thu is Sep 10 → daysToBSEExpiry = 1 → TIER 3
  // Let me pick a different date.
  // Sep 7 2026 is Monday — next Tue is Sep 8 (1 day). So that's TIER 3 too.
  // Need to find a date that's >1 day from BOTH Tues and Thu.
  // Sep 11 is Friday — daysToNSEExpiry=4 (Sep 15), daysToBSEExpiry=6 (Sep 17) → TIER 4 ✓
}

{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 11, 12, 0, 0)));
  assert(ctx.daysToNSEExpiry === 4, `Sep 11 2026 → 4 days to NSE (got ${ctx.daysToNSEExpiry})`);
  assert(ctx.daysToBSEExpiry === 6, `Sep 11 2026 → 6 days to BSE (got ${ctx.daysToBSEExpiry})`);
  assert(ctx.tier === 4, `Sep 11 2026 → TIER 4 drift (got ${ctx.tier})`);
  assert(ctx.magnetStrength === 'WEAK', `Sep 11 2026 → WEAK (got ${ctx.magnetStrength})`);
}

// Test: shortExpirySummary formats correctly
{
  const ctx = getExpiryContext(new Date(Date.UTC(2026, 8, 29, 12, 0, 0)));
  const s = shortExpirySummary(ctx);
  assert(s === 'NSE monthly • BSE —', `Sep 29 short summary (got "${s}")`);
}

// ─── Composite computation tests ───
console.log('\n[2] Composite computation — OI-weighted pull');

// Scenario A: All 4 indices below max pain → pull UP
// 5 stocks above max pain → pull DOWN
// NIFTY dominates via OI weighting.
const scenarioA: MaxPainScanItem[] = [
  // Indices — spot below maxPain → UP pull
  { symbol: 'NIFTY',     name: 'Nifty 50',     type: 'index', spot: 24200, maxPain: 24350, dist: -150, distPct: -0.62, totalCEOI: 5_000_000, totalPEOI: 5_500_000 },
  { symbol: 'SENSEX',    name: 'Sensex',       type: 'index', spot: 79900, maxPain: 80200, dist: -300, distPct: -0.38, totalCEOI: 1_200_000, totalPEOI: 1_300_000 },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty',   type: 'index', spot: 52100, maxPain: 52300, dist: -200, distPct: -0.38, totalCEOI: 2_000_000, totalPEOI: 2_200_000 },
  { symbol: 'FINNIFTY',  name: 'Fin Nifty',    type: 'index', spot: 23000, maxPain: 23150, dist: -150, distPct: -0.65, totalCEOI: 1_500_000, totalPEOI: 1_600_000 },
  // Stocks — spot above maxPain → DOWN pull (5 names to match user's example)
  { symbol: 'HDFCBANK',  name: 'HDFC Bank',    type: 'stock', spot: 1720, maxPain: 1700, dist: 20, distPct: 1.16, totalCEOI: 800_000, totalPEOI: 700_000 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank',   type: 'stock', spot: 1290, maxPain: 1275, dist: 15, distPct: 1.16, totalCEOI: 700_000, totalPEOI: 650_000 },
  { symbol: 'RELIANCE',  name: 'Reliance',     type: 'stock', spot: 2960, maxPain: 2940, dist: 20, distPct: 0.68, totalCEOI: 1_200_000, totalPEOI: 1_100_000 },
  { symbol: 'TCS',       name: 'TCS',          type: 'stock', spot: 4130, maxPain: 4110, dist: 20, distPct: 0.48, totalCEOI: 600_000, totalPEOI: 550_000 },
  { symbol: 'INFY',      name: 'Infosys',      type: 'stock', spot: 1920, maxPain: 1905, dist: 15, distPct: 0.78, totalCEOI: 500_000, totalPEOI: 480_000 },
  // Rest flat / near-flat
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', type: 'stock', spot: 1620, maxPain: 1620, dist: 0, distPct: 0, totalCEOI: 400_000, totalPEOI: 400_000 },
  { symbol: 'LT',         name: 'L&T',          type: 'stock', spot: 3580, maxPain: 3575, dist: 5, distPct: 0.14, totalCEOI: 300_000, totalPEOI: 280_000 },
  { symbol: 'SBIN',       name: 'SBI',           type: 'stock', spot: 825,  maxPain: 828,  dist: -3, distPct: -0.36, totalCEOI: 500_000, totalPEOI: 520_000 },
  { symbol: 'AXISBANK',   name: 'Axis Bank',     type: 'stock', spot: 1145, maxPain: 1140, dist: 5,  distPct: 0.44, totalCEOI: 350_000, totalPEOI: 320_000 },
  { symbol: 'KOTAKBANK',  name: 'Kotak Bank',    type: 'stock', spot: 1790, maxPain: 1785, dist: 5, distPct: 0.28, totalCEOI: 250_000, totalPEOI: 230_000 },
  { symbol: 'M&M',        name: 'M&M',           type: 'stock', spot: 2940, maxPain: 2940, dist: 0, distPct: 0, totalCEOI: 200_000, totalPEOI: 200_000 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', type: 'stock', spot: 7280, maxPain: 7290, dist: -10, distPct: -0.14, totalCEOI: 80_000, totalPEOI: 90_000 },
  { symbol: 'ITC',        name: 'ITC',           type: 'stock', spot: 465,  maxPain: 465,  dist: 0, distPct: 0, totalCEOI: 900_000, totalPEOI: 880_000 },
  { symbol: 'ETERNAL',    name: 'Eternal',       type: 'stock', spot: 710,  maxPain: 705,  dist: 5, distPct: 0.70, totalCEOI: 1_000_000, totalPEOI: 950_000 },
  { symbol: 'TITAN',      name: 'Titan',         type: 'stock', spot: 3560, maxPain: 3545, dist: 15, distPct: 0.42, totalCEOI: 150_000, totalPEOI: 140_000 },
];

const resA = computeCompositeMaxPain(scenarioA);

assert(resA.totalCount === 19, `Total 19 symbols (got ${resA.totalCount})`);
// Re-counted by hand:
//   UP (spot below maxPain): NIFTY, SENSEX, BANKNIFTY, FINNIFTY, SBIN, BAJFINANCE = 6
//   DOWN (spot above maxPain): HDFCBANK, ICICIBANK, RELIANCE, TCS, INFY, LT,
//                              AXISBANK, KOTAKBANK, ETERNAL, TITAN = 10
//   FLAT: BHARTIARTL, M&M, ITC = 3
assert(resA.upCount === 6, `6 symbols pulling UP (got ${resA.upCount})`);
assert(resA.downCount === 10, `10 symbols pulling DOWN (got ${resA.downCount})`);
assert(resA.flatCount === 3, `3 flat symbols (got ${resA.flatCount})`);

// NIFTY dominates OI weight — check it's the top contributor by abs
const topContrib = resA.perSymbol[0];
assert(topContrib.symbol === 'NIFTY', `Top contributor is NIFTY (got ${topContrib.symbol})`);
console.log(`    NIFTY contributionCr = ${topContrib.contributionCr.toFixed(2)} Cr`);
console.log(`    NIFTY oiWeight = ${(topContrib.oiWeight * 100).toFixed(2)}%`);

// Indices pull UP (spot below maxPain), stocks pull DOWN (spot above)
assert(resA.indicesPullCr > 0, `Indices pull UP (positive ₹ Cr) — got ${resA.indicesPullCr.toFixed(2)}`);
assert(resA.stocksPullCr < 0, `Stocks pull DOWN (negative ₹ Cr) — got ${resA.stocksPullCr.toFixed(2)}`);

// Direction: NIFTY OI is huge so total ₹ Cr should be positive (UP)
console.log(`    totalPullCr = ${resA.totalPullCr.toFixed(2)} Cr`);
console.log(`    oiWeightedPullPct = ${resA.oiWeightedPullPct.toFixed(3)}%`);
console.log(`    equalWeightedPullPct = ${resA.equalWeightedPullPct.toFixed(3)}%`);

// Equal-weighted should be DOWN (more stocks above maxPain)
// Actually let me check: 12 stocks above maxPain, 4 indices below, 1 stock below, ...
// Re-counting:
// Indices: NIFTY/SENSEX/BANKNIFTY/FINNIFTY — all 4 below maxPain (UP pull, dist<0)
// Stocks: HDFCBANK, ICICIBANK, RELIANCE, TCS, INFY (5 above maxPain, DOWN pull)
//         BHARTIARTL flat, LT above, SBIN below, AXISBANK above, KOTAKBANK above,
//         M&M flat, BAJFINANCE below, ITC flat, ETERNAL above, TITAN above
// Down (spot above maxPain): HDFCBANK, ICICIBANK, RELIANCE, TCS, INFY, LT, AXISBANK, KOTAKBANK, ETERNAL, TITAN = 10
// Up (spot below maxPain): NIFTY, SENSEX, BANKNIFTY, FINNIFTY, SBIN, BAJFINANCE = 6
// Flat: BHARTIARTL, M&M, ITC = 3
// Total = 19 ✓
// Wait, my assert expected upCount=5 and downCount=12 — let me recompute and fix.

console.log(`    actual upCount = ${resA.upCount}, downCount = ${resA.downCount}, flatCount = ${resA.flatCount}`);
// Per the re-count: 6 up, 10 down, 3 flat = 19. So the test expectations need updating.

// Let me just verify the function returns the correct computed values (since I just re-counted by hand)
assert(resA.upCount + resA.downCount + resA.flatCount === 19, `Counts sum to 19 (got ${resA.upCount + resA.downCount + resA.flatCount})`);

// Format helpers
assert(formatPullCr(1234.5) === '+1,235 Cr', `formatPullCr(1234.5) (got "${formatPullCr(1234.5)}")`);
assert(formatPullCr(-75.2).startsWith('−'), `formatPullCr(-75.2) starts with − (got "${formatPullCr(-75.2)}")`);
assert(formatPullPct(0.42) === '+0.42%', `formatPullPct(0.42) (got "${formatPullPct(0.42)}")`);
assert(formatPullPct(-0.18) === '−0.18%', `formatPullPct(-0.18) (got "${formatPullPct(-0.18)}")`);

// Scenario B: Empty array → neutral, no crash
console.log('\n[3] Edge cases — empty input');
const resB = computeCompositeMaxPain([]);
assert(resB.totalCount === 0, `Empty input → 0 symbols`);
assert(resB.totalPullCr === 0, `Empty input → 0 pull`);
assert(resB.direction === 'NEUTRAL', `Empty input → NEUTRAL direction`);
assert(resB.oiWeightedPullPct === 0, `Empty input → 0% pull`);

// Scenario C: All flat → NEUTRAL
console.log('\n[4] All-flat → NEUTRAL');
const scenarioC: MaxPainScanItem[] = [
  { symbol: 'NIFTY', name: 'Nifty', type: 'index', spot: 24000, maxPain: 24000, dist: 0, distPct: 0, totalCEOI: 1_000_000, totalPEOI: 1_000_000 },
];
const resC = computeCompositeMaxPain(scenarioC);
assert(resC.direction === 'NEUTRAL', `All-flat → NEUTRAL (got ${resC.direction})`);
assert(resC.flatCount === 1, `All-flat → 1 flat (got ${resC.flatCount})`);

console.log(`\n────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────\n`);
process.exit(failed > 0 ? 1 : 0);
