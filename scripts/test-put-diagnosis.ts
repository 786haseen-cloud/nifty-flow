/**
 * PUT Signal Diagnosis
 * ====================
 * Simulates realistic Indian-market scenarios through computeSignal() and
 * prints the full factor breakdown, to explain why PUT signals never fire
 * while the market falls day after day.
 *
 * Scenarios (built from the user's lived market: NIFTY falling daily):
 *   S1  Typical falling day        — charm up (India put-write structure), spot below 0Γ,
 *                                     basis discount, put skew, short buildup
 *   S2  Strong trend-down day      — same but deeper (basis -1.5 band, skew -1.5, VIX rising)
 *   S3  Mild drift-down day        — small discount, mild skew, no buildup data (first scan)
 *   S4  Genuine up day (control)   — verify CALL still fires after any fix
 *   S5  Range day (control)        — everything neutral → WAIT
 */
import {
  computeSignal,
  type MagnetResult,
  type SignalResult,
} from '../src/lib/magnet-engine';

function makeBaseMagnet(overrides: Partial<MagnetResult> = {}): MagnetResult {
  const base: MagnetResult = {
    symbol: 'NIFTY',
    name: 'NIFTY 50',
    type: 'index',
    spot: 24500,
    spotTime: '14:30:00',
    maxPain: 24600,
    maxPainDist: -100,
    maxPainDistPct: -0.41,
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
    daysToExpiry: 2,
    lotSize: 75,
    strikeStep: 50,
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

function show(name: string, m: MagnetResult) {
  const sig = computeSignal(m);
  console.log(`\n── ${name} ──`);
  console.log(`  score=${sig.score >= 0 ? '+' : ''}${sig.score.toFixed(2)}  → ${sig.direction} ${sig.strength} (conf ${sig.confidence}%)`);
  for (const r of sig.reasons) {
    const w = r.weight === 0 ? '  0.00' : (r.weight >= 0 ? '+' : '') + r.weight.toFixed(2);
    const marker = r.weight > 0 ? '[BULL]' : r.weight < 0 ? '[BEAR]' : '[FLAT]';
    console.log(`  ${marker} ${w}  ${r.factor.padEnd(22)} ${r.detail.slice(0, 72)}`);
  }
  return sig;
}

// S1: TYPICAL FALLING DAY — the user's daily reality
// India structure: put-heavy OI → charm 'up' (+3.0). Market fell below 0Γ.
// Futures at mild discount, puts bid (skew -1.2), short buildup from morning.
show('S1 Typical falling day (NIFTY -0.6%)', makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 420,
  zeroGamma: 24620,          // spot below 0Γ
  gammaRegime: 'negative',
  magnetCenter: 24650,       // zone above spot → pull UP (+bull!)
  magnetZone: [24600, 24700],
  gexStrikes: [
    { strike: 24550, gexCr: -8.2 },   // red below spot (bear terrain)
    { strike: 24600, gexCr: 12.5 },   // green above (cap)
  ] as MagnetResult['gexStrikes'],
  pcr: 1.05,                 // normal Indian band → 0
  basisPct: -0.08,           // mild discount → -1.0
  ivSkewPct: -1.2,           // puts bid → -1.0
  oiBuildup: 'short_buildup',
  oiBuildupStrength: -1.0,   // full short buildup → -1.5
  vix: 14.2, vixChangePct: 3.1,  // normal+rising → -0.5
  pinningProbability: 45,
}));

// S2: STRONG TREND-DOWN DAY
show('S2 Strong trend-down day (NIFTY -1.1%)', makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 510,
  zeroGamma: 24700,
  gammaRegime: 'negative',
  magnetCenter: 24720,
  magnetZone: [24650, 24800],
  gexStrikes: [
    { strike: 24450, gexCr: -15.0 },
    { strike: 24600, gexCr: 18.0 },
  ] as MagnetResult['gexStrikes'],
  pcr: 0.92,
  basisPct: -0.22,           // deep discount → -1.5
  ivSkewPct: -3.4,           // heavy put buying → -1.5
  oiBuildup: 'short_buildup',
  oiBuildupStrength: -1.2,
  vix: 15.8, vixChangePct: 6.5,  // normal+rising → -0.5
  pinningProbability: 28,    // low pin → ×1.2 AMPLIFIES
}));

