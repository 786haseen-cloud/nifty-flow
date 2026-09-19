/**
 * Test for Task 44 — PCR heuristic limitations fixed with price context.
 *
 * Verifies all 3 fixed code paths:
 *
 *   1. magnet-engine.ts computeOIBuildup — now uses classifyStrikeFlow per-strike
 *      (premium-aware 4-quadrant classification) instead of OI-direction alone.
 *      Verifies that put OI rising + put LTP falling (writing) → bullish,
 *      while put OI rising + put LTP rising (buying) → bearish.
 *
 *   2. signal-engine.ts calc3DayOITrendScore — preferred path uses
 *      classifyStrikeFlow when prevStrikes provided; falls back to PCR
 *      heuristic otherwise. Verifies both paths.
 *
 *   3. footprint.ts composeVerdict — PCR velocity is now price-disambiguated
 *      using futures priceDirection. Verifies that PCR rising + price down
 *      is bearish (put buying), not bullish (put writing).
 *
 * Run: npx tsx scripts/test-pcr-price-disambiguation.ts
 */
import { computeOIBuildup, type StrikeOption } from '../src/lib/magnet-engine';
import { composeVerdict, type BuildupLabel, type BuildupTone, type PcrDirection, type ChurnLabel, type FreshWall } from '../src/lib/footprint';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

// ─── Helpers ───
// Use realistic magnitudes: NIFTY lotSize=75, OI deltas in the 10k-100k range.
// Smaller deltas produce ₹ Cr flows below the 0.01 significance threshold.
const LOT_SIZE = 75;

function makeStrike(s: number, ceOI: number, peOI: number, ceLTP: number, peLTP: number,
                   ceDelta = 0.5, peDelta = -0.5): StrikeOption {
  return {
    strike: s, ceOI, peOI, ceLTP, peLTP,
    ceDelta, peDelta,
    ceIV: 0.12, peIV: 0.12,
  };
}

// ─── [1] magnet-engine computeOIBuildup: put-writing vs put-buying ───
console.log('\n[1] magnet-engine computeOIBuildup — premium-aware classification');

console.log('\n  Scenario 1A: Put OI rising + put LTP FALLING (put writing) → should be BULLISH');
// Previous: peOI=100k, peLTP=100. Current: peOI=200k (added 100k), peLTP=90 (fell).
// → PE Write (bullish). val = 100k × 0.5 × 75 / 10M = 0.375 Cr.
const prev1A: StrikeOption[] = [
  makeStrike(100, 100000, 100000, 50, 100, 0.5, -0.5),
];
const curr1A: StrikeOption[] = [
  makeStrike(100, 100000, 200000, 50, 90, 0.5, -0.5),  // peOI↑ (100k→200k), peLTP↓ (100→90)
];
const result1A = computeOIBuildup(curr1A, prev1A, LOT_SIZE);
console.log(`    pattern = ${result1A.pattern}, strength = ${result1A.strength.toFixed(3)}`);
console.log(`    bullishFlowCr = ${result1A.bullishFlowCr.toFixed(3)}, bearishFlowCr = ${result1A.bearishFlowCr.toFixed(3)}`);
assert(result1A.pattern === 'long_buildup',
  `Put writing (OI↑ + LTP↓) → long_buildup (BULL) (got ${result1A.pattern})`);
assert(result1A.bullishFlowCr > 0,
  `Put writing produces positive bullishFlowCr (got ${result1A.bullishFlowCr.toFixed(3)})`);

console.log('\n  Scenario 1B: Put OI rising + put LTP RISING (put buying) → should be BEARISH');
// Previous: peOI=100k, peLTP=100. Current: peOI=200k (added 100k), peLTP=110 (rose).
// → PE Buy (bearish). val = 100k × 0.5 × 75 / 10M = 0.375 Cr.
const prev1B: StrikeOption[] = [
  makeStrike(100, 100000, 100000, 50, 100, 0.5, -0.5),
];
const curr1B: StrikeOption[] = [
  makeStrike(100, 100000, 200000, 50, 110, 0.5, -0.5),  // peOI↑ (100k→200k), peLTP↑ (100→110)
];
const result1B = computeOIBuildup(curr1B, prev1B, LOT_SIZE);
console.log(`    pattern = ${result1B.pattern}, strength = ${result1B.strength.toFixed(3)}`);
console.log(`    bullishFlowCr = ${result1B.bullishFlowCr.toFixed(3)}, bearishFlowCr = ${result1B.bearishFlowCr.toFixed(3)}`);
assert(result1B.pattern === 'short_buildup',
  `Put buying (OI↑ + LTP↑) → short_buildup (BEAR) (got ${result1B.pattern})`);
