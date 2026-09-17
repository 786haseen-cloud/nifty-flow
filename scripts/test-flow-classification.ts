/**
 * Test: 4-color options flow classification — Sep 17 2026 put-side fix
 * --------------------------------------------------------------------
 * The user caught that the put side of every flow classifier had the
 * premium directions mirrored (PE OI↑ + premium↑ was labeled "PE Write"
 * /bullish — physically backwards: premium rising on fresh OI = put
 * BUYING = bearish). This suite pins the CANONICAL table in
 * src/lib/option-flow-classify.ts (shared by the client live engine and
 * the historical backfill) so it can never drift again.
 *
 * Run: npx tsx scripts/test-flow-classification.ts
 */
import { classifyStrikeFlow } from '../src/lib/option-flow-classify';
import { computeSymbolFlow, type StrikeData } from '../src/lib/trend-types';

let pass = 0;
let fail = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const LOT = 250;
const DELTA = 0.5; // |delta| for both legs

function leg(opts: {
  ceOI?: number; peOI?: number; ceLTP?: number; peLTP?: number;
}): { ceOI: number; peOI: number; ceLTP: number; peLTP: number; ceDelta: number; peDelta: number } {
  return {
    ceOI: opts.ceOI ?? 1000,
    peOI: opts.peOI ?? 1000,
    ceLTP: opts.ceLTP ?? 50,
    peLTP: opts.peLTP ?? 50,
    ceDelta: DELTA,
    peDelta: DELTA,
  };
}

/** Expected value for a fresh (1.0×) or closing (0.3×) 100-contract add: */
function val(factor: number): number {
  return (100 * DELTA * LOT * factor) / 10000000;
}
const EPS = 1e-9;

console.log('\n── Shared classifier: classifyStrikeFlow ──');

// ── CALL side (unchanged — regression guard) ──
{
  const r = classifyStrikeFlow(leg({}), leg({ ceOI: 1100, ceLTP: 52 }), LOT);
  assert('CE OI↑ px↑ → CE Buy → bullish', r.bullish > 0 && r.bearish === 0, JSON.stringify(r));
  assert('  magnitude = 1.0× fresh', Math.abs(r.bullish - val(1)) < EPS);
}
{
  const r = classifyStrikeFlow(leg({}), leg({ ceOI: 1100, ceLTP: 48 }), LOT);
  assert('CE OI↑ px↓ → CE Write → bearish', r.bearish > 0 && r.bullish === 0, JSON.stringify(r));
}
{
  const r = classifyStrikeFlow(leg({}), leg({ ceOI: 900, ceLTP: 52 }), LOT);
  assert('CE OI↓ px↑ → short covering → bullish (0.3×)', r.bullish > 0 && r.bearish === 0, JSON.stringify(r));
  assert('  magnitude = 0.3× closing', Math.abs(r.bullish - val(0.3)) < EPS);
}
{
  const r = classifyStrikeFlow(leg({}), leg({ ceOI: 900, ceLTP: 48 }), LOT);
  assert('CE OI↓ px↓ → long unwinding → bearish (0.3×)', r.bearish > 0 && r.bullish === 0, JSON.stringify(r));
}

// ── PUT side (THE FIX — user caught it) ──
{
  const r = classifyStrikeFlow(leg({}), leg({ peOI: 1100, peLTP: 52 }), LOT);
  assert('PE OI↑ px↑ → PE BUY → BEARISH (was wrongly bullish)', r.bearish > 0 && r.bullish === 0, JSON.stringify(r));
  assert('  magnitude = 1.0× fresh', Math.abs(r.bearish - val(1)) < EPS);
}
{
  const r = classifyStrikeFlow(leg({}), leg({ peOI: 1100, peLTP: 48 }), LOT);
  assert('PE OI↑ px↓ → PE WRITE → BULLISH (was wrongly bearish)', r.bullish > 0 && r.bearish === 0, JSON.stringify(r));
  assert('  magnitude = 1.0× fresh', Math.abs(r.bullish - val(1)) < EPS);
}
{
  const r = classifyStrikeFlow(leg({}), leg({ peOI: 900, peLTP: 52 }), LOT);
  assert('PE OI↓ px↑ → put short covering → BEARISH (0.3×)', r.bearish > 0 && r.bullish === 0, JSON.stringify(r));
  assert('  magnitude = 0.3× closing', Math.abs(r.bearish - val(0.3)) < EPS);
}
{
  const r = classifyStrikeFlow(leg({}), leg({ peOI: 900, peLTP: 48 }), LOT);
  assert('PE OI↓ px↓ → put long unwinding → BULLISH (0.3×)', r.bullish > 0 && r.bearish === 0, JSON.stringify(r));
}

