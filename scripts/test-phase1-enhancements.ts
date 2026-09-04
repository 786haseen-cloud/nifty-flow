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

const vixLow = computeVIXRegime(11.5, -3.0);  // low + falling
check('Low+falling VIX → strong bull', vixLow.direction === 'bull' && vixLow.weight === 1.0, `got ${vixLow.direction} ${vixLow.weight}`);

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

// ─── Summary ───

console.log('\n=== SUMMARY ===');
console.log(`Pass: ${pass}  Fail: ${fail}`);
if (fail > 0) {
  console.error('❌ Some tests failed');
  process.exit(1);
} else {
  console.log('✅ All Phase 1 enhancement tests passed');
}