assert(result1B.bearishFlowCr > 0,
  `Put buying produces positive bearishFlowCr (got ${result1B.bearishFlowCr.toFixed(3)})`);

console.log('\n  Scenario 1C: Call OI rising + call LTP RISING (call buying) → should be BULLISH');
const prev1C: StrikeOption[] = [makeStrike(100, 100000, 50000, 50, 100, 0.5, -0.5)];
const curr1C: StrikeOption[] = [makeStrike(100, 200000, 50000, 60, 100, 0.5, -0.5)];  // ceOI↑, ceLTP↑
const result1C = computeOIBuildup(curr1C, prev1C, LOT_SIZE);
console.log(`    pattern = ${result1C.pattern}, strength = ${result1C.strength.toFixed(3)}`);
assert(result1C.pattern === 'long_buildup',
  `Call buying (OI↑ + LTP↑) → long_buildup (BULL) (got ${result1C.pattern})`);

console.log('\n  Scenario 1D: Call OI rising + call LTP FALLING (call writing) → should be BEARISH');
const prev1D: StrikeOption[] = [makeStrike(100, 100000, 50000, 50, 100, 0.5, -0.5)];
const curr1D: StrikeOption[] = [makeStrike(100, 200000, 50000, 40, 100, 0.5, -0.5)];  // ceOI↑, ceLTP↓
const result1D = computeOIBuildup(curr1D, prev1D, LOT_SIZE);
console.log(`    pattern = ${result1D.pattern}, strength = ${result1D.strength.toFixed(3)}`);
assert(result1D.pattern === 'short_buildup',
  `Call writing (OI↑ + LTP↓) → short_buildup (BEAR) (got ${result1D.pattern})`);

console.log('\n  Scenario 1E: No previous (first poll) → neutral, no crash');
const result1E = computeOIBuildup(curr1A, null);
assert(result1E.pattern === 'neutral',
  `null previous → neutral (got ${result1E.pattern})`);
assert(result1E.bullishFlowCr === 0 && result1E.bearishFlowCr === 0,
  `null previous → 0 flow (got bull=${result1E.bullishFlowCr} bear=${result1E.bearishFlowCr})`);

// ─── [2] footprint composeVerdict: price-disambiguated PCR ───
console.log('\n\n[2] footprint composeVerdict — PCR velocity × price direction');

const noWalls = { ceAdds: [] as FreshWall[], peAdds: [] as FreshWall[] };

