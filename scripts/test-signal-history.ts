/**
 * Test script for signal-history module.
 *
 * Run with:
 *   npx tsx scripts/test-signal-history.ts
 *
 * Tests:
 *   1. Health check (graceful when env vars missing)
 *   2. persistSignal() with throttling
 *   3. patternMatch() with similar setups
 *   4. getRecentHistory() returns entries
 *
 * This script is SAFE to run with or without Upstash env vars.
 * Without env vars, all tests should still pass — they just verify
 * graceful degradation returns null / empty arrays.
 */

import 'dotenv/config';
import {
  persistSignal,
  patternMatch,
  getRecentHistory,
  checkRedisHealth,
  type SignalHistoryEntry,
} from '../src/lib/signal-history';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    fail++;
  }
}

async function main() {
  console.log('\n=== Signal History Test Suite ===\n');

  // ─── Test 1: Health check ───
  console.log('Test 1: Health check');
  const health = await checkRedisHealth();
  console.log(`  Redis health: ok=${health.ok}, message="${health.message}"`);
  check('Health check returns without crashing', true);
  check(
    'Without env vars: returns ok=false with helpful message',
    !health.ok && health.message.includes('not configured'),
    'Only enforced when env vars are actually missing'
  );

  if (!health.ok) {
    console.log('\n  ⚠ Upstash env vars not set — running in no-persistence mode.');
    console.log('  ⚠ Tests 2-4 will verify graceful degradation only.');
    console.log('  ⚠ To test full functionality, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }

  // ─── Test 2: persistSignal() ───
  console.log('\nTest 2: persistSignal()');
  const testSymbol = 'TEST_SYMBOL';
  const entry1 = await persistSignal({
    symbol: testSymbol,
    spot: 100,
    direction: 'CALL',
    strength: 'STRONG',
    score: 9.5,
    confidence: 80,
    maxPain: 99,
    magnetCenter: 100.5,
    zeroGamma: 98,
    pinning: 35,
    basisPct: 0.3,
    ivSkewPct: 4,
    oiBuildup: 'long_buildup',
    vix: 12,
  });
  check('First persist returns entry or null (no crash)', entry1 === null || typeof entry1 === 'object');
  if (entry1) {
    check('Entry has ts assigned', typeof entry1.ts === 'number' && entry1.ts > 0);
    check('Entry has outcome=null initially', entry1.outcome === null);
    check('Entry preserves symbol', entry1.symbol === testSymbol);
    check('Entry preserves direction', entry1.direction === 'CALL');
  }

  // Immediately try again with same signal — should be throttled
  const entry2 = await persistSignal({
    symbol: testSymbol,
    spot: 100.1,
    direction: 'CALL',
    strength: 'STRONG',
    score: 9.6,  // small delta — under threshold
    confidence: 81,
    maxPain: 99,
    magnetCenter: 100.5,
    zeroGamma: 98,
    pinning: 35,
    basisPct: 0.3,
    ivSkewPct: 4,
    oiBuildup: 'long_buildup',
    vix: 12,
  });
  check('Throttled persist returns null', entry2 === null, 'Same signal within 60s should be skipped');

  // ─── Test 3: patternMatch() ───
  console.log('\nTest 3: patternMatch()');
  const pm1 = await patternMatch(testSymbol, 'CALL', 9.5, 'long_buildup');
  check('patternMatch returns result or null (no crash)', pm1 === null || typeof pm1 === 'object');
  if (pm1) {
    check('PatternMatch has total field', typeof pm1.total === 'number');
    check('PatternMatch has winRate field', typeof pm1.winRate === 'number');
    check('PatternMatch has summary string', typeof pm1.summary === 'string');
    console.log(`  Summary: "${pm1.summary}"`);
    console.log(`  Total=${pm1.total}, Wins=${pm1.wins}, Losses=${pm1.losses}, WinRate=${pm1.winRate}%`);
  }

  // WAIT direction should always return null
  const pmWait = await patternMatch(testSymbol, 'WAIT', 0, 'neutral');
  check('patternMatch(WAIT) returns null', pmWait === null);

  // ─── Test 4: getRecentHistory() ───
  console.log('\nTest 4: getRecentHistory()');
  const history = await getRecentHistory(testSymbol, 20);
  check('getRecentHistory returns array', Array.isArray(history));
  check('History length is reasonable', history.length <= 20);
  if (history.length > 0) {
    const first = history[0];
    check('First entry has ts', typeof first.ts === 'number');
    check('First entry has direction', typeof first.direction === 'string');
    console.log(`  Most recent: ${first.symbol} ${first.direction} ${first.strength} @ spot ${first.spot}`);
  }

  // ─── Test 5: Multiple symbols (parallel) ───
  console.log('\nTest 5: Parallel persist across multiple symbols');
  const symbols = ['SYM_A', 'SYM_B', 'SYM_C', 'SYM_D'];
  const t0 = Date.now();
  const results = await Promise.all(symbols.map(s => persistSignal({
    symbol: s,
    spot: 100,
    direction: 'CALL',
    strength: 'MODERATE',
    score: 6.0,
    confidence: 60,
    maxPain: 99,
    magnetCenter: 100,
    zeroGamma: 98,
    pinning: 40,
    basisPct: 0.1,
    ivSkewPct: 2,
    oiBuildup: 'long_buildup',
    vix: 14,
  })));
  const dt = Date.now() - t0;
  check('Parallel persist completes', results.length === 4);
  console.log(`  4 parallel persist calls took ${dt}ms`);

  // ─── Summary ───
  console.log('\n=== Summary ===');
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  console.log(`  Total: ${pass + fail}`);
  console.log(fail === 0 ? '\n✅ ALL TESTS PASSED' : `\n❌ ${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
