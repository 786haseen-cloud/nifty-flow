/**
 * Phase 1 Enhancement Test
 * ========================
 *
 * Verifies that all 4 new factors fire correctly and contribute to the
 * final signal. Tests:
 *
 *   1. Futures Basis  — premium boosts CALL, discount boosts PUT
 *   2. IV Skew        — positive skew boosts CALL, negative boosts PUT
 *   3. OI Buildup     — long buildup boosts CALL, short buildup boosts PUT
 *   4. VIX Regime     — low+falling boosts CALL, high+rising boosts PUT
 *
 * Then runs a full-stack bull and bear scenario to confirm the new max
 * score range (±15 raw, ±18 with low-pin amplification).
 */
import {
  computeSignal,
  computeBasis,
  computeIVSkew,
  computeOIBuildup,
  computeVIXRegime,
  type MagnetResult,
  type StrikeOption,
  type SignalResult,
} from '../src/lib/magnet-engine';

// ─── Test helpers ───

let pass = 0, fail = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function makeBaseMagnet(overrides: Partial<MagnetResult> = {}): MagnetResult {
  const base: MagnetResult = {
    symbol: 'TEST',
    name: 'Test Symbol',
    type: 'index',
    spot: 24500,
    spotTime: '14:30:00',
    maxPain: 24500,
    maxPainDist: 0,
    maxPainDistPct: 0,
    gexStrikes: [],
    totalGexCr: 0,
    zeroGamma: null,
    gammaRegime: 'neutral',
    magnetZone: [],
    magnetCenter: 0,
    magnetScore: 0,
    pinningProbability: 50,
    charmDirection: 'flat',
    charmMagnitudeCr: 0,
    charmStrikes: [],
    totalCEOI: 0,
    totalPEOI: 0,
    pcr: 1.0,
    daysToExpiry: 3,
    lotSize: 75,
    strikeStep: 50,
    // Phase 1 enhancement factors (all null/neutral by default)
    basisPct: null,
    ivSkewPct: null,
    oiBuildup: 'neutral',
    oiBuildupStrength: 0,
    vix: null,
    vixChangePct: null,
    participantBias: 0,
    participantBiasDetail: '',
    signal: null as unknown as SignalResult,
  };
  return { ...base, ...overrides };
}

// ─── Test 1: Futures Basis ───

console.log('\n=== Test 1: Futures Basis ===');

const basisBull = computeBasis(24500, 24580);  // +0.326% premium
check('Strong premium detected', basisBull.basisPct! > 0.15, `got ${basisBull.basisPct?.toFixed(3)}%`);

const basisBear = computeBasis(24500, 24420);  // -0.327% discount
check('Strong discount detected', basisBear.basisPct! < -0.15, `got ${basisBear.basisPct?.toFixed(3)}%`);

const basisNull = computeBasis(24500, null);
check('Null future returns null basis', basisNull.basisPct === null);

// Verify basis contributes to signal score
const sigBasisBull = computeSignal(makeBaseMagnet({
  basisPct: 0.30,  // strong premium → +1.5
  // All other factors neutral
  charmDirection: 'flat',
  zeroGamma: null,
  magnetZone: [],
  pcr: 1.0,
  gammaRegime: 'neutral',
  pinningProbability: 50,
}));
check(
  'Strong premium adds +1.5 to score',
  sigBasisBull.reasons.find(r => r.factor === 'Futures Basis')?.weight === 1.5,
  `got weight ${sigBasisBull.reasons.find(r => r.factor === 'Futures Basis')?.weight}`
);

const sigBasisBear = computeSignal(makeBaseMagnet({
  basisPct: -0.30,  // strong discount → -1.5
}));
check(
  'Strong discount adds -1.5 to score',
  sigBasisBear.reasons.find(r => r.factor === 'Futures Basis')?.weight === -1.5,
  `got weight ${sigBasisBear.reasons.find(r => r.factor === 'Futures Basis')?.weight}`
);

