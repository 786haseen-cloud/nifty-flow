/**
 * Quick sanity test for the magnet + signal engine.
 * Simulates 3 scenarios: bullish, bearish, and mixed/no-signal.
 */
import {
  computeMagnet,
  computeAggregateSignal,
  type StrikeOption,
} from '../src/lib/magnet-engine';

function buildChain(spot: number, strikeStep: number, lotSize: number, pcrBias: number): StrikeOption[] {
  const strikes: StrikeOption[] = [];
  for (let i = -5; i <= 5; i++) {
    const k = spot + i * strikeStep;
    const atmFactor = Math.exp(-Math.pow(i / 2.5, 2));
    const ceOI = Math.round(50000 * atmFactor * (0.8 + Math.random() * 0.4));
    const peOI = Math.round(50000 * atmFactor * (0.8 + Math.random() * 0.4) * pcrBias);
    const ceLTP = Math.max(5, spot - k + 80);
    const peLTP = Math.max(5, k - spot + 80);
    strikes.push({ strike: k, ceOI, peOI, ceLTP, peLTP, ceDelta: 0, peDelta: 0 });
  }
  return strikes;
}

console.log('=== Magnet + Signal Engine Test ===\n');

// Test 1: Bullish setup — spot below magnet zone, PCR > 1.2
console.log('--- Scenario 1: Bullish (PCR > 1.2) ---');
const bullStrikes = buildChain(24450, 50, 75, 1.4); // PCR ~1.4 (heavy put OI)
const bullResult = computeMagnet('NIFTY', bullStrikes, 24450, 75, 50, 3, { name: 'Nifty 50', type: 'index', spotTime: '14:30:00' });
if (bullResult) {
  console.log(`Spot: ${bullResult.spot}, MaxPain: ${bullResult.maxPain}`);
  console.log(`Zero-Γ: ${bullResult.zeroGamma?.toFixed(0)}`);
  console.log(`Charm: ${bullResult.charmDirection} (${bullResult.charmMagnitudeCr.toFixed(2)} Cr/d)`);
  console.log(`PCR: ${bullResult.pcr.toFixed(2)}`);
  console.log(`Magnet Zone: [${bullResult.magnetZone.join(', ')}]`);
  console.log(`Pinning: ${bullResult.pinningProbability}%`);
  console.log(`\nSIGNAL: ${bullResult.signal.direction} (${bullResult.signal.strength})`);
  console.log(`Score: ${bullResult.signal.score.toFixed(2)}`);
  console.log(`Confidence: ${bullResult.signal.confidence}%`);
  console.log(`Strike: ${bullResult.signal.suggestedStrike}  Target: ${bullResult.signal.suggestedTarget}  Stop: ${bullResult.signal.suggestedStop}`);
  console.log(`Timing: ${bullResult.signal.timing}`);
  console.log(`\nReasons:`);
  for (const r of bullResult.signal.reasons.slice(0, 5)) {
    console.log(`  [${r.direction.toUpperCase()}] ${r.factor}: ${r.detail} (${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)})`);
  }
}

console.log('\n--- Scenario 2: Bearish (PCR < 0.8) ---');
const bearStrikes = buildChain(24550, 50, 75, 0.6); // PCR ~0.6 (heavy call OI)
const bearResult = computeMagnet('NIFTY', bearStrikes, 24550, 75, 50, 3, { name: 'Nifty 50', type: 'index', spotTime: '14:30:00' });
if (bearResult) {
  console.log(`Spot: ${bearResult.spot}, MaxPain: ${bearResult.maxPain}`);
  console.log(`Zero-Γ: ${bearResult.zeroGamma?.toFixed(0)}`);
  console.log(`Charm: ${bearResult.charmDirection}`);
  console.log(`PCR: ${bearResult.pcr.toFixed(2)}`);
  console.log(`\nSIGNAL: ${bearResult.signal.direction} (${bearResult.signal.strength})`);
  console.log(`Score: ${bearResult.signal.score.toFixed(2)}`);
  console.log(`Confidence: ${bearResult.signal.confidence}%`);
  console.log(`Strike: ${bearResult.signal.suggestedStrike}  Target: ${bearResult.signal.suggestedTarget}  Stop: ${bearResult.signal.suggestedStop}`);
}

console.log('\n--- Scenario 3: Aggregate (4 indices, mixed signals) ---');
const idx1 = computeMagnet('NIFTY', buildChain(24450, 50, 75, 1.4), 24450, 75, 50, 3, { name: 'Nifty 50', type: 'index', spotTime: '14:30:00' });
const idx2 = computeMagnet('BANKNIFTY', buildChain(51200, 100, 30, 1.3), 51200, 30, 100, 3, { name: 'Bank Nifty', type: 'index', spotTime: '14:30:00' });
const idx3 = computeMagnet('FINNIFTY', buildChain(23100, 50, 50, 0.7), 23100, 50, 50, 3, { name: 'Fin Nifty', type: 'index', spotTime: '14:30:00' });
const idx4 = computeMagnet('SENSEX', buildChain(80450, 100, 10, 1.1), 80450, 10, 100, 3, { name: 'Sensex', type: 'index', spotTime: '14:30:00' });

if (idx1 && idx2 && idx3 && idx4) {
  const agg = computeAggregateSignal([idx1, idx2, idx3, idx4]);
  console.log(`Direction: ${agg.direction} (${agg.strength})`);
  console.log(`Score: ${agg.score} (weight: indices 3× = max ±30)`);
  console.log(`Confidence: ${agg.confidence}%`);
  console.log(`Distribution: ${agg.bullCount} bull / ${agg.bearCount} bear / ${agg.waitCount} wait`);
  console.log(`Top bull: ${agg.topBull?.symbol} (${agg.topBull?.score.toFixed(1)}, ${agg.topBull?.strength})`);
  console.log(`Top bear: ${agg.topBear?.symbol} (${agg.topBear?.score.toFixed(1)}, ${agg.topBear?.strength})`);
  console.log(`Notes: ${agg.notes}`);
}

console.log('\n=== Test Complete ===');
