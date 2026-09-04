/**
 * Standalone test: verify the signal engine produces PUT signals
 * when the setup is genuinely bearish (charm down, spot below 0Γ, PCR<0.8,
 * spot above magnet zone, red GEX below).
 */
import {
  computeMagnet,
  computeAggregateSignal,
  type StrikeOption,
} from '../src/lib/magnet-engine';

function buildBearishChain(spot: number, strikeStep: number, lotSize: number): StrikeOption[] {
  // Heavy CALL OI above spot (PCR < 0.6), light put OI → bearish
  const strikes: StrikeOption[] = [];
  for (let i = -5; i <= 5; i++) {
    const k = spot + i * strikeStep;
    // Heavy call OI concentrated ABOVE spot (resistance)
    const ceOI = i >= 0 ? Math.round(80000 * Math.exp(-Math.pow(i / 2, 2))) : Math.round(20000);
    // Light put OI below (no support)
    const peOI = i <= 0 ? Math.round(15000 * Math.exp(-Math.pow(i / 2, 2))) : Math.round(5000);
    const ceLTP = Math.max(5, spot - k + 80);
    const peLTP = Math.max(5, k - spot + 80);
    strikes.push({ strike: k, ceOI, peOI, ceLTP, peLTP, ceDelta: 0, peDelta: 0 });
  }
  return strikes;
}

console.log('=== PUT Signal Test ===\n');

// Strong bearish setup
const spot = 24500;
const bearStrikes = buildBearishChain(spot, 50, 75);
const bearResult = computeMagnet('NIFTY', bearStrikes, spot, 75, 50, 3, {
  name: 'Nifty 50',
  type: 'index',
  spotTime: '14:30:00',
});

if (bearResult) {
  console.log(`Spot: ${bearResult.spot}, MaxPain: ${bearResult.maxPain}`);
  console.log(`Zero-Γ: ${bearResult.zeroGamma?.toFixed(0)}`);
  console.log(`Charm: ${bearResult.charmDirection} (${bearResult.charmMagnitudeCr.toFixed(2)} Cr/d)`);
  console.log(`PCR: ${bearResult.pcr.toFixed(2)}`);
  console.log(`Magnet Zone: [${bearResult.magnetZone.join(', ')}]`);
  console.log(`Magnet Center: ${Math.round(bearResult.magnetCenter)}`);
  console.log(`Pinning: ${bearResult.pinningProbability}%`);

  console.log(`\nSIGNAL: ${bearResult.signal.direction} (${bearResult.signal.strength})`);
  console.log(`Score: ${bearResult.signal.score.toFixed(2)}`);
  console.log(`Confidence: ${bearResult.signal.confidence}%`);
  console.log(`Strike: ${bearResult.signal.suggestedStrike}  Target: ${bearResult.signal.suggestedTarget}  Stop: ${bearResult.signal.suggestedStop}`);
  console.log(`Timing: ${bearResult.signal.timing}`);
  console.log(`\nReasons:`);
  for (const r of bearResult.signal.reasons) {
    console.log(`  [${r.direction.toUpperCase()}] ${r.factor}: ${r.detail} (${r.weight >= 0 ? '+' : ''}${r.weight.toFixed(2)})`);
  }
}

// Aggregate test: 4 bearish indices
console.log('\n--- Aggregate: 4 bearish indices ---');
const idx1 = computeMagnet('NIFTY', buildBearishChain(24500, 50, 75), 24500, 75, 50, 3, { name: 'Nifty 50', type: 'index', spotTime: '14:30:00' });
const idx2 = computeMagnet('BANKNIFTY', buildBearishChain(51200, 100, 30), 51200, 30, 100, 3, { name: 'Bank Nifty', type: 'index', spotTime: '14:30:00' });
const idx3 = computeMagnet('FINNIFTY', buildBearishChain(23100, 50, 50), 23100, 50, 50, 3, { name: 'Fin Nifty', type: 'index', spotTime: '14:30:00' });
const idx4 = computeMagnet('SENSEX', buildBearishChain(80450, 100, 10), 80450, 10, 100, 3, { name: 'Sensex', type: 'index', spotTime: '14:30:00' });

if (idx1 && idx2 && idx3 && idx4) {
  const agg = computeAggregateSignal([idx1, idx2, idx3, idx4]);
  console.log(`Direction: ${agg.direction} (${agg.strength})`);
  console.log(`Score: ${agg.score} (indices 3× weight = max ±30 each, total max ±120)`);
  console.log(`Confidence: ${agg.confidence}%`);
  console.log(`Distribution: ${agg.bullCount} bull / ${agg.bearCount} bear / ${agg.waitCount} wait`);
  console.log(`Top bull: ${agg.topBull?.symbol} (${agg.topBull?.score.toFixed(1)}, ${agg.topBull?.strength})`);
  console.log(`Top bear: ${agg.topBear?.symbol} (${agg.topBear?.score.toFixed(1)}, ${agg.topBear?.strength})`);
  console.log(`Notes: ${agg.notes}`);
}

console.log('\n=== Test Complete ===');