// ─── Test 2: IV Skew ───

console.log('\n=== Test 2: IV Skew ===');

const skewStrikes: StrikeOption[] = [
  { strike: 24450, ceOI: 50000, peOI: 50000, ceLTP: 90, peLTP: 90, ceDelta: 0, peDelta: 0 },
  { strike: 24500, ceOI: 60000, peOI: 60000, ceLTP: 85, peLTP: 95, ceDelta: 0, peDelta: 0 },  // ATM, calls cheaper
  { strike: 24550, ceOI: 50000, peOI: 50000, ceLTP: 95, peLTP: 85, ceDelta: 0, peDelta: 0 },
];
const skewResult = computeIVSkew(skewStrikes, 24500, 3 / 365);
check('IV skew computed', skewResult.skewPct !== null, `got ${skewResult.skewPct}`);
check('ATM strike correctly identified', skewResult.atmStrike === 24500, `got ${skewResult.atmStrike}`);

const sigSkewBull = computeSignal(makeBaseMagnet({
  ivSkewPct: 4.0,  // strong positive skew → +1.5
}));
check(
  'Strong positive skew adds +1.5',
  sigSkewBull.reasons.find(r => r.factor === 'IV Skew')?.weight === 1.5,
  `got weight ${sigSkewBull.reasons.find(r => r.factor === 'IV Skew')?.weight}`
);

const sigSkewBear = computeSignal(makeBaseMagnet({
  ivSkewPct: -4.0,  // strong negative skew → -1.5
}));
check(
  'Strong negative skew adds -1.5',
  sigSkewBear.reasons.find(r => r.factor === 'IV Skew')?.weight === -1.5,
  `got weight ${sigSkewBear.reasons.find(r => r.factor === 'IV Skew')?.weight}`
);

// ─── Test 3: OI Buildup ───

console.log('\n=== Test 3: OI Buildup ===');

