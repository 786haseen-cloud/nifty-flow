/**
 * Max-Probability Dual Signal — scenario tests (Task 32)
 *
 * Validates computeDirectionalProbability + computeMaxProbabilitySignals
 * across the domain scenarios the user actually trades:
 *   1. THE FRIDAY CRASH (regression for "market fell 500+ pts, where is the
 *      put buy signal?") — structure stays bullish, flow goes bearish → the
 *      PUT card MUST surface a flow-driven candidate with honest tier.
 *   2. Full-alignment PUT (structure + flow agree bearish) → ELITE.
 *   3. Rip day → CALL ELITE, PUT honestly "NO EDGE".
 *   4. Mixed/neutral day → both sides ~50, LEAN / NO EDGE.
 *   5. Gated CALL (score would fire, footprint opposes) → gated chip data.
 *   6. Empty input → nulls.
 *   7. Universe ranking — most flow-bearish symbol wins PUT, runner-up set.
 *   8. Monotonicity — deeper bearish flow ⇒ higher PUT probability.
 *   9. Trade-plan mirroring — strike/target/stop rules match computeSignal.
 *
 * Run: npx tsx scripts/test-max-probability.ts
 */

import {
  computeMaxProbabilitySignals,
  computeDirectionalProbability,
  type MagnetResult,
  type SignalResult,
} from '../src/lib/magnet-engine';

// ─── Fixture factory ───

function mkSignal(direction: SignalResult['direction'], strength: SignalResult['strength'], score: number): SignalResult {
  return {
    direction,
    strength,
    score,
    confidence: Math.min(100, Math.round((Math.abs(score) / 15) * 100)),
    reasons: [],
    suggestedStrike: 25050,
    suggestedTarget: 24950,
    suggestedStop: 24900,
    timing: direction === 'WAIT' ? 'WAIT' : 'NOW',
    notes: '',
  };
}

function mk(over: Partial<MagnetResult> & { symbol?: string; signal?: SignalResult }): MagnetResult {
  const spot = over.spot ?? 25000;
  return {
    symbol: over.symbol ?? 'NIFTY',
    name: over.name ?? 'NIFTY 50',
    type: over.type ?? 'index',
    spot,
    spotTime: '10:15:00',
    maxPain: 24950,
    maxPainDist: spot - 24950,
    maxPainDistPct: ((spot - 24950) / 24950) * 100,
    gexStrikes: [],
    totalGexCr: 120,
    zeroGamma: over.zeroGamma ?? 24800,
    gammaRegime: over.gammaRegime ?? 'positive',
    magnetZone: over.magnetZone ?? [24900, 24950, 25000],
    magnetCenter: over.magnetCenter ?? 24950,
    magnetScore: 72,
    pinningProbability: over.pinningProbability ?? 50,
    charmDirection: over.charmDirection ?? 'flat',
    charmMagnitudeCr: over.charmMagnitudeCr ?? 400,
    charmStrikes: [],
    totalCEOI: 5_700_000,
    totalPEOI: 4_450_000,
    pcr: over.pcr ?? 0.78,
    daysToExpiry: over.daysToExpiry ?? 4,
    lotSize: 75,
    strikeStep: over.strikeStep ?? 50,
    basisPct: over.basisPct ?? null,
    ivSkewPct: over.ivSkewPct ?? null,
    oiBuildup: over.oiBuildup ?? 'neutral',
    oiBuildupStrength: over.oiBuildupStrength ?? 0,
    vix: over.vix ?? 13.5,
    vixChangePct: over.vixChangePct ?? null,
    participantBias: over.participantBias ?? 0,
    participantBiasDetail: over.participantBiasDetail ?? '',
    footprintTone: over.footprintTone ?? 'neutral',
    footprintScore: over.footprintScore ?? 0,
    footprintDetail: over.footprintDetail ?? '',
    signal: over.signal ?? mkSignal('WAIT', 'NONE', 0),
    patternMatch: over.patternMatch ?? null,
  };
}

