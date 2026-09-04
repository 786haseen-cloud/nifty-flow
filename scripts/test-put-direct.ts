/**
 * Direct test of computeSignal() — bypass the magnet math and verify
 * that the SIGNAL ENGINE itself produces PUT signals when the factors
 * line up bearish. The previous test kept getting charm='up' from the
 * chain constructor, which always overpowered the bearish factors.
 *
 * This test crafts a synthetic MagnetResult with charm=down, spot below
 * zero-Γ (negative regime), spot above magnet zone (pull DOWN), PCR<0.8,
 * negative gamma → should produce PUT STRONG.
 */
import { computeSignal, type MagnetResult } from '../src/lib/magnet-engine';

const bearishMagnet: MagnetResult = {
  symbol: 'NIFTY',
  name: 'Nifty 50',
  type: 'index',
  spot: 24600,
  strikeStep: 50,
  lotSize: 75,
  daysToExpiry: 3,
  spotTime: '14:30:00',

  maxPain: 24400,              // spot is 200pts ABOVE max pain → bearish pull
  zeroGamma: 24750,            // spot is BELOW zero-Γ → negative regime
  charmDirection: 'down',      // dealers MUST SELL over time (bearish)
  charmMagnitudeCr: 520.0,
  gexStrikes: [
    { strike: 24650, gexCr: -2.5 },  // red wall above spot → breakouts up run
    { strike: 24700, gexCr: -1.8 },  // red wall above
    { strike: 24550, gexCr: -1.2 },  // red below spot → breaks down run
    { strike: 24500, gexCr: -0.8 },  // red below
  ],
  magnetZone: [24350, 24400, 24450],  // zone well below spot → pull DOWN
  magnetCenter: 24400,
  magnetScore: 68,
  pcr: 0.65,                   // < 0.8 → call writers dominant (bearish)
  gammaRegime: 'negative',     // breaks amplify
  pinningProbability: 32,      // < 35 → low pin → amplifies trend (×1.2)
  signal: null as any,
};

console.log('=== Direct PUT Signal Test ===\n');
console.log(`Setup: spot=${bearishMagnet.spot} maxPain=${bearishMagnet.maxPain} zeroΓ=${bearishMagnet.zeroGamma}`);
console.log(`       charm=${bearishMagnet.charmDirection} PCR=${bearishMagnet.pcr} regime=${bearishMagnet.gammaRegime}`);
console.log(`       magnetZone=[${bearishMagnet.magnetZone.join(',')}] pinning=${bearishMagnet.pinningProbability}%\n`);

const sig = computeSignal(bearishMagnet);
console.log(`SIGNAL: ${sig.direction} (${sig.strength})`);
console.log(`Score: ${sig.score.toFixed(2)}  (negative = bearish)`);
console.log(`Confidence: ${sig.confidence}%`);
console.log(`Strike: ${sig.suggestedStrike}  Target: ${sig.suggestedTarget}  Stop: ${sig.suggestedStop}`);
console.log(`Timing: ${sig.timing}`);
console.log(`\nReasons:`);
for (const r of sig.reasons) {
  console.log(`  [${r.direction.toUpperCase().padEnd(7)}] ${r.factor.padEnd(22)} ${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)}  | ${r.detail}`);
}

console.log('\n--- Now mirror it: bullish setup ---');
const bullishMagnet: MagnetResult = {
  ...bearishMagnet,
  spot: 24400,
  maxPain: 24600,
  zeroGamma: 24300,           // spot above 0Γ → positive regime
  charmDirection: 'up',
  magnetZone: [24450, 24500, 24550],
  magnetCenter: 24500,
  pcr: 1.45,                  // > 1.2 → put writers dominant (bullish)
  gammaRegime: 'positive',
  pinningProbability: 32,
};
const sig2 = computeSignal(bullishMagnet);
console.log(`SIGNAL: ${sig2.direction} (${sig2.strength})`);
console.log(`Score: ${sig2.score.toFixed(2)}  Confidence: ${sig2.confidence}%`);
console.log(`\nReasons:`);
for (const r of sig2.reasons) {
  console.log(`  [${r.direction.toUpperCase().padEnd(7)}] ${r.factor.padEnd(22)} ${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)}  | ${r.detail}`);
}

console.log('\n=== Test Complete ===');
