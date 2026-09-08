/**
 * Live Smart-Money Footprint — unit tests (pure logic, no I/O).
 *
 * Covers:
 *   1. classifyFuturesBuildup — the 4 classic OI × price states + neutral
 *   2. classifyChurn — POSITIONING / MIXED / CHURN / UNKNOWN bands
 *   3. pcrDirection — rising / falling / flat + null safety
 *   4. computeFreshWalls — top adds, window-shift strikes excluded,
 *      distPct sign, sorting
 *   5. composeVerdict — bullish / bearish / retail-churn override /
 *      mixed / wall dominance near-spot filter
 *   6. computeSymbolFootprint — full orchestration: baseline-set state,
 *      fresh-baseline state, real delta state, futures-less degradation
 */
import {
  classifyFuturesBuildup,
  classifyChurn,
  pcrDirection,
  computeFreshWalls,
  composeVerdict,
  computeSymbolFootprint,
  makeBaseline,
  type StrikeFoot,
} from '../src/lib/footprint';

// ─── Test helpers ───

let pass = 0, fail = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}

// ─── 1. Futures buildup classifier ───

section('1. classifyFuturesBuildup');

let r = classifyFuturesBuildup(0.4, 1.2);
check('price↑ OI↑ → LONG_BUILDUP', r.buildup === 'LONG_BUILDUP' && r.tone === 'bullish');

r = classifyFuturesBuildup(-0.4, 1.2);
check('price↓ OI↑ → SHORT_BUILDUP (bearish — the live PUT case)', r.buildup === 'SHORT_BUILDUP' && r.tone === 'bearish');

r = classifyFuturesBuildup(0.4, -0.8);
check('price↑ OI↓ → SHORT_COVERING', r.buildup === 'SHORT_COVERING' && r.tone === 'bullish');

r = classifyFuturesBuildup(-0.4, -0.8);
check('price↓ OI↓ → LONG_UNWINDING', r.buildup === 'LONG_UNWINDING' && r.tone === 'bearish');

r = classifyFuturesBuildup(0.05, 0.05);
check('small moves → NEUTRAL', r.buildup === 'NEUTRAL' && r.tone === 'neutral');

r = classifyFuturesBuildup(0.4, 0.1);
check('price↑ but OI flat → NEUTRAL (needs BOTH)', r.buildup === 'NEUTRAL');

// Boundary behavior at exactly the thresholds
r = classifyFuturesBuildup(0.15, 0.3);
check('exact threshold values count as directional', r.buildup === 'LONG_BUILDUP');

// ─── 2. Churn classifier ───

section('2. classifyChurn');

check('ratio 0.41 → POSITIONING', classifyChurn(0.41).label === 'POSITIONING');
check('ratio 0.35 (boundary) → POSITIONING', classifyChurn(0.35).label === 'POSITIONING');
check('ratio 0.10 → CHURN', classifyChurn(0.10).label === 'CHURN');
check('ratio 0.15 (boundary) → CHURN', classifyChurn(0.15).label === 'CHURN');
check('ratio 0.22 → MIXED', classifyChurn(0.22).label === 'MIXED');
check('null → UNKNOWN', classifyChurn(null).label === 'UNKNOWN');

// ─── 3. PCR velocity ───

section('3. pcrDirection');

check('PCR +0.05 → rising', pcrDirection(1.15, 1.10).direction === 'rising');
check('PCR −0.05 → falling', pcrDirection(1.05, 1.10).direction === 'falling');
check('PCR +0.01 → flat', pcrDirection(1.11, 1.10).direction === 'flat');
check('delta value correct', pcrDirection(1.15, 1.10).delta === 0.050000000000000044 || Math.abs((pcrDirection(1.15, 1.10).delta ?? 0) - 0.05) < 1e-9);
check('null now → flat/null', pcrDirection(null, 1.1).direction === 'flat' && pcrDirection(null, 1.1).delta === null);
check('null base → flat/null', pcrDirection(1.1, null).direction === 'flat');