// ── Mixed strike: net = bull − bear, both legs present ──
{
  // Call writing (bearish, 1.0×) + put writing (bullish, 1.0×), equal size → net 0
  const prev = [sd(26000, 1000, 1000, 50, 50)];
  const curr = [sd(26000, 1100, 1100, 48, 48)];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('CE Write + PE Write equal size → net ≈ 0', Math.abs(r.net) < 1e-9, JSON.stringify(r));
  assert('  bull + bear halves recorded', r.bullish > 0 && r.bearish > 0);
}

// ── THE USER-FACING SCENARIO: "desks buy puts on every dip" ──
// Falling stock: fresh put OI with RISING put premiums (buyers lifting offers)
// must net BEARISH — this was the inversion that made the card lie.
{
  const prev = [sd(26000, 1000, 1000, 50, 50)];
  const curr = [sd(26000, 1000, 1200, 50, 58)];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('Put buying on a dip (PE OI↑ px↑) → net BEARISH', r.net < 0, JSON.stringify(r));
}
// And the mirror: desks writing calls into a bounce (CE OI↑ px↓) stays bearish.
{
  const prev = [sd(26000, 1000, 1000, 50, 50)];
  const curr = [sd(26000, 1200, 1000, 46, 50)];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('Call writing into a bounce (CE OI↑ px↓) → net BEARISH', r.net < 0, JSON.stringify(r));
}
// Bullish day: put writing at support (PE OI↑ px↓) now counts BULLISH.
{
  const prev = [sd(26000, 1000, 1000, 50, 50)];
  const curr = [sd(26000, 1000, 1200, 50, 44)];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('Put writing at support (PE OI↑ px↓) → net BULLISH', r.net > 0, JSON.stringify(r));
}

// ── Multi-strike aggregation + per-strike independence ──
{
  const prev = [sd(25900, 1000, 1000, 50, 50), sd(26000, 1000, 1000, 50, 50), sd(26100, 1000, 1000, 50, 50)];
  const curr = [
    sd(25900, 1000, 1100, 50, 48),  // PE write → bullish
    sd(26000, 1000, 1000, 50, 50),  // unchanged → nothing
    sd(26100, 1100, 1000, 48, 50),  // CE write → bearish
  ];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('Multi-strike: unchanged strike contributes 0',
    Math.abs((r.bullish + r.bearish) - 2 * val(1)) < 1e-9, JSON.stringify(r));
  assert('Multi-strike: bull == bear on symmetric writes → net 0', Math.abs(r.net) < 1e-9);
}

// ── Unknown strike (new on this poll) is skipped — no fake delta ──
{
  const prev = [sd(26000, 1000, 1000, 50, 50)];
  const curr = [sd(26000, 1000, 1000, 50, 50), sd(26200, 5000, 5000, 80, 80)];
  const r = computeSymbolFlow(prev, curr, LOT);
  assert('New strike without previous snapshot → no flow', r.bullish === 0 && r.bearish === 0);
}

function sd(
  strike: number, ceOI: number, peOI: number, ceLTP: number, peLTP: number,
): StrikeData {
  return {
    strike, ceOI, peOI, ceLTP, peLTP,
    ceVol: 0, peVol: 0, ceDelta: DELTA, peDelta: DELTA,
  };
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log('ALL PASS — put side now matches the canonical Varsity buildup table');
