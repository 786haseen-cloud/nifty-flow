/**
 * Alignment Gate Test — verify Factor 13 + gate behavior
 */
import { computeMagnet, type StrikeOption } from '../src/lib/magnet-engine';

function makeBullishStrikes(spot: number, step: number): StrikeOption[] {
  // Heavy PE OI (puts written below = support) + light CE OI = bullish structure
  const strikes: StrikeOption[] = [];
  for (let i = -3; i <= 3; i++) {
    const k = spot + i * step;
    strikes.push({
      strike: k,
      ceOI: i < 0 ? 8000 : 2000,  // heavy CE below (call writers)
      peOI: i > 0 ? 2000 : 8000,  // heavy PE below (put writers = support)
      ceLTP: Math.max(5, spot - k > 0 ? (spot - k) * 0.8 : 5),
      peLTP: Math.max(5, k - spot > 0 ? (k - spot) * 0.8 : 5),
      ceDelta: 0, peDelta: 0,
    });
  }
  return strikes;
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} — ${detail}`); }
}

const strikes = makeBullishStrikes(24000, 50);

// Strong bullish setup: premium + low falling VIX + strong participant bull
const bullBase = {
  futurePrice: 24120, // +0.5% premium
  vix: 11, vixChangePct: -3,
  participantBias: 1.5,
};

console.log('=== Alignment Gate Tests ===\n');

// Scenario 1: aligned CALL
const r1 = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'bullish', footprintScore: 2, footprintDetail: 'SMART MONEY BULLISH' });
console.log(`1. Engine + footprint BULLISH: → ${r1!.signal.direction} ${r1!.signal.strength} (score ${r1!.signal.score})`);
check('Stays CALL (aligned)', r1!.signal.direction === 'CALL', `got ${r1!.signal.direction}`);
check('ALIGNED note present', r1!.signal.notes.includes('ALIGNED'), r1!.signal.notes.substring(0, 60));

// Scenario 2: divergence — engine CALL + footprint BEARISH
// We need the engine score WITH the bearish footprint to still be positive
// (so the gate fires), so we use a milder bearish footprint
const r2 = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'bearish', footprintScore: -1, footprintDetail: 'BEARISH LEAN' });
console.log(`\n2. Engine CALL + footprint BEARISH: → ${r2!.signal.direction} ${r2!.signal.strength} (score ${r2!.signal.score})`);
// With score 1.5, engine says CALL WEAK. Footprint bearish → gate fires → WAIT
check('Gated to WAIT (divergence)', r2!.signal.direction === 'WAIT', `got ${r2!.signal.direction}`);
check('DIVERGENCE note present', r2!.signal.notes.includes('DIVERGENCE'), r2!.signal.notes.substring(0, 80));

// Scenario 3: footprint NEUTRAL → gate doesn't fire
const r3 = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'neutral', footprintScore: 0, footprintDetail: '' });
console.log(`\n3. Engine CALL + footprint NEUTRAL: → ${r3!.signal.direction} ${r3!.signal.strength} (score ${r3!.signal.score})`);
check('Gate did NOT fire (kept direction)', r3!.signal.direction === 'CALL', `got ${r3!.signal.direction}`);

// Scenario 4: Factor 13 contribution
const rNoFp = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'neutral', footprintScore: 0, footprintDetail: '' });
const rBullFp = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'bullish', footprintScore: 2, footprintDetail: 'bull' });
const rBearFp = computeMagnet('NIFTY 50', strikes, 24000, 50, 50, 3,
  { name: 'Nifty 50', type: 'index', spotTime: '15:00:00' },
  { ...bullBase, footprintTone: 'bearish', footprintScore: -2, footprintDetail: 'bear' });
console.log(`\n4. Factor 13 contribution:`);
console.log(`   No fp: ${rNoFp!.signal.score.toFixed(1)} | Bull fp: ${rBullFp!.signal.score.toFixed(1)} | Bear fp: ${rBearFp!.signal.score.toFixed(1)}`);
check('Bullish fp adds ~+1.5', Math.abs((rBullFp!.signal.score - rNoFp!.signal.score) - 1.5) < 0.5, `diff ${(rBullFp!.signal.score - rNoFp!.signal.score).toFixed(2)}`);
check('Bearish fp adds ~-1.5', Math.abs((rBearFp!.signal.score - rNoFp!.signal.score) - (-1.5)) < 0.5, `diff ${(rBearFp!.signal.score - rNoFp!.signal.score).toFixed(2)}`);

console.log(`\n=== SUMMARY ===`);
console.log(`Pass: ${pass}  Fail: ${fail}`);
if (fail === 0) console.log('✅ All alignment gate tests passed');
else console.log('❌ Some tests failed');