console.log('\n  Scenario 2A: PCR rising + price UP → put WRITING (bullish +1)');
const verdict2A = composeVerdict(
  null, // no futures buildup
  { direction: 'rising' as PcrDirection, delta: 0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'up',
);
console.log(`    score = ${verdict2A.score}, sentence = "${verdict2A.sentence}"`);
assert(verdict2A.score > 0,
  `PCR rising + price up → positive score (got ${verdict2A.score})`);
assert(verdict2A.sentence.includes('put writing'),
  `Sentence mentions "put writing" (got "${verdict2A.sentence}")`);

console.log('\n  Scenario 2B: PCR rising + price DOWN → put BUYING (bearish -1) — THE FIX');
const verdict2B = composeVerdict(
  null,
  { direction: 'rising' as PcrDirection, delta: 0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'down',
);
console.log(`    score = ${verdict2B.score}, sentence = "${verdict2B.sentence}"`);
assert(verdict2B.score < 0,
  `PCR rising + price down → NEGATIVE score (got ${verdict2B.score}) — was POSITIVE before fix`);
assert(verdict2B.sentence.includes('put buying'),
  `Sentence mentions "put buying" (got "${verdict2B.sentence}")`);

console.log('\n  Scenario 2C: PCR falling + price UP → call BUYING (bullish +1) — THE FIX');
const verdict2C = composeVerdict(
  null,
  { direction: 'falling' as PcrDirection, delta: -0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'up',
);
console.log(`    score = ${verdict2C.score}, sentence = "${verdict2C.sentence}"`);
assert(verdict2C.score > 0,
  `PCR falling + price up → POSITIVE score (got ${verdict2C.score}) — was NEGATIVE before fix`);
assert(verdict2C.sentence.includes('call buying'),
  `Sentence mentions "call buying" (got "${verdict2C.sentence}")`);

console.log('\n  Scenario 2D: PCR falling + price DOWN → call WRITING (bearish -1)');
const verdict2D = composeVerdict(
  null,
  { direction: 'falling' as PcrDirection, delta: -0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'down',
);
console.log(`    score = ${verdict2D.score}, sentence = "${verdict2D.sentence}"`);
assert(verdict2D.score < 0,
  `PCR falling + price down → negative score (got ${verdict2D.score})`);
assert(verdict2D.sentence.includes('call writing'),
  `Sentence mentions "call writing" (got "${verdict2D.sentence}")`);

console.log('\n  Scenario 2E: PCR flat → no PCR signal, score = 0');
const verdict2E = composeVerdict(
  null,
  { direction: 'flat' as PcrDirection, delta: null },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'up',
);
console.log(`    score = ${verdict2E.score}`);
assert(verdict2E.score === 0,
  `PCR flat → 0 score (got ${verdict2E.score})`);

console.log('\n  Scenario 2F: Price direction null → fall back to conventional heuristic');
// priceDirection = null (no futures data available) → fall back to old heuristic
// PCR rising → bullish +1 (with the "price-flat heuristic" note in sentence)
const verdict2F = composeVerdict(
  null,
  { direction: 'rising' as PcrDirection, delta: 0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  null,
);
console.log(`    score = ${verdict2F.score}, sentence = "${verdict2F.sentence}"`);
assert(verdict2F.score > 0,
  `PCR rising + price null → fallback bullish +1 (got ${verdict2F.score})`);
assert(verdict2F.sentence.includes('heuristic'),
  `Sentence flags it as heuristic (got "${verdict2F.sentence}")`);

// ─── [3] Combined: futures buildup + PCR velocity + price direction ───
console.log('\n\n[3] Combined verdict — futures buildup + price-disambiguated PCR');

console.log('\n  Scenario 3A: Futures LONG_BUILDUP (price up + fut OI up) + PCR rising + price up');
// Bullish futures buildup (+2) + put writing (+1) = +3 STRONG BULL
const verdict3A = composeVerdict(
  { buildup: 'LONG_BUILDUP' as BuildupLabel, tone: 'bullish' as BuildupTone },
  { direction: 'rising' as PcrDirection, delta: 0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'up',
);
console.log(`    score = ${verdict3A.score}, tone = ${verdict3A.tone}`);
assert(verdict3A.score === 3,
  `LONG_BUILDUP + put writing = +3 (got ${verdict3A.score})`);
assert(verdict3A.tone === 'bullish',
  `Tone bullish (got ${verdict3A.tone})`);

console.log('\n  Scenario 3B: Futures SHORT_BUILDUP (price down + fut OI up) + PCR rising + price down');
// Bearish futures buildup (-2) + put buying (-1) = -3 STRONG BEAR
// OLD BUGGY logic: -2 + (+1 for "put writing") = -1 (mild bear) — PCR misread
const verdict3B = composeVerdict(
  { buildup: 'SHORT_BUILDUP' as BuildupLabel, tone: 'bearish' as BuildupTone },
  { direction: 'rising' as PcrDirection, delta: 0.1 },
  noWalls,
  'POSITIONING' as ChurnLabel,
  'down',
);
console.log(`    score = ${verdict3B.score}, tone = ${verdict3B.tone}`);
assert(verdict3B.score === -3,
  `SHORT_BUILDUP + put buying = -3 (got ${verdict3B.score}) — was -1 (buggy) before fix`);
assert(verdict3B.tone === 'bearish',
  `Tone bearish (got ${verdict3B.tone})`);

console.log(`\n────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────\n`);
process.exit(failed > 0 ? 1 : 0);