// ─── 4. Fresh walls ───

section('4. computeFreshWalls');

const baseStrikes: StrikeFoot[] = [
  { strike: 24800, ceOI: 100_000, peOI: 200_000, ceVol: 50_000, peVol: 80_000 },
  { strike: 24900, ceOI: 150_000, peOI: 250_000, ceVol: 60_000, peVol: 90_000 },
  { strike: 25000, ceOI: 300_000, peOI: 180_000, ceVol: 100_000, peVol: 70_000 },
  { strike: 25100, ceOI: 200_000, peOI: 120_000, ceVol: 80_000, peVol: 50_000 },
];

const nowStrikes: StrikeFoot[] = [
  { strike: 24800, ceOI: 110_000, peOI: 260_000, ceVol: 70_000, peVol: 120_000 }, // PE +60K
  { strike: 24900, ceOI: 160_000, peOI: 250_000, ceVol: 80_000, peVol: 90_000 },  // CE +10K
  { strike: 25000, ceOI: 360_000, peOI: 180_000, ceVol: 150_000, peVol: 70_000 }, // CE +60K
  { strike: 25100, ceOI: 205_000, peOI: 130_000, ceVol: 90_000, peVol: 60_000 },  // CE +5K, PE +10K
  { strike: 25200, ceOI: 90_000, peOI: 40_000, ceVol: 40_000, peVol: 20_000 },    // NEW strike — must be excluded
];

const walls = computeFreshWalls(baseStrikes, nowStrikes, 24980);

check('CE adds: 25,000 top (+60K)', walls.ceAdds[0]?.strike === 25000 && walls.ceAdds[0]?.delta === 60_000);
check('CE adds include 24,900 (+10K) and 24,800 (+10K) — tied, order not asserted',
  walls.ceAdds.some(w => w.strike === 24900 && w.delta === 10_000) && walls.ceAdds.some(w => w.strike === 24800 && w.delta === 10_000));
check('PE adds: 24,800 top (+60K)', walls.peAdds[0]?.strike === 24800 && walls.peAdds[0]?.delta === 60_000);
check('new window strike 25,200 excluded from CE adds', !walls.ceAdds.some(w => w.strike === 25200));
check('distPct sign: call wall above spot positive', (walls.ceAdds[0]?.distPct ?? 0) > 0);
check('distPct sign: put wall below spot negative', (walls.peAdds[0]?.distPct ?? 0) < 0);
check('OI drops not reported as adds', !walls.ceAdds.some(w => w.strike === 25100) || walls.ceAdds.find(w => w.strike === 25100)!.delta > 0);

// Top-N limit (WALL_TOP_N = 3)
const manyStrikes: StrikeFoot[] = Array.from({ length: 8 }, (_, i) => ({
  strike: 24000 + i * 100,
  ceOI: 100_000 + (i < 5 ? (5 - i) * 10_000 : 0), // 5 strikes add OI
  peOI: 100_000,
  ceVol: 10_000,
  peVol: 10_000,
}));
const walls2 = computeFreshWalls(
  manyStrikes.map(s => ({ ...s, ceOI: 100_000 })),
  manyStrikes,
  24400,
);
check('top-N cap respected (≤3 per side)', walls2.ceAdds.length <= 3);

// ─── 5. Verdict composer ───

section('5. composeVerdict');

// Bullish: long buildup (+2) + PCR rising (+1) = 3 → SMART MONEY BULLISH
const vBull = composeVerdict(
  { buildup: 'LONG_BUILDUP', tone: 'bullish' },
  { direction: 'rising', delta: 0.05 },
  { ceAdds: [], peAdds: [] },
  'POSITIONING',
);
check('long buildup + put writing → SMART MONEY BULLISH', vBull.label === 'SMART MONEY BULLISH' && vBull.tone === 'bullish' && vBull.score === 3);
check('bullish sentence mentions futures', vBull.sentence.includes('futures long buildup'));