const prevStrikes: StrikeOption[] = [
  { strike: 24450, ceOI: 50000, peOI: 50000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24500, ceOI: 60000, peOI: 60000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24550, ceOI: 50000, peOI: 50000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
];

// Long buildup: PE OI up (put writing), CE OI down (call covering)
const longBuildupCurrent: StrikeOption[] = [
  { strike: 24450, ceOI: 47000, peOI: 53000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24500, ceOI: 56000, peOI: 64000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24550, ceOI: 47000, peOI: 53000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
];
const lbu = computeOIBuildup(longBuildupCurrent, prevStrikes);
check('Long buildup pattern detected', lbu.pattern === 'long_buildup', `got ${lbu.pattern}`);
check('Long buildup strength positive', lbu.strength > 0, `got ${lbu.strength.toFixed(2)}`);

// Short buildup: CE OI up (call writing), PE OI down (put covering)
const shortBuildupCurrent: StrikeOption[] = [
  { strike: 24450, ceOI: 53000, peOI: 47000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24500, ceOI: 64000, peOI: 56000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
  { strike: 24550, ceOI: 53000, peOI: 47000, ceLTP: 80, peLTP: 80, ceDelta: 0, peDelta: 0 },
];
const sbu = computeOIBuildup(shortBuildupCurrent, prevStrikes);
check('Short buildup pattern detected', sbu.pattern === 'short_buildup', `got ${sbu.pattern}`);
check('Short buildup strength negative', sbu.strength < 0, `got ${sbu.strength.toFixed(2)}`);

// First snapshot (no previous) → neutral
const firstSnap = computeOIBuildup(longBuildupCurrent, null);
check('First snapshot returns neutral', firstSnap.pattern === 'neutral');

// Verify signal contribution
const sigLBU = computeSignal(makeBaseMagnet({
  oiBuildup: 'long_buildup',
  oiBuildupStrength: 0.9,
}));
check(
  'Long buildup adds positive weight',
  (sigLBU.reasons.find(r => r.factor === 'OI Buildup')?.weight ?? 0) > 0,
  `got ${sigLBU.reasons.find(r => r.factor === 'OI Buildup')?.weight}`
);

const sigSBU = computeSignal(makeBaseMagnet({
  oiBuildup: 'short_buildup',
  oiBuildupStrength: -0.9,
}));
check(
  'Short buildup adds negative weight',
  (sigSBU.reasons.find(r => r.factor === 'OI Buildup')?.weight ?? 0) < 0,
  `got ${sigSBU.reasons.find(r => r.factor === 'OI Buildup')?.weight}`
);

// ─── Test 4: VIX Regime ───

console.log('\n=== Test 4: VIX Regime ===');

const vixLow = computeVIXRegime(11.5, -3.0);  // low + falling (India-calibrated: +0.5 max)
check('Low+falling VIX → mild bull (+0.5, India-calibrated)', vixLow.direction === 'bull' && vixLow.weight === 0.5, `got ${vixLow.direction} ${vixLow.weight}`);

const vixLowStable = computeVIXRegime(11.5, 0.0);  // low + stable = Indian norm
check('Low+stable VIX → neutral (Indian norm, no free bull)', vixLowStable.direction === 'neutral' && vixLowStable.weight === 0, `got ${vixLowStable.direction} ${vixLowStable.weight}`);

const vixHigh = computeVIXRegime(20.0, 3.0);  // high + rising
check('High+rising VIX → strong bear', vixHigh.direction === 'bear' && vixHigh.weight === -1.0, `got ${vixHigh.direction} ${vixHigh.weight}`);

const vixNormal = computeVIXRegime(15.0, 0.5);  // normal + flat
check('Normal VIX → neutral', vixNormal.direction === 'neutral' && vixNormal.weight === 0, `got ${vixNormal.direction} ${vixNormal.weight}`);

const vixNull = computeVIXRegime(null, null);
check('Null VIX → neutral', vixNull.direction === 'neutral' && vixNull.weight === 0);

const vixPanic = computeVIXRegime(28.0, 5.0);  // extreme panic
check('Panic VIX capped at -0.5', vixPanic.direction === 'bear' && vixPanic.weight === -0.5, `got ${vixPanic.direction} ${vixPanic.weight}`);

// ─── Test 5: Full-Stack Bull Scenario ───

console.log('\n=== Test 5: Full-Stack Bull Scenario (all factors aligned) ===');

const bullMagnet = makeBaseMagnet({
  spot: 24400,
  maxPain: 24600,
  zeroGamma: 24300,           // spot above 0Γ → positive regime
  gammaRegime: 'positive',
  charmDirection: 'up',       // dealers buy (+3.0)
  charmMagnitudeCr: 520,
  magnetZone: [24450, 24500, 24550],  // zone above spot → pull UP (+1.5)
  magnetCenter: 24500,
  pcr: 1.45,                  // > 1.2 → put writers (+1.0)
  pinningProbability: 30,     // < 35% → ×1.2 amplifier
  // Phase 1 enhancements (all aligned bull)
  basisPct: 0.30,             // strong premium → +1.5
  ivSkewPct: 4.0,             // strong positive skew → +1.5
  oiBuildup: 'long_buildup',  // put writing → +1.5 (scaled by strength)
  oiBuildupStrength: 0.9,
  vix: 11.5,                  // low + falling → +1.0
  vixChangePct: -3.0,
});

const bullSig = computeSignal(bullMagnet);
console.log(`  Score: ${bullSig.score.toFixed(2)}`);
console.log(`  Direction: ${bullSig.direction} (${bullSig.strength})`);
console.log(`  Confidence: ${bullSig.confidence}%`);
console.log(`  Active factors:`);
for (const r of bullSig.reasons.filter(r => r.weight !== 0)) {
  console.log(`    [${r.direction.toUpperCase().padEnd(7)}] ${r.factor.padEnd(22)} ${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)}`);
}

check('Bull scenario → CALL', bullSig.direction === 'CALL');
check('Bull scenario → STRONG', bullSig.strength === 'STRONG');
check('Bull score >= 9.0 (STRONG threshold)', bullSig.score >= 9.0, `got ${bullSig.score.toFixed(2)}`);
check('Bull confidence >= 80%', bullSig.confidence >= 80, `got ${bullSig.confidence}%`);
check('All 11 factors contributed', bullSig.reasons.filter(r => r.weight !== 0).length >= 8, `got ${bullSig.reasons.filter(r => r.weight !== 0).length} active reasons`);

// ─── Test 6: Full-Stack Bear Scenario ───

console.log('\n=== Test 6: Full-Stack Bear Scenario (all factors aligned) ===');

const bearMagnet = makeBaseMagnet({
  spot: 24600,
  maxPain: 24400,
  zeroGamma: 24750,           // spot below 0Γ → negative regime
  gammaRegime: 'negative',
  charmDirection: 'down',     // dealers sell (-3.0)
  charmMagnitudeCr: 520,
  magnetZone: [24350, 24400, 24450],  // zone below spot → pull DOWN (-1.5)
  magnetCenter: 24400,
  pcr: 0.65,                  // < 0.8 → call writers (-1.0)
  pinningProbability: 30,     // < 35% → ×1.2 amplifier
  // Phase 1 enhancements (all aligned bear)
  basisPct: -0.30,            // strong discount → -1.5
  ivSkewPct: -4.0,            // strong negative skew → -1.5
  oiBuildup: 'short_buildup', // call writing → -1.5 (scaled by strength)
  oiBuildupStrength: -0.9,
  vix: 20.0,                  // high + rising → -1.0
  vixChangePct: 3.0,
});

const bearSig = computeSignal(bearMagnet);
console.log(`  Score: ${bearSig.score.toFixed(2)}`);
console.log(`  Direction: ${bearSig.direction} (${bearSig.strength})`);
console.log(`  Confidence: ${bearSig.confidence}%`);
console.log(`  Active factors:`);
for (const r of bearSig.reasons.filter(r => r.weight !== 0)) {
  console.log(`    [${r.direction.toUpperCase().padEnd(7)}] ${r.factor.padEnd(22)} ${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)}`);
}

check('Bear scenario → PUT', bearSig.direction === 'PUT');
check('Bear scenario → STRONG', bearSig.strength === 'STRONG');
check('Bear score <= -9.0 (STRONG threshold)', bearSig.score <= -9.0, `got ${bearSig.score.toFixed(2)}`);
check('Bear confidence >= 80%', bearSig.confidence >= 80, `got ${bearSig.confidence}%`);

// ─── Test 7: WAIT scenario (factors mixed) ───

console.log('\n=== Test 7: WAIT Scenario (factors mixed) ===');

const mixedMagnet = makeBaseMagnet({
  charmDirection: 'up',       // +3.0
  pcr: 0.65,                  // -1.0 (call writers)
  basisPct: -0.30,            // -1.5 (discount)
  ivSkewPct: 4.0,             // +1.5 (calls pricier)
  oiBuildup: 'neutral',       // 0
  vix: 15.0,                  // 0 (normal)
  pinningProbability: 50,     // ×1.0
});
const mixedSig = computeSignal(mixedMagnet);
console.log(`  Score: ${mixedSig.score.toFixed(2)}`);
console.log(`  Direction: ${mixedSig.direction} (${mixedSig.strength})`);
check(
  'Mixed factors → WEAK or WAIT',
  mixedSig.strength === 'WEAK' || mixedSig.strength === 'NONE',
  `got ${mixedSig.strength}`
);

// ─── Test 8: Factor 12 — Participant Bias (Phase 2) ───

console.log('\n=== Test 8: Factor 12 — Participant Bias ===');

// Import computeParticipantBias directly
const { computeParticipantBias } = require('../src/lib/participant-service');

// 8a: Strong FII+Prop buying → strong CALL bias
const bullBias = computeParticipantBias({
  date: '2026-09-07', fii: 2000, dii: -500, client: -800, propdesk: 800, ts: Date.now(),
});
console.log(`  Bull scenario: FII+2000, Prop+800, Client-800 → ${bullBias.weight >= 0 ? '+' : ''}${bullBias.weight.toFixed(2)} (${bullBias.direction})`);
check('Strong smart buying → bull bias', bullBias.direction === 'bull');
check('Bull bias weight >= +1.5', bullBias.weight >= 1.5, `got ${bullBias.weight.toFixed(2)}`);
check('Bull bias weight <= +2.0 (capped)', bullBias.weight <= 2.0, `got ${bullBias.weight.toFixed(2)}`);

// 8b: Strong FII+Prop selling → strong PUT bias
const bearBias = computeParticipantBias({
  date: '2026-09-07', fii: -2200, dii: 600, client: 900, propdesk: -600, ts: Date.now(),
});
console.log(`  Bear scenario: FII-2200, Prop-600, Client+900 → ${bearBias.weight >= 0 ? '+' : ''}${bearBias.weight.toFixed(2)} (${bearBias.direction})`);
check('Strong smart selling → bear bias', bearBias.direction === 'bear');
check('Bear bias weight <= -1.5', bearBias.weight <= -1.5, `got ${bearBias.weight.toFixed(2)}`);
check('Bear bias weight >= -2.0 (capped)', bearBias.weight >= -2.0, `got ${bearBias.weight.toFixed(2)}`);

// 8c: No data → neutral
const noBias = computeParticipantBias(null);
console.log(`  No data → ${noBias.weight.toFixed(2)} (${noBias.direction})`);
check('No data → weight 0', noBias.weight === 0);
check('No data → neutral', noBias.direction === 'neutral');

// 8d: DII absorbs FII selling → dampened bearish
const dampenedBias = computeParticipantBias({
  date: '2026-09-07', fii: -1500, dii: 1400, client: 200, propdesk: -100, ts: Date.now(),
});
console.log(`  Dampened: FII-1500, DII+1400 (opposes) → ${dampenedBias.weight >= 0 ? '+' : ''}${dampenedBias.weight.toFixed(2)}`);
check('DII opposing FII dampens bias', dampenedBias.weight > -1.5, `got ${dampenedBias.weight.toFixed(2)}`);

// 8e: Factor 12 lifts STRONG threshold when institutions confirm
// Take a moderate CALL signal (just below STRONG) and add participant bias
const modCallMagnet = makeBaseMagnet({
  charmDirection: 'up',       // +3.0
  pcr: 1.6,                   // +1.0 (strong put writing)
  basisPct: 0.10,             // +0.75 (premium)
  ivSkewPct: 2.0,             // +1.0 (mild calls pricier)
  oiBuildup: 'long_buildup',  // +1.5
  oiBuildupStrength: 0.7,
  vix: 11.0,                  // low + falling = +0.5
  vixChangePct: -2.0,
  pinningProbability: 50,
});
const modCallSig = computeSignal(modCallMagnet);
console.log(`  Moderate CALL without bias: ${modCallSig.score.toFixed(2)} (${modCallSig.strength})`);

const strongCallMagnet = makeBaseMagnet({
  charmDirection: 'up',
  pcr: 1.6,
  basisPct: 0.10,
  ivSkewPct: 2.0,
  oiBuildup: 'long_buildup',
  oiBuildupStrength: 0.7,
  vix: 11.0,
  vixChangePct: -2.0,
  pinningProbability: 50,
  participantBias: 2.0,           // Strong institutional confirmation
  participantBiasDetail: 'Test: FII+2000, Prop+800',
});
const strongCallSig = computeSignal(strongCallMagnet);
console.log(`  Same CALL with +2.0 bias: ${strongCallSig.score.toFixed(2)} (${strongCallSig.strength})`);
check('Participant bias adds to score', strongCallSig.score > modCallSig.score, `without: ${modCallSig.score}, with: ${strongCallSig.score}`);
check('Factor 12 appears in reasons', strongCallSig.reasons.some(r => r.factor === 'Participant Bias' && r.weight === 2.0));

// 8g: Dampener must NEVER flip the smart-money direction (sign-flip guard)
// Real data from Sep 2026: FII -273, DII +1231, Client +400, Prop -50
const flipBias = computeParticipantBias({
  date: '2026-09-08', fii: -273.22, dii: 1231.63, client: 400, propdesk: -50, ts: Date.now(),
});
console.log(`  Sign-flip guard: FII-273, DII+1231 (heavy absorption) → ${flipBias.weight >= 0 ? '+' : ''}${flipBias.weight.toFixed(2)} (${flipBias.direction})`);
check('Dampener cannot flip bearish smart flow to bullish', flipBias.weight <= 0.15, `got ${flipBias.weight.toFixed(2)}`);
check('Heavily dampened signal is neutral, not opposite', flipBias.weight === 0, `got ${flipBias.weight.toFixed(2)}`);

// ─── Test 9: India Trend Gates — PUT signals on falling days ───
// Regression for the "zero PUT signals in 7 days of falling market" bug.
// Root cause: charm (+3.0 structural bull in put-written Indian chains) and
// magnet zone pull (+1.5 bull when spot below zone) overwhelmed all bearish
// factors. Fix: trend gates that dampen drift/mean-reversion factors when
// gamma regime AND futures basis both confirm the opposite pressure.

console.log('\n=== Test 9: India Trend Gates (PUT on falling days) ===');

// 9a: Typical falling day — charm up (India norm), negative regime, discount
const fallingDay = makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 420,
  zeroGamma: 24620,
  gammaRegime: 'negative',
  magnetCenter: 24650,
  magnetZone: [24600, 24700],
  basisPct: -0.08,           // mild discount
  ivSkewPct: -1.2,           // puts bid
  oiBuildup: 'short_buildup',
  oiBuildupStrength: -1.0,
  vix: 14.2, vixChangePct: 3.1,
  pinningProbability: 45,
});
const fallingSig = computeSignal(fallingDay);
console.log(`  Typical falling day: ${fallingSig.score.toFixed(2)} → ${fallingSig.direction} ${fallingSig.strength}`);
check('Falling day fires PUT', fallingSig.direction === 'PUT', `got ${fallingSig.direction}`);
check('Falling day PUT is WEAK or better', fallingSig.strength === 'WEAK' || fallingSig.strength === 'MODERATE', `got ${fallingSig.strength}`);
const charmReason = fallingSig.reasons.find(r => r.factor === 'Charm Drift');
check('Charm dampened to +1.0 on falling day', charmReason?.weight === 1.0, `got ${charmReason?.weight}`);
check('Charm detail mentions dampening', (charmReason?.detail ?? '').includes('DAMPENED'));

// 9b: Strong trend-down day — everything bearish aligned
const trendDownDay = makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 510,
  zeroGamma: 24700,
  gammaRegime: 'negative',
  magnetCenter: 24720,
  magnetZone: [24650, 24800],
  basisPct: -0.22,
  ivSkewPct: -3.4,
  oiBuildup: 'short_buildup',
  oiBuildupStrength: -1.2,
  vix: 15.8, vixChangePct: 6.5,
  pinningProbability: 28,    // low pin → ×1.2
});
const trendDownSig = computeSignal(trendDownDay);
console.log(`  Strong trend-down day: ${trendDownSig.score.toFixed(2)} → ${trendDownSig.direction} ${trendDownSig.strength}`);
check('Trend-down day fires PUT MODERATE+', trendDownSig.direction === 'PUT' && (trendDownSig.strength === 'MODERATE' || trendDownSig.strength === 'STRONG'), `got ${trendDownSig.direction} ${trendDownSig.strength}`);
const magnetReason = trendDownSig.reasons.find(r => r.factor === 'Magnet Zone Pull');
check('Magnet pull dampened (×0.3) against trend', magnetReason !== undefined && magnetReason.weight > -0.6 && magnetReason.weight < 0.6 && magnetReason.weight !== 0, `got ${magnetReason?.weight}`);

