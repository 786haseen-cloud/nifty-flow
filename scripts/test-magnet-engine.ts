/**
 * Quick sanity test for the magnet engine.
 * Simulates a Nifty-like option chain and verifies the outputs.
 */
import {
  computeMagnet,
  bsGamma,
  bsCallDelta,
  approxIV,
  computeMaxPain,
  type StrikeOption,
} from '../src/lib/magnet-engine';

console.log('=== Magnet Engine Sanity Test ===\n');

// 1. Test Black-Scholes gamma at the money
const gamma = bsGamma(24500, 24500, 7 / 365, 0.13);
console.log(`BS Gamma ATM (Nifty 24500, T=7d, σ=13%): ${gamma.toExponential(4)}`);
// Expected: roughly 0.006-0.008 for these inputs

// 2. Test call delta
const delta = bsCallDelta(24500, 24500, 7 / 365, 0.13);
console.log(`BS Call Delta ATM: ${delta.toFixed(4)}`);
// Expected: ~0.53

// 3. Test IV approximation
const iv = approxIV(80, 24500, 7 / 365);
console.log(`Approx IV (price=80, spot=24500, T=7d): ${(iv * 100).toFixed(2)}%`);
// Expected: ~12-15%

// 4. Build a synthetic Nifty-like option chain
const spot = 24500;
const strikeStep = 50;
const strikes: StrikeOption[] = [];
for (let i = -5; i <= 5; i++) {
  const k = spot + i * strikeStep;
  // Synthetic OI: ATM-heavy, decaying away from ATM
  const atmFactor = Math.exp(-Math.pow(i / 2.5, 2));
  // PCR ~ 0.9 (slightly more PE OI than CE OI)
  const ceOI = Math.round(50000 * atmFactor * (0.8 + Math.random() * 0.4));
  const peOI = Math.round(55000 * atmFactor * (0.8 + Math.random() * 0.4));
  // LTP approximations
  const ceLTP = Math.max(5, spot - k + 80);  // intrinsic + time value
  const peLTP = Math.max(5, k - spot + 80);
  strikes.push({
    strike: k,
    ceOI,
    peOI,
    ceLTP,
    peLTP,
    ceDelta: 0,
    peDelta: 0,
  });
}

console.log(`\nBuilt synthetic chain: ${strikes.length} strikes`);
console.log(`Strikes: ${strikes.map(s => s.strike).join(', ')}`);
console.log(`Total CE OI: ${strikes.reduce((s, k) => s + k.ceOI, 0).toLocaleString()}`);
console.log(`Total PE OI: ${strikes.reduce((s, k) => s + k.peOI, 0).toLocaleString()}`);

// 5. Max pain
const mp = computeMaxPain(strikes);
console.log(`\nMax Pain: ${mp}`);
console.log(`Spot: ${spot}`);
console.log(`Dist from MP: ${spot - mp} (${(((spot - mp) / spot) * 100).toFixed(2)}%)`);

// 6. Full magnet computation
const result = computeMagnet(
  'NIFTY',
  strikes,
  spot,
  75, // lot size
  strikeStep,
  7,  // days to expiry
  { name: 'Nifty 50', type: 'index', spotTime: '14:30:00' }
);

if (result) {
  console.log('\n=== Magnet Result ===');
  console.log(`Symbol: ${result.symbol} (${result.name})`);
  console.log(`Gamma Regime: ${result.gammaRegime}`);
  console.log(`Zero Gamma Flip: ${result.zeroGamma?.toFixed(0) ?? 'null'}`);
  console.log(`Total GEX: ${result.totalGexCr.toFixed(2)} Cr/1%`);
  console.log(`Magnet Zone: [${result.magnetZone.join(', ')}]`);
  console.log(`Magnet Center: ${result.magnetCenter.toFixed(0)}`);
  console.log(`Magnet Score: ${result.magnetScore}/100`);
  console.log(`Pinning Probability: ${result.pinningProbability}%`);
  console.log(`Charm Direction: ${result.charmDirection} (${result.charmMagnitudeCr.toFixed(2)} Cr/d)`);
  console.log(`PCR: ${result.pcr.toFixed(3)}`);
  console.log(`DTE: ${result.daysToExpiry} days`);
  console.log('\nPer-strike GEX:');
  for (const g of result.gexStrikes) {
    const inZone = result.magnetZone.includes(g.strike) ? ' ★' : '';
    const isZero = result.zeroGamma !== null && Math.abs(g.strike - result.zeroGamma) < 1 ? ' ◇' : '';
    console.log(`  K=${g.strike}: ${g.gexCr >= 0 ? '+' : ''}${g.gexCr.toFixed(2)} Cr/1%${inZone}${isZero}`);
  }
} else {
  console.log('ERROR: computeMagnet returned null');
}

console.log('\n=== Test Complete ===');