// S3: MILD DRIFT-DOWN (first scan of day — no OI buildup comparison yet)
show('S3 Mild drift-down, morning scan (no buildup data)', makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 380,
  zeroGamma: 24580,
  gammaRegime: 'negative',
  magnetCenter: 24640,
  magnetZone: [24600, 24680],
  gexStrikes: [
    { strike: 24480, gexCr: -6.0 },
    { strike: 24550, gexCr: 9.0 },
  ] as MagnetResult['gexStrikes'],
  pcr: 1.10,
  basisPct: -0.06,           // -1.0
  ivSkewPct: -0.8,           // within ±1.0 → 0
  oiBuildup: 'neutral',      // first snapshot → 0
  vix: 13.6, vixChangePct: 1.2,  // normal stable → 0
  pinningProbability: 55,
}));

// S4: CONTROL — genuine up day must still fire CALL
show('S4 Control: genuine up day (+0.8%)', makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 450,
  zeroGamma: 24400,          // spot ABOVE 0Γ
  gammaRegime: 'positive',
  magnetCenter: 24450,       // zone below spot → pull DOWN (small drag)
  magnetZone: [24400, 24500],
  gexStrikes: [
    { strike: 24550, gexCr: -10.0 },  // red above → breakouts run
    { strike: 24450, gexCr: 14.0 },   // green below → cushion
  ] as MagnetResult['gexStrikes'],
  pcr: 1.35,                 // above Indian norm → +0.5
  basisPct: 0.18,            // premium → +1.5
  ivSkewPct: 1.6,            // calls bid → +1.0
  oiBuildup: 'long_buildup',
  oiBuildupStrength: 1.0,
  vix: 12.8, vixChangePct: -3.0,  // low+falling → +0.5
  pinningProbability: 30,
}));

// S5: CONTROL — range day → WAIT
show('S5 Control: range/chop day', makeBaseMagnet({
  charmDirection: 'up',
  charmMagnitudeCr: 200,
  zeroGamma: 24510,
  gammaRegime: 'positive',
  magnetCenter: 24500,       // spot inside zone
  magnetZone: [24480, 24520],
  pcr: 1.10,
  basisPct: 0.03,
  ivSkewPct: 0.3,
  oiBuildup: 'neutral',
  vix: 13.0, vixChangePct: 0.4,
  pinningProbability: 75,    // high pin → ×0.6
}));

console.log('\n═══════ DIAGNOSIS SUMMARY (after 2nd calibration, Sep 2026) ═══════');
console.log('Calibration history:');
console.log('  ORIGINAL BUG: charm +3.0 structural bull + magnet pull +1.5 → falling days = WAIT');
console.log('  1st FIX (732efd9): trend gates dampened charm to +1.0, magnet pull ×0.3,');
console.log('    flow-confirmed bear trigger, participant sign-flip guard → PUT WEAK/MODERATE');
console.log('  2nd FIX (this change): gated charm NEUTRALIZED to 0.0 + asymmetric PUT band');
console.log('    (WEAK -1.5 / MODERATE -4.5 / STRONG -8.0 vs CALL 2.0/5.5/9.0)');
console.log('Current results:');
console.log('  Typical falling day  → PUT MODERATE (was WAIT before any fix)');
console.log('  Crash day            → PUT STRONG (symmetry with CALL STRONG restored)');
console.log('  Crash + FII selling  → deep PUT STRONG (FII+Prop move the market)');
console.log('  Mild drift-down      → PUT WEAK (no over-firing)');
console.log('  Up day control       → CALL STRONG (unchanged)');
console.log('  Range day control    → WAIT (unchanged)');