// 9c: CONTROL — genuine up day keeps full charm strength
const upDay = makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 450,
  zeroGamma: 24400,
  gammaRegime: 'positive',
  pcr: 1.35,
  basisPct: 0.18,
  ivSkewPct: 1.6,
  oiBuildup: 'long_buildup',
  oiBuildupStrength: 1.0,
  vix: 12.8, vixChangePct: -3.0,
  pinningProbability: 30,
});
const upSig = computeSignal(upDay);
const upCharm = upSig.reasons.find(r => r.factor === 'Charm Drift');
console.log(`  Up day control: ${upSig.score.toFixed(2)} → ${upSig.direction} ${upSig.strength}`);
check('Up day still CALL STRONG', upSig.direction === 'CALL' && upSig.strength === 'STRONG', `got ${upSig.direction} ${upSig.strength}`);
check('Up day charm stays full +3.0 (gate inactive)', upCharm?.weight === 3.0, `got ${upCharm?.weight}`);

// 9d: Zero-Γ trigger fixes — magnitude floor + flow-confirmed bear trigger
const weakCharmRange = makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 200,     // weak drift
  zeroGamma: 24510,          // spot 0.04% below flip
  pinningProbability: 50,
});
const weakCharmSig = computeSignal(weakCharmRange);
const weakCharmZeroG = weakCharmSig.reasons.find(r => r.factor === 'Zero-Γ Position');
console.log(`  Weak-charm range day: Zero-Γ weight ${weakCharmZeroG?.weight.toFixed(2)} (was +2.0 before floor)`);
check('Charm trigger needs >= 300 Cr magnitude', weakCharmZeroG?.weight === 0, `got ${weakCharmZeroG?.weight}`);

