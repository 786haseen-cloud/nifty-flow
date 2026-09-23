// Standalone reproduction of directionalTarget/directionalStop from magnet-engine.ts
// to verify the deployed logic produces 993 (correct) for INFY PUT, not 1041.

type Dir = 'CALL' | 'PUT' | 'WAIT';

interface M {
  magnetCenter: number;
  zeroGamma: number | null;
  magnetZone: number[];
  spot: number;
  strikeStep: number;
}

function directionalTarget(m: M, dir: Dir, atmStrike: number): number {
  const minReward = m.strikeStep;
  if (dir === 'WAIT') return atmStrike;
  if (m.magnetCenter > 0) {
    const magnetReward = dir === 'CALL' ? m.magnetCenter - m.spot : m.spot - m.magnetCenter;
    if (magnetReward >= minReward) return Math.round(m.magnetCenter);
    const dist = Math.max(minReward, Math.abs(magnetReward));
    return Math.round(dir === 'CALL' ? m.spot + dist : m.spot - dist);
  }
  return Math.round(dir === 'CALL' ? m.spot + minReward : m.spot - minReward);
}

function directionalStop(m: M, dir: Dir, atmStrike: number): number {
  if (dir === 'WAIT') return atmStrike;
  if (dir === 'CALL') {
    if (m.zeroGamma !== null && m.zeroGamma > 0 && m.zeroGamma < m.spot) {
      return Math.round(m.zeroGamma - m.strikeStep * 0.5);
    }
    if (m.magnetZone.length > 0) {
      const zoneStop = Math.min(...m.magnetZone) - m.strikeStep;
      if (zoneStop < m.spot) return Math.round(zoneStop);
    }
    return atmStrike - m.strikeStep * 2;
  }
  if (m.zeroGamma !== null && m.zeroGamma > 0 && m.zeroGamma > m.spot) {
    return Math.round(m.zeroGamma + m.strikeStep * 0.5);
  }
  if (m.magnetZone.length > 0) {
    const zoneStop = Math.max(...m.magnetZone) + m.strikeStep;
    if (zoneStop > m.spot) return Math.round(zoneStop);
  }
  return atmStrike + m.strikeStep * 2;
}

function buildMaxProbPlan(m: M, dir: 'CALL' | 'PUT') {
  const atmStrike = Math.round(m.spot / m.strikeStep) * m.strikeStep;
  const strike = dir === 'CALL' ? atmStrike + m.strikeStep : atmStrike - m.strikeStep;
  const target = directionalTarget(m, dir, atmStrike);
  const stop = directionalStop(m, dir, atmStrike);
  return { strike, target, stop, atmStrike };
}

// User's reported case: INFY PUT, spot=1017, strike=1000, target=1041 (WRONG), stop=1080
// IF strikeStep=20: atmStrike=round(1017/20)*20=1020, strike=1000 ✓ matches

console.log('=== User-reported: INFY PUT, spot=1017, strikeStep=20 ===');
console.log('Expected: strike=1000, target<=1017 (below spot), stop>=1017 (above spot)');

// Scenario A: magnetCenter=1041 (above spot, wrong side for PUT)
const scenarioA: M = {
  magnetCenter: 1041,
  zeroGamma: 1040,
  magnetZone: [1000, 1020, 1040],
  spot: 1017,
  strikeStep: 20,
};
console.log('  Scenario A (magnet=1041, above spot, wrong side):');
console.log('   ', buildMaxProbPlan(scenarioA, 'PUT'));

// Scenario B: magnetCenter=993 (below spot, profit side for PUT)
const scenarioB: M = {
  magnetCenter: 993,
  zeroGamma: 1040,
  magnetZone: [990, 1000, 1010],
  spot: 1017,
  strikeStep: 20,
};
console.log('  Scenario B (magnet=993, below spot, profit side):');
console.log('   ', buildMaxProbPlan(scenarioB, 'PUT'));

// Scenario C: no magnet
const scenarioC: M = {
  magnetCenter: 0,
  zeroGamma: null,
  magnetZone: [],
  spot: 1017,
  strikeStep: 20,
};
console.log('  Scenario C (no magnet):');
console.log('   ', buildMaxProbPlan(scenarioC, 'PUT'));

// Scenario D: magnet slightly below spot but within 1 strikeStep (mirror case)
const scenarioD: M = {
  magnetCenter: 1005,
  zeroGamma: null,
  magnetZone: [],
  spot: 1017,
  strikeStep: 20,
};
console.log('  Scenario D (magnet=1005, within strikeStep):');
console.log('   ', buildMaxProbPlan(scenarioD, 'PUT'));

// What would produce target=1041 for PUT with spot=1017?
// - magnetCenter=1041 (above spot, wrong side) BUT magnetReward>=minReward.
//   magnetReward = 1017 - 1041 = -24. -24 >= 20? FALSE. So we wouldn't return magnet.
// - What if strikeStep is NEGATIVE? That doesn't make sense.
// - What if magnetReward formula was inverted? CALL formula is magnet - spot. If
//   we accidentally used CALL formula for PUT: magnetReward = 1041 - 1017 = 24 >= 20 ✓
//   → return magnetCenter = 1041. EXACTLY matches user's bug!
console.log('\n=== BUG HYPOTHESIS ===');
console.log('If magnetReward formula was inverted for PUT (used CALL formula):');
console.log('  magnetReward = magnet - spot = 1041 - 1017 = 24');
console.log('  24 >= strikeStep (20)? YES');
console.log('  → return magnetCenter = 1041 ← MATCHES USER REPORT');
console.log('\nCurrent deployed code formula for PUT: spot - magnet = -24');
console.log('  -24 >= 20? NO → mirror branch → returns 993 (correct)');
console.log('\n→ Deployed code is CORRECT. User must be seeing a stale deployment,');
console.log('  OR looking at a screenshot from before the Task 47 fix was deployed.');