// ─── Tiny assertion harness ───

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? `  →  ${extra}` : ''}`);
  }
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[1] FRIDAY CRASH — structure bullish (+6.9, gated), flow bearish');
{
  const crash = mk({
    symbol: 'BANKNIFTY',
    name: 'NIFTY BANK',
    spot: 54200,
    strikeStep: 100,
    signal: mkSignal('WAIT', 'NONE', 6.9),   // engine CALL killed by gate (Friday reality)
    basisPct: -0.20,
    vix: 15.2,
    vixChangePct: 8.0,
    oiBuildup: 'short_buildup',
    oiBuildupStrength: -0.8,
    participantBias: -0.39,
    footprintTone: 'bearish',
    footprintScore: -3,
    footprintDetail: 'SMART MONEY BEARISH — futures short buildup, PCR falling',
  });

  const putP = computeDirectionalProbability(crash, 'PUT');
  console.log(`      PUT: prob=${putP.probability} structure=${putP.structureProb} flow=${putP.flowProb} alignment=${putP.alignment}`);
  check('PUT probability is flow-driven and above coin-flip', putP.probability >= 55, `got ${putP.probability}`);
  check('PUT flow lens strongly bearish (≥75)', putP.flowProb >= 75, `got ${putP.flowProb}`);
  check('PUT structure lens honestly penalized (<40)', putP.structureProb < 40, `got ${putP.structureProb}`);
  check('PUT alignment = aligned (footprint bearish agrees)', putP.alignment === 'aligned', `got ${putP.alignment}`);

  const callP = computeDirectionalProbability(crash, 'CALL');
  console.log(`      CALL: prob=${callP.probability} structure=${callP.structureProb} flow=${callP.flowProb}`);
  check('CALL probability damped below 50 on crash day', callP.probability < 50, `got ${callP.probability}`);

  const res = computeMaxProbabilitySignals([crash]);
  check('PUT card present with candidate', res.put !== null);
  check('PUT card NOT flagged gated (gate killed the CALL, not the PUT)', res.put?.gated === false);
  check('PUT notes mention structure lag', /structure still lags/i.test(res.put?.notes ?? ''), res.put?.notes);
  check('CALL card flagged gated', res.call?.gated === true, `gated=${res.call?.gated}`);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[2] Full-alignment PUT (structure + flow both bearish) → ELITE');
{
  const bear = mk({
    signal: mkSignal('PUT', 'STRONG', -9.5),
    basisPct: -0.12,
    vixChangePct: 3.0,
    oiBuildup: 'short_buildup',
    oiBuildupStrength: -0.6,
    participantBias: -1.2,
    footprintTone: 'bearish',
    footprintScore: -2,
    pinningProbability: 30,
  });
  const res = computeMaxProbabilitySignals([bear]);
  console.log(`      PUT: prob=${res.put?.probability} tier=${res.put?.tier} flow=${res.put?.flowProb}`);
  check('PUT probability ≥ 75 (ELITE)', (res.put?.probability ?? 0) >= 75, `got ${res.put?.probability}`);
  check('tier = ELITE', res.put?.tier === 'ELITE', `got ${res.put?.tier}`);
  check('engineFired true', res.put?.engineFired === true);
  check('notes = maximum-conviction', /maximum-conviction/i.test(res.put?.notes ?? ''));
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[3] Rip day — CALL ELITE, PUT honest NO EDGE');
{
  const rip = mk({
    signal: mkSignal('CALL', 'STRONG', 12.0),
    basisPct: 0.20,
    vixChangePct: -4.0,
    oiBuildup: 'long_buildup',
    oiBuildupStrength: 0.7,
    participantBias: 0.8,
    footprintTone: 'bullish',
    footprintScore: 3,
  });
  const res = computeMaxProbabilitySignals([rip]);
  console.log(`      CALL: prob=${res.call?.probability} tier=${res.call?.tier} | PUT: prob=${res.put?.probability} tier=${res.put?.tier}`);
  check('CALL probability ≥ 75', (res.call?.probability ?? 0) >= 75, `got ${res.call?.probability}`);
  check('PUT probability < 52 (no edge)', (res.put?.probability ?? 100) < 52, `got ${res.put?.probability}`);
  check('PUT tier = NO EDGE', res.put?.tier === 'NO EDGE', `got ${res.put?.tier}`);
  check('PUT alignment = divergent (flow bullish opposes)', res.put?.alignment === 'divergent');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[4] Mixed/neutral day — both sides near coin-flip');
{
  const flat = mk({
    signal: mkSignal('WAIT', 'NONE', 0.5),
    basisPct: 0.01,
    vixChangePct: 0.2,
    oiBuildup: 'neutral',
    footprintTone: 'churn',
    footprintScore: 0,
    pinningProbability: 50,
  });
  const res = computeMaxProbabilitySignals([flat]);
  console.log(`      CALL: prob=${res.call?.probability} tier=${res.call?.tier} | PUT: prob=${res.put?.probability} tier=${res.put?.tier}`);
  check('CALL probability in 45-58 band', (res.call?.probability ?? 0) >= 45 && (res.call?.probability ?? 0) <= 58, `got ${res.call?.probability}`);
  check('PUT probability in 45-58 band', (res.put?.probability ?? 0) >= 45 && (res.put?.probability ?? 0) <= 58, `got ${res.put?.probability}`);
  check('no false ELITE/HIGH tiers', ['LEAN', 'NO EDGE'].includes(res.call?.tier ?? '') && ['LEAN', 'NO EDGE'].includes(res.put?.tier ?? ''));
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[5] Empty universe → nulls');
{
  const res = computeMaxProbabilitySignals([]);
  check('call null', res.call === null);
  check('put null', res.put === null);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[6] Universe ranking — crash-day uniform structure + agreement-beats-extremity');
{
  // A) FRIDAY CHARACTER: every symbol has bullish structure (the crash-day
  //    reality) with VARYING bearish flow → deepest bearish flow must win PUT.
  const friday = [
    mk({ symbol: 'NIFTY', signal: mkSignal('WAIT', 'NONE', 6.9), footprintScore: -3, footprintTone: 'bearish', basisPct: -0.2, vixChangePct: 8, oiBuildup: 'short_buildup', oiBuildupStrength: -0.8, participantBias: -0.39 }),
    mk({ symbol: 'SENSEX', type: 'index', signal: mkSignal('WAIT', 'NONE', 7.3), footprintScore: -2, footprintTone: 'bearish', basisPct: -0.15, vixChangePct: 6, oiBuildup: 'short_buildup', oiBuildupStrength: -0.5, participantBias: -0.39, spot: 79200, strikeStep: 100 }),
    mk({ symbol: 'TCS', type: 'stock', signal: mkSignal('WAIT', 'NONE', 9.9), footprintScore: 1, footprintTone: 'bullish', basisPct: 0.1, participantBias: -0.39, spot: 4150, strikeStep: 20 }),
    mk({ symbol: 'LT', type: 'stock', signal: mkSignal('WAIT', 'NONE', 4.4), footprintScore: -1, footprintTone: 'bearish', basisPct: -0.05, participantBias: -0.39, spot: 3620, strikeStep: 20 }),
  ];
  const resA = computeMaxProbabilitySignals(friday);
  console.log(`      A) PUT winner: ${resA.put?.symbol} ${resA.put?.probability}% (runner-up ${resA.put?.runnerUp?.symbol} ${resA.put?.runnerUp?.probability}%)`);
  check('A) PUT winner = NIFTY (deepest bearish flow on uniform structure)', resA.put?.symbol === 'NIFTY', `got ${resA.put?.symbol}`);
  check('A) runner-up present and ≠ winner', resA.put?.runnerUp !== undefined && resA.put.runnerUp.symbol !== resA.put.symbol);
  check('A) CALL winner = TCS (only bullish-flow symbol)', resA.call?.symbol === 'TCS', `got ${resA.call?.symbol}`);

  // B) AGREEMENT BEATS EXTREMITY: a FIRED PUT (both lenses mildly agree)
  //    outranks an extreme-flow candidate whose structure opposes (divergent).
  const ltFired = mk({ symbol: 'LT', type: 'stock', signal: mkSignal('PUT', 'WEAK', -4.4), footprintScore: -1, footprintTone: 'bearish', basisPct: -0.05, participantBias: -0.39, spot: 3620, strikeStep: 20 });
  const resB = computeMaxProbabilitySignals([ltFired, friday[0]]);
  console.log(`      B) PUT winner: ${resB.put?.symbol} ${resB.put?.probability}% (divergent extreme = NIFTY 55%)`);
  check('B) fired agreeing PUT outranks divergent extreme-flow', resB.put?.symbol === 'LT', `got ${resB.put?.symbol}`);
  check('B) LT marked engineFired', resB.put?.engineFired === true);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[7] Monotonicity — deeper bearish flow ⇒ higher PUT probability');
{
  const base = { signal: mkSignal('WAIT', 'NONE', 2.0) };
  const mild = mk({ ...base, footprintScore: -1, footprintTone: 'bearish' });
  const deep = mk({ ...base, footprintScore: -3, footprintTone: 'bearish' });
  const pMild = computeDirectionalProbability(mild, 'PUT').probability;
  const pDeep = computeDirectionalProbability(deep, 'PUT').probability;
  console.log(`      mild=${pMild} deep=${pDeep}`);
  check('deep bearish flow outranks mild', pDeep > pMild, `${pDeep} vs ${pMild}`);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[8] Trade-plan mirroring (strike 1 OTM, stop/target rules match computeSignal)');
{
  const m = mk({
    spot: 25000,
    strikeStep: 50,
    zeroGamma: 25200,        // ABOVE spot → PUT stop rule = zeroΓ + half step
    magnetCenter: 24950,
    magnetZone: [24900, 24950, 25000],
    signal: mkSignal('PUT', 'MODERATE', -5.0),
  });
  const res = computeMaxProbabilitySignals([m]);
  check('PUT strike = ATM − 1 step (24950)', res.put?.strike === 24950, `got ${res.put?.strike}`);
  check('PUT target = magnet center (24950)', res.put?.target === 24950, `got ${res.put?.target}`);
  check('PUT stop = zeroΓ + half step (25225)', res.put?.stop === 25225, `got ${res.put?.stop}`);

  const callRes = computeDirectionalProbability(
    mk({ ...m, signal: mkSignal('CALL', 'MODERATE', 6.0) }),
    'CALL',
  );
  check('CALL direction computes independently', callRes.probability >= 55, `got ${callRes.probability}`);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[9] Pattern history + pinning modifiers');
{
  const withHist = mk({
    signal: mkSignal('PUT', 'MODERATE', -5.0),
    footprintTone: 'bearish',
    footprintScore: -2,
    patternMatch: { total: 5, wins: 4, losses: 1, expired: 0, winRate: 80, avgMovePct: 0.3, confidenceBoost: 1.5, summary: '4/5 won' },
    pinningProbability: 30,
  });
  const noHist = mk({
    signal: mkSignal('PUT', 'MODERATE', -5.0),
    footprintTone: 'bearish',
    footprintScore: -2,
    pinningProbability: 30,
  });
  const p1 = computeDirectionalProbability(withHist, 'PUT').probability;
  const p0 = computeDirectionalProbability(noHist, 'PUT').probability;
  console.log(`      with history=${p1} without=${p0}`);
  check('80% win-rate history boosts PUT probability', p1 > p0, `${p1} vs ${p0}`);

  const pinned = mk({
    signal: mkSignal('PUT', 'MODERATE', -5.0),
    footprintTone: 'bearish',
    footprintScore: -2,
    pinningProbability: 80,
  });
  const pPinned = computeDirectionalProbability(pinned, 'PUT').probability;
  console.log(`      pinned=${pPinned} vs baseline=${p0}`);
  check('high pinning dampens probability', pPinned < p0, `${pPinned} vs ${p0}`);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n[10] Task 47 — direction-consistent targets/stops (live bug: INFY PUT tgt 1042 > spot 1030; TITAN CALL tgt 4899 < spot 4910)');
{
  // A) INFY PUT — magnet ABOVE spot (bullish magnet) but flow/structure put
  //    candidate wins the PUT ranking. Old code copied magnetCenter →
  //    "target" 1042 ABOVE entry 1030 with stop 1080: hitting target = losing.
  const infy = mk({
    symbol: 'INFY', name: 'Infosys', type: 'stock',
    spot: 1030, strikeStep: 20,
    zeroGamma: 1075,            // above spot → PUT stop rule = zeroΓ + half step
    magnetCenter: 1042,         // ABOVE spot → wrong side for a PUT
    magnetZone: [1040, 1060],
    signal: mkSignal('WAIT', 'NONE', 1.8),
    footprintTone: 'bearish', footprintScore: -2,
  });
  const infyRes = computeMaxProbabilitySignals([infy]);
  const infyPut = infyRes.put;
  console.log(`      INFY PUT plan: spot=1030 strike=${infyPut?.strike} target=${infyPut?.target} stop=${infyPut?.stop}`);
  check('A) PUT target BELOW spot (profit side)', (infyPut?.target ?? Infinity) < 1030, `got ${infyPut?.target}`);
  check('A) PUT target = spot − mirrored distance (1010)', infyPut?.target === 1010, `got ${infyPut?.target}`);
  check('A) PUT stop ABOVE spot (loss side)', (infyPut?.stop ?? 0) > 1030, `got ${infyPut?.stop}`);
  check('A) plan ordering stop > spot > target', (infyPut?.stop ?? 0) > 1030 && 1030 > (infyPut?.target ?? 0));

  // B) TITAN CALL — magnet BELOW spot (bearish magnet), call candidate wins.
  //    Old code: "target" 4899 BELOW entry 4910, stop 4832 below it.
  const titan = mk({
    symbol: 'TITAN', name: 'Titan Company', type: 'stock',
    spot: 4910, strikeStep: 20,
    zeroGamma: 4838,            // below spot → CALL stop rule = zeroΓ − half step
    magnetCenter: 4899,         // BELOW spot → wrong side for a CALL
    magnetZone: [4850, 4899],
    signal: mkSignal('CALL', 'STRONG', 8.8),
    footprintTone: 'bullish', footprintScore: 3,
  });
  const titanRes = computeMaxProbabilitySignals([titan]);
  const titanCall = titanRes.call;
  console.log(`      TITAN CALL plan: spot=4910 strike=${titanCall?.strike} target=${titanCall?.target} stop=${titanCall?.stop}`);
  check('B) CALL target ABOVE spot (profit side)', (titanCall?.target ?? 0) > 4910, `got ${titanCall?.target}`);
  check('B) CALL target = spot + mirrored distance (4930)', titanCall?.target === 4930, `got ${titanCall?.target}`);
  check('B) CALL stop BELOW spot (loss side)', (titanCall?.stop ?? Infinity) < 4910, `got ${titanCall?.stop}`);
  check('B) plan ordering stop < spot < target', (titanCall?.stop ?? 0) < 4910 && 4910 < (titanCall?.target ?? 0));

  // C) Aligned plan unchanged — magnet already ≥1 step on the profit side
  //    keeps the pure structural target (legacy behavior preserved).
  const alignedCall = computeMaxProbabilitySignals([mk({
    spot: 25000, strikeStep: 50, zeroGamma: 24800,
    magnetCenter: 25100, magnetZone: [25050, 25100],
    signal: mkSignal('CALL', 'MODERATE', 6.0),
  })]);
  check('C) aligned CALL keeps magnet target (25100)', alignedCall.call?.target === 25100, `got ${alignedCall.call?.target}`);

  // D) Stop side guard — CALL with zone fully ABOVE spot and zeroΓ also
  //    above spot (unusable for a CALL stop): zone-edge stop would land
  //    at/beyond entry → 2-step fallback.
  //    (mk() coerces null zeroΓ to 24800 via ??, so pass 25200 to force
  //    the magnetZone branch — 25200 > spot skips the zeroΓ rule.)
  const guardCall = computeMaxProbabilitySignals([mk({
    spot: 25000, strikeStep: 50,
    zeroGamma: 25200, magnetZone: [25100, 25150], magnetCenter: 25125,
    signal: mkSignal('CALL', 'MODERATE', 6.0),
  })]);
  console.log(`      guard CALL stop=${guardCall.call?.stop}`);
  check('D) CALL zone stop above spot → fallback 2-step below (24900)', guardCall.call?.stop === 24900, `got ${guardCall.call?.stop}`);

  // E) Stop side guard — PUT with zone fully BELOW spot → 2-step fallback.
  const guardPut = computeMaxProbabilitySignals([mk({
    spot: 25000, strikeStep: 50,
    zeroGamma: null, magnetZone: [24800, 24850], magnetCenter: 24825,
    signal: mkSignal('PUT', 'MODERATE', -5.0),
  })]);
  console.log(`      guard PUT stop=${guardPut.put?.stop}`);
  check('E) PUT zone stop below spot → fallback 2-step above (25100)', guardPut.put?.stop === 25100, `got ${guardPut.put?.stop}`);

  // F) Thin magnet (right side but < 1 step) → floored to 1 step, never
  //    a target at/inside entry.
  const thinPut = computeMaxProbabilitySignals([mk({
    spot: 25000, strikeStep: 50, zeroGamma: 25200,
    magnetCenter: 24990, magnetZone: [24950, 24990],
    signal: mkSignal('PUT', 'MODERATE', -5.0),
  })]);
  check('F) thin magnet PUT target floored to spot − 1 step (24950)', thinPut.put?.target === 24950, `got ${thinPut.put?.target}`);
}

// ══════════════════════════════════════════════════════════════════
console.log(`\n════════════ RESULT: ${pass} passed, ${fail} failed ════════════`);
if (fail > 0) process.exit(1);