// Bearish: short buildup (−2) + call writing (−1) + call walls (−1) = −4
const vBear = composeVerdict(
  { buildup: 'SHORT_BUILDUP', tone: 'bearish' },
  { direction: 'falling', delta: -0.06 },
  { ceAdds: [{ strike: 25100, delta: 50_000, distPct: 0.3 }], peAdds: [] },
  'POSITIONING',
);
check('short buildup + call writing + call walls → SMART MONEY BEARISH', vBear.label === 'SMART MONEY BEARISH' && vBear.score === -4);
check('bearish sentence names the wall strike', vBear.sentence.includes('25,100'));

// Retail churn override: churn + weak directional evidence
const vChurn = composeVerdict(
  { buildup: 'NEUTRAL', tone: 'neutral' },
  { direction: 'flat', delta: 0.005 },
  { ceAdds: [], peAdds: [] },
  'CHURN',
);
check('churn + no direction → RETAIL CHURN', vChurn.label === 'RETAIL CHURN' && vChurn.tone === 'churn');
check('churn sentence calls out no institutional conviction', vChurn.sentence.includes('no institutional conviction'));

// Churn override fires when directional evidence is weak/contradictory
// (SHORT_BUILDUP −2 + rising PCR +1 = −1, |score| ≤ 1 → RETAIL CHURN wins)
const vChurnOverride = composeVerdict(
  { buildup: 'SHORT_BUILDUP', tone: 'bearish' },
  { direction: 'rising', delta: 0.03 },
  { ceAdds: [], peAdds: [] },
  'CHURN',
);
check('churn + weak contradictory evidence (|score|≤1) → RETAIL CHURN override', vChurnOverride.label === 'RETAIL CHURN');

// Churn does NOT override strong aligned desk evidence (|score| ≥ 2)
const vChurnStrong = composeVerdict(
  { buildup: 'SHORT_BUILDUP', tone: 'bearish' },
  { direction: 'falling', delta: -0.04 },
  { ceAdds: [], peAdds: [] },
  'CHURN',
);
check('churn does NOT override strong bearish evidence (−2−1=−3)', vChurnStrong.label === 'SMART MONEY BEARISH');
// Mixed: everything neutral
const vMixed = composeVerdict(
  { buildup: 'NEUTRAL', tone: 'neutral' },
  { direction: 'flat', delta: 0 },
  { ceAdds: [], peAdds: [] },
  'MIXED',
);
check('all quiet → MIXED', vMixed.label === 'MIXED' && vMixed.tone === 'neutral');

// Null buildup (no futures data) — PCR alone gives ±1 max
const vPcrOnly = composeVerdict(
  null,
  { direction: 'rising', delta: 0.04 },
  { ceAdds: [], peAdds: [] },
  'MIXED',
);
check('PCR-only signal → BULLISH LEAN (capped, never STRONG without futures)', vPcrOnly.label === 'BULLISH LEAN');

// Wall dominance needs 20% edge AND near-spot filter
const vWallFar = composeVerdict(
  null,
  { direction: 'flat', delta: 0 },
  { ceAdds: [{ strike: 26000, delta: 100_000, distPct: 4.0 }], peAdds: [] }, // 4% away — ignored
  'MIXED',
);
check('far walls (4% away) do not score', vWallFar.score === 0 && vWallFar.label === 'MIXED');

// ─── 6. Full orchestration ───

section('6. computeSymbolFootprint');

const spot = 24980;
const futuresNow = { ltp: 24975, oi: 15_300_000, volume: 210_000, prevClose: 25080 }; // price −0.42%

