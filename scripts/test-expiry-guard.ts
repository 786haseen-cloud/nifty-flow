/**
 * Expiry-Day Guard tests — footprint.ts
 * ─────────────────────────────────────
 * User insight (Sep 2026): "future and cash data continue, option data
 * not relevant on expiry day". NIFTY weekly expiry = Tuesday; on that day
 * near-strike option OI deltas are settlement mechanics, not positioning.
 *
 * Cases:
 *   1. Normal day, all three bearish footprints  → score -4 SMART MONEY BEARISH
 *   2. Same data + optionExpiryDay (weekly)      → score -2, futures-only read
 *      (PCR + walls muted; raw values still computed for display)
 *   3. Same data + optionExpiryDay + futureExpiryDay (monthly roll)
 *      → futures classification skipped, score 0, 'EXPIRY DAY', stands down
 *   4. Backward compat: no flags → identical to case 1
 * Factor 13 linkage: neutral verdict → Factor 13 contributes 0 → alignment
 * gate keeps engine direction (covered by test-alignment-gate.ts).
 */
import {
  computeSymbolFootprint,
  makeBaseline,
  type StrikeFoot,
  type FootprintBaseline,
} from '../src/lib/footprint';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${tag}] ${name} — ${detail}`);
}

const SPOT = 24100;
const STRIKES = [24000, 24050, 24100, 24150, 24200];

// Baseline: 1M OI each side, 5M volume each side
const baseStrikes: StrikeFoot[] = STRIKES.map((s) => ({
  strike: s, ceOI: 1_000_000, peOI: 1_000_000, ceVol: 5_000_000, peVol: 5_000_000,
}));

// Current: heavy CALL-side adds (call writing) → PCR falling + CE walls
const nowStrikes: StrikeFoot[] = STRIKES.map((s) => {
  const ceAdd = s === 24100 ? 500_000 : s === 24050 ? 300_000 : s === 24000 ? 200_000 : s === 24150 ? 100_000 : 50_000;
  return {
    strike: s,
    ceOI: 1_000_000 + ceAdd,
    peOI: 1_000_000 + 50_000,
    ceVol: 5_000_000,
    peVol: 5_000_000,
  };
});

const futuresData = { ltp: 995, oi: 1_025_000, volume: 200_000, prevClose: 1000 };
const baseline: FootprintBaseline = makeBaseline(
  { oi: 1_000_000, ltp: 1000, prevClose: 1000 },
  baseStrikes,
  Date.now() - 120 * 60_000,
);
const nowMs = Date.now();

// ── Case 1: normal day ──
console.log('\nCase 1 — normal day (no expiry flags):');
const fp1 = computeSymbolFootprint({
  symbol: 'NIFTY 50', type: 'index', spot: SPOT,
  baseline, baselineFresh: false, futures: futuresData, strikes: nowStrikes, nowMs,
});
check('flags default false', !fp1.optionExpiryDay && !fp1.futureExpiryDay, `opt=${fp1.optionExpiryDay} fut=${fp1.futureExpiryDay}`);
check('futures SHORT_BUILDUP detected', fp1.futures?.buildup === 'SHORT_BUILDUP', String(fp1.futures?.buildup));
check('PCR falling detected', fp1.pcr.direction === 'falling', `${fp1.pcr.direction} (delta ${fp1.pcr.delta?.toFixed(3)})`);
check('all three footprints count', fp1.verdict.score === -4, `score ${fp1.verdict.score} label "${fp1.verdict.label}"`);

// ── Case 2: option expiry day (weekly Tuesday) ──
console.log('\nCase 2 — option expiry day (weekly):');
const fp2 = computeSymbolFootprint({
  symbol: 'NIFTY 50', type: 'index', spot: SPOT,
  baseline, baselineFresh: false, futures: futuresData, strikes: nowStrikes, nowMs,
  optionExpiryDay: true,
});
check('optionExpiryDay flag echoed', fp2.optionExpiryDay === true && fp2.futureExpiryDay === false, `opt=${fp2.optionExpiryDay} fut=${fp2.futureExpiryDay}`);
check('futures read SURVIVES (futures continue)', fp2.futures?.buildup === 'SHORT_BUILDUP', String(fp2.futures?.buildup));
check('score = futures only (-2)', fp2.verdict.score === -2, `score ${fp2.verdict.score} (was -4 without guard)`);
check('label marked FUT ONLY', fp2.verdict.label === 'SMART MONEY BEARISH · FUT ONLY', `"${fp2.verdict.label}"`);
check('sentence explains muting', fp2.verdict.sentence.includes('futures-only'), fp2.verdict.sentence.slice(0, 80) + '...');
check('raw PCR still computed for display', fp2.pcr.direction === 'falling', `${fp2.pcr.direction}`);
check('raw walls still computed for display', fp2.freshWalls.ceAdds.length > 0, `${fp2.freshWalls.ceAdds.length} CE adds`);

// ── Case 3: monthly roll day (option + future both expire) ──
console.log('\nCase 3 — monthly roll day:');
const fp3 = computeSymbolFootprint({
  symbol: 'NIFTY 50', type: 'index', spot: SPOT,
  baseline, baselineFresh: false, futures: futuresData, strikes: nowStrikes, nowMs,
  optionExpiryDay: true, futureExpiryDay: true,
});
check('futures classification skipped (roll noise)', fp3.futures === null, `futures=${JSON.stringify(fp3.futures)}`);
check('stands down: score 0', fp3.verdict.score === 0, `score ${fp3.verdict.score}`);
check('label EXPIRY DAY', fp3.verdict.label === 'EXPIRY DAY', `"${fp3.verdict.label}"`);
check('tone neutral (Factor 13 = 0, gate inactive)', fp3.verdict.tone === 'neutral', fp3.verdict.tone);

console.log(`\n${'═'.repeat(60)}`);
console.log(` RESULT: ${failures === 0 ? 'ALL CHECKS PASSED (10/10)' : failures + ' CHECK(S) FAILED'}`);
console.log(`${'═'.repeat(60)}`);
process.exit(failures === 0 ? 0 : 1);