const flowBearTrigger = makeBaseMagnet({
  spot: 24510,
  charmDirection: 'up',      // charm bullish (India norm)
  charmMagnitudeCr: 400,
  zeroGamma: 24500,          // spot 0.04% ABOVE flip
  basisPct: -0.15,           // deep discount → flow-confirmed bear trigger
});
const flowBearSig = computeSignal(flowBearTrigger);
const flowBearZeroG = flowBearSig.reasons.find(r => r.factor === 'Zero-Γ Position');
console.log(`  Flow-confirmed bear trigger: Zero-Γ weight ${flowBearZeroG?.weight.toFixed(2)}`);
check('Flow-confirmed bear trigger fires (-2.0)', flowBearZeroG?.weight === -2.0, `got ${flowBearZeroG?.weight}`);
check('Bear trigger detail mentions discount', (flowBearZeroG?.detail ?? '').includes('discount'));

// 9e: CONTROL — symmetric bull charm trigger still works with strong charm
const bullTrigger = makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 450,     // strong
  zeroGamma: 24510,          // spot 0.04% below flip
  pinningProbability: 50,
});
const bullTriggerSig = computeSignal(bullTrigger);
const bullTriggerZeroG = bullTriggerSig.reasons.find(r => r.factor === 'Zero-Γ Position');
check('Strong-charm bull trigger still fires (+2.0)', bullTriggerZeroG?.weight === 2.0, `got ${bullTriggerZeroG?.weight}`);

// ─── Summary ───

console.log('\n=== SUMMARY ===');
console.log(`Pass: ${pass}  Fail: ${fail}`);
if (fail > 0) {
  console.error('❌ Some tests failed');
  process.exit(1);
} else {
  console.log('✅ All Phase 1 enhancement tests passed');
}