// 6a. Baseline-set state (first scan of the day)
const fpFresh = computeSymbolFootprint({
  symbol: 'NIFTY', type: 'index', spot,
  baseline: null, baselineFresh: false, futures: futuresNow,
  strikes: nowStrikes, nowMs: 1_000_000,
});
check('no baseline → hasBaseline false', fpFresh.hasBaseline === false);
check('no baseline → verdict BASELINE SET', fpFresh.verdict.label === 'BASELINE SET');
check('no baseline → PCR now still computed', fpFresh.pcr.now != null);
check('no baseline → no futures classification', fpFresh.futures === null);

// 6b. Fresh baseline (captured THIS scan)
const bl = makeBaseline({ oi: 15_200_000, ltp: 25050, prevClose: 25080 }, baseStrikes, 900_000);
const fpFresh2 = computeSymbolFootprint({
  symbol: 'NIFTY', type: 'index', spot,
  baseline: bl, baselineFresh: true, futures: futuresNow,
  strikes: nowStrikes, nowMs: 1_000_000,
});
check('fresh baseline → BASELINE SET verdict', fpFresh2.verdict.label === 'BASELINE SET');

// 6c. Real delta state — bearish day: futures short buildup + call walls
const fpBear = computeSymbolFootprint({
  symbol: 'NIFTY', type: 'index', spot,
  baseline: bl, baselineFresh: false, futures: futuresNow,
  strikes: nowStrikes, nowMs: 3_600_000,
});
check('bear day → hasBaseline true', fpBear.hasBaseline === true);
check('bear day → baselineAgeMin ≈ 45', fpBear.baselineAgeMin === 45);
check('bear day → futures SHORT_BUILDUP (price −0.42%, OI +0.66%)', fpBear.futures?.buildup === 'SHORT_BUILDUP');
check('bear day → priceChgPct ≈ −0.418', Math.abs((fpBear.futures?.priceChgPct ?? 0) + 0.4183) < 0.001);
check('bear day → oiChgAbs = +100,000', fpBear.futures?.oiChgAbs === 100_000);
// Churn ratio: Σ|ΔOI| = 155K (70+10+60+15), Σvolume = 730K (intersection only) → 0.212 → MIXED
check('bear day → churn MIXED (ratio 0.21)', fpBear.churn.label === 'MIXED');
check('bear day → ratio ≈ 0.212', Math.abs((fpBear.churn.ratio ?? 0) - 0.212) < 0.005);
check('bear day → verdict SMART MONEY BEARISH', fpBear.verdict.label === 'SMART MONEY BEARISH');
check('bear day → sentence mentions short buildup', fpBear.verdict.sentence.includes('futures short buildup'));

// 6d. Bull day — futures long buildup + put walls
const futuresBull = { ltp: 25150, oi: 15_400_000, volume: 200_000, prevClose: 25080 }; // +0.28%
const fpBull = computeSymbolFootprint({
  symbol: 'BANKNIFTY', type: 'index', spot,
  baseline: bl, baselineFresh: false, futures: futuresBull,
  strikes: nowStrikes, nowMs: 3_600_000,
});
check('bull day → futures LONG_BUILDUP (price +0.28%, OI +1.3%)', fpBull.futures?.buildup === 'LONG_BUILDUP');

// 6e. No futures quote → futures section null, verdict still composed from PCR/walls
const fpNoFut = computeSymbolFootprint({
  symbol: 'TCS', type: 'stock', spot,
  baseline: bl, baselineFresh: false, futures: null,
  strikes: nowStrikes, nowMs: 3_600_000,
});
check('no futures → futures null', fpNoFut.futures === null);
check('no futures → verdict still composed', fpNoFut.verdict.label.length > 0);

// 6f. makeBaseline null-safety: zero futures OI stored as null
const blNoFut = makeBaseline({ oi: 0, ltp: 25050, prevClose: 0 }, baseStrikes, 900_000);
check('makeBaseline: zero OI → futOi null', blNoFut.futOi === null);
check('makeBaseline: zero prevClose → futPrevClose null', blNoFut.futPrevClose === null);

// ─── Summary ───

console.log(`\n${'═'.repeat(54)}`);
console.log(`Footprint tests: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
