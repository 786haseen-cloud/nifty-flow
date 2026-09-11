/**
 * LT option/future lookup — bug reproduction + fix verification.
 *
 * BUG (before fix): instrument lookups used substring matching
 *   name/ts.includes('LT') which matched EVERY F&O underlying containing
 *   'LT' — LTF, LTTS, LTFOODS, LTIM, VOLTAS (VO-LT-AS), DELTACORP (DE-LT-A),
 *   GUJGASLTD, BEMLTD. The merged multi-stock strike list corrupted the
 *   dynamically-derived strikeStep and lotSize, LT's 9-strike ATM window came
 *   back with <3 real LT strikes, and magnet-scan + max-pain-scan silently
 *   dropped LT (`strikes.length < 3 → continue`). Result:
 *     - Trend tab: LT missing from Magnet + Smart-Money Footprint tables
 *     - OI Walls tab: LT missing from gravity meter + no per-symbol walls
 *     - Basis tab: LT still VISIBLE (row only needs spot + futures price)
 *   — exactly the user-reported symptom pattern.
 *
 * FIX: exact underlying matching via trading-symbol PREFIX extraction
 *   ('LT26SEP3600CE' → prefix 'LT'; 'LTF26...' → 'LTF' ≠ 'LT').
 *
 * Run: npx jiti scripts/test-lt-lookup.ts
 */
import {
  underlyingPrefix,
  matchesUnderlying,
  getInstrumentSpec,
  INDEX_SPECS,
  STOCK_SPECS,
} from '../src/lib/kite-api';

interface Row {
  instrumentToken: number;
  tradingSymbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrumentType: string; // normalized legacy type
  strike: number;
  lotSize: number;
  expiry: string;
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}`); }
}

// ─── Synthetic Kite CSV rows (2025+ format, normalized to legacy types) ───

const EXPIRY = '2026-09-29'; // monthly expiry shared by ALL stock F&O

function optRows(id: number, tsPrefix: string, kiteName: string, spot: number, step: number, lot: number, halfSpanSteps: number): Row[] {
  const rows: Row[] = [];
  const atm = Math.round(spot / step) * step;
  for (let k = -halfSpanSteps; k <= halfSpanSteps; k++) {
    const strike = atm + k * step;
    rows.push({ instrumentToken: id++, tradingSymbol: `${tsPrefix}26SEP${strike}CE`, name: kiteName, exchange: 'NFO', segment: 'NFO-OPT', instrumentType: 'OPTSTK', strike, lotSize: lot, expiry: EXPIRY });
    rows.push({ instrumentToken: id++, tradingSymbol: `${tsPrefix}26SEP${strike}PE`, name: kiteName, exchange: 'NFO', segment: 'NFO-OPT', instrumentType: 'OPTSTK', strike, lotSize: lot, expiry: EXPIRY });
  }
  return rows;
}

function futRow(id: number, tsPrefix: string, kiteName: string, lot: number, token: number): Row {
  return { instrumentToken: token, tradingSymbol: `${tsPrefix}26SEPFUT`, name: kiteName, exchange: 'NFO', segment: 'NFO-FUT', instrumentType: 'FUTSTK', strike: 0, lotSize: lot, expiry: EXPIRY };
}

const rows: Row[] = [];
// LT's real chain: spot ~3646, step 20, lot 150, strikes 3560..3740
rows.push(...optRows(1000, 'LT', 'LARSEN & TOUBRO', 3646, 20, 150, 10));
// The 'LT' substring club — spans model NSE's REAL dense strike listing
// (NSE lists 50-150 strikes per underlying, not ±8). Dense ladders on the
// low-step members flip the old gap histogram away from LT's step-20:
rows.push(...optRows(2000, 'LTF', 'LTF', 172, 5, 475, 40));                 // dense 5-step ladder
rows.push(...optRows(2100, 'LTTS', 'LTTS', 7050, 20, 175, 25));
rows.push(...optRows(2200, 'LTFOODS', 'LT FOODS LTD', 168, 2.5, 1600, 60)); // dense 2.5-step ladder
rows.push(...optRows(2300, 'LTIM', 'LTIMINDTREE', 5820, 10, 300, 40));      // dense 10-step ladder
rows.push(...optRows(2400, 'VOLTAS', 'VOLTAS', 1742, 20, 400, 25));         // VO-LT-AS
rows.push(...optRows(2500, 'DELTACORP', 'DELTA CORP', 112, 2.5, 4000, 60)); // DE-LT-A, very dense
rows.push(...optRows(2600, 'GUJGASLTD', 'GUJARAT GAS LTD', 412, 10, 900, 25));
rows.push(...optRows(2700, 'BEMLTD', 'BEML LTD', 3810, 20, 275, 25));       // BEMLTD strikes overlap LT's!
// Control stocks with an '&' symbol and another 20-step name near LT's strikes
rows.push(...optRows(3000, 'M&M', 'MAHINDRA & MAHINDRA', 2940, 10, 600, 15));
rows.push(...optRows(3100, 'RELIANCE', 'RELIANCE INDUSTRIES', 2950, 20, 250, 15));
rows.push(...optRows(3200, 'TITAN', 'TITAN COMPANY', 3560, 20, 250, 15));   // 3560-3740 overlaps LT!
// Index chains (name collision regression: BANKNIFTY/FINNIFTY contain 'NIFTY')
function idxOptRows(id: number, tsPrefix: string, kiteName: string, spot: number, step: number, lot: number, half: number): Row[] {
  const out: Row[] = [];
  const atm = Math.round(spot / step) * step;
  for (let k = -half; k <= half; k++) {
    const strike = atm + k * step;
    out.push({ instrumentToken: id++, tradingSymbol: `${tsPrefix}26SEP${strike}CE`, name: kiteName, exchange: 'NFO', segment: 'NFO-OPT', instrumentType: 'OPTIDX', strike, lotSize: lot, expiry: EXPIRY });
    out.push({ instrumentToken: id++, tradingSymbol: `${tsPrefix}26SEP${strike}PE`, name: kiteName, exchange: 'NFO', segment: 'NFO-OPT', instrumentType: 'OPTIDX', strike, lotSize: lot, expiry: EXPIRY });
  }
  return out;
}
rows.push(...idxOptRows(4000, 'NIFTY', 'NIFTY 50', 24350, 50, 75, 8));
rows.push(...idxOptRows(4200, 'BANKNIFTY', 'NIFTY BANK', 52300, 100, 30, 6));
rows.push(...idxOptRows(4400, 'FINNIFTY', 'NIFTY FIN SERVICE', 23100, 50, 50, 8));
// Futures (token order matters for the old first-match bug: DELTACORP fut has the LOWEST token)
rows.push(futRow(1, 'DELTACORP', 'DELTA CORP', 4000, 101));  // sorts FIRST in CSV
rows.push(futRow(2, 'LT', 'LARSEN & TOUBRO', 150, 102));
rows.push(futRow(3, 'VOLTAS', 'VOLTAS', 400, 103));
rows.push(futRow(4, 'LTF', 'LTF', 475, 104));
rows.push(futRow(5, 'LTTS', 'LTTS', 175, 105));
// Cash equities (VOLTAS sorts before LT — old single-predicate cash lookup hazard)
rows.push({ instrumentToken: 50, tradingSymbol: 'VOLTAS', name: 'VOLTAS', exchange: 'NSE', segment: 'NSE', instrumentType: 'EQ', strike: 0, lotSize: 1, expiry: '' });
rows.push({ instrumentToken: 647, tradingSymbol: 'LT', name: 'LARSEN & TOUBRO', exchange: 'NSE', segment: 'NSE', instrumentType: 'EQ', strike: 0, lotSize: 1, expiry: '' });

// ─── Matchers ───

const spec = getInstrumentSpec('LT')!;
const aliases = (spec.searchAliases || []).map(a => a.toUpperCase());

const oldFilter = (r: Row) =>
  r.exchange === 'NFO' && r.instrumentType === 'OPTSTK' &&
  ['LT', ...aliases].some(t => r.name.toUpperCase().includes(t) || r.tradingSymbol.toUpperCase().includes(t));
const newFilter = (r: Row) =>
  r.exchange === 'NFO' && r.instrumentType === 'OPTSTK' &&
  matchesUnderlying(r.tradingSymbol, r.name, 'LT', aliases);

function deriveStep(strikes: number[]): number {
  const gaps: Record<string, number> = {};
  for (let i = 1; i < strikes.length; i++) {
    const g = String(Math.round((strikes[i] - strikes[i - 1]) * 100) / 100);
    gaps[g] = (gaps[g] || 0) + 1;
  }
  return parseFloat(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]);
}

console.log('\n═══ 1. underlyingPrefix on real Kite trading symbols ═══');
check('LT26SEP3600CE → LT', underlyingPrefix('LT26SEP3600CE') === 'LT');
check('LT26SEPFUT → LT', underlyingPrefix('LT26SEPFUT') === 'LT');
check('LTF26SEPFUT → LTF (not LT)', underlyingPrefix('LTF26SEPFUT') === 'LTF');
check('LTTS26SEP7000CE → LTTS', underlyingPrefix('LTTS26SEP7000CE') === 'LTTS');
check('VOLTAS26SEP1700CE → VOLTAS', underlyingPrefix('VOLTAS26SEP1700CE') === 'VOLTAS');
check('GUJGASLTD26SEP400CE → GUJGASLTD', underlyingPrefix('GUJGASLTD26SEP400CE') === 'GUJGASLTD');
check('DELTACORP26SEP110CE → DELTACORP', underlyingPrefix('DELTACORP26SEP110CE') === 'DELTACORP');
check('M&M26SEP2900CE → M&M', underlyingPrefix('M&M26SEP2900CE') === 'M&M');
check('NIFTY26SEP24500CE → NIFTY', underlyingPrefix('NIFTY26SEP24500CE') === 'NIFTY');
check('BANKNIFTY26SEP52300CE → BANKNIFTY (not NIFTY)', underlyingPrefix('BANKNIFTY26SEP52300CE') === 'BANKNIFTY');

console.log('\n═══ 2. OLD substring filter reproduces the pollution ═══');
const oldRows = rows.filter(oldFilter);
const oldByPrefix: Record<string, number> = {};
for (const r of oldRows) {
  const p = underlyingPrefix(r.tradingSymbol);
  oldByPrefix[p] = (oldByPrefix[p] || 0) + 1;
}
const foreignCount = Object.entries(oldByPrefix).filter(([p]) => p !== 'LT').reduce((s, [, c]) => s + c, 0);
console.log('  old filter matched by underlying:', JSON.stringify(oldByPrefix));
check('old filter matched >100 FOREIGN option rows', foreignCount > 100);
const oldStrikes = [...new Set(oldRows.map(r => r.strike))].sort((a, b) => a - b);
const oldStepFull = deriveStep(oldStrikes);
console.log(`  old merged strikeStep (full club) = ${oldStepFull} (LT real = 20); foreign lot sizes present: ${[...new Set(oldRows.map(r => r.lotSize))].join(',')}`);
check('old merged set contains foreign lot sizes (opts[0]/lotSize can be foreign)', oldRows.some(r => r.lotSize !== 150));
// DETERMINISTIC strike-token corruption: other 20-step underlyings list
// options at LT's EXACT window strikes → highest-bet's strikeMap is built
// with `.endsWith('CE')` tokens regardless of underlying → last-match wins →
// LT's walls show ANOTHER STOCK's OI/LTP at those strikes.
const oldWindowStrikes = Array.from({ length: 9 }, (_, i) => 3640 - 4 * 20 + i * 20);
const foreignAtLTStrikes = oldRows.filter(r =>
  underlyingPrefix(r.tradingSymbol) !== 'LT' && oldWindowStrikes.includes(r.strike));
const foreignPrefixesAtLTStrikes = [...new Set(foreignAtLTStrikes.map(r => underlyingPrefix(r.tradingSymbol)))];
console.log(`  foreign options sitting on LT's 9 window strikes: ${foreignAtLTStrikes.length} rows (${foreignPrefixesAtLTStrikes.join(',')})`);
check('BEMLTD/TITAN options collide with LT strikes in the merged set', foreignAtLTStrikes.length > 0);

// 2B. Histogram-flip collapse (data-density dependent, deterministic here):
// when the dense low-step club members dominate the gap histogram, the
// derived step flips to 2.5 and LT's 9-strike window collapses to <3 real
// strikes → magnet-scan + max-pain-scan silently `continue` (LT VANISHES
// from the Trend tab tables and the OI Walls gravity meter).
const denseClub = rows.filter(r =>
  r.instrumentType === 'OPTSTK' && ['LT', 'LTFOODS', 'DELTACORP'].includes(underlyingPrefix(r.tradingSymbol)));
const oldDenseStep = deriveStep([...new Set(denseClub.map(r => r.strike))].sort((a, b) => a - b));
console.log(`  dense-club merged step = ${oldDenseStep} (2.5-step ladders dominate)`);
check('dense low-step ladders flip the histogram to 2.5', oldDenseStep === 2.5);
const denseAtm = Math.round(3646 / oldDenseStep) * oldDenseStep;
const denseWindow = Array.from({ length: 9 }, (_, i) => denseAtm - 4 * oldDenseStep + i * oldDenseStep);
const denseLTStrikes = new Set(denseClub.filter(r => underlyingPrefix(r.tradingSymbol) === 'LT' && denseWindow.includes(r.strike)).map(r => r.strike));
console.log(`  LT strikes inside the collapsed window [${denseWindow[0]}..${denseWindow[8]}]: ${denseLTStrikes.size}`);
check('LT collapses to <3 strikes → dropped by scans (strikes.length < 3)', denseLTStrikes.size < 3);

console.log('\n═══ 3. NEW exact filter isolates LT ═══');
const newRows = rows.filter(newFilter);
check('every matched row is genuinely LT', newRows.every(r => underlyingPrefix(r.tradingSymbol) === 'LT'));
check('matched all 42 LT option rows (21 strikes × CE/PE)', newRows.length === 42);
const newStrikes = [...new Set(newRows.map(r => r.strike))].sort((a, b) => a - b);
const newStep = deriveStep(newStrikes);
check('strikeStep now derives correctly as 20', newStep === 20);
check('lotSize now correct (150)', newRows[0].lotSize === 150);
const ltSpot = 3646;
const newAtm = Math.round(ltSpot / newStep) * newStep;
const newWindow = Array.from({ length: 9 }, (_, i) => newAtm - 4 * newStep + i * newStep);
const newInWindow = newRows.filter(r => newWindow.includes(r.strike));
check('9-strike ATM window fully populated (18 rows = 9×CE/PE, zero foreign rows)', newInWindow.length === 18);

console.log('\n═══ 4. Futures: old first-match vs new exact match ═══');
const oldFut = rows.filter(r => r.exchange === 'NFO' && r.instrumentType === 'FUTSTK' &&
  ['LARSEN', 'LT'].some(n => r.name.toUpperCase().includes(n) || r.tradingSymbol.toUpperCase().includes(n)));
console.log(`  old first-match future: ${oldFut[0].tradingSymbol} (token ${oldFut[0].instrumentToken})`);
check('old substring future filter matches 5 club contracts (LT+LTF+LTTS+VOLTAS+DELTACORP)', oldFut.length === 5);
check('old first-match picks DELTACORP future for LT (lowest token sorts first — ₹112 fut for ₹3600 stock!)', oldFut[0].tradingSymbol !== 'LT26SEPFUT');
const newFut = rows.filter(r => r.exchange === 'NFO' && r.instrumentType === 'FUTSTK' &&
  matchesUnderlying(r.tradingSymbol, r.name, 'LT', ['LARSEN', 'LT']));
check('new filter returns exactly the LT future', newFut.length === 1 && newFut[0].tradingSymbol === 'LT26SEPFUT');

console.log('\n═══ 5. Cash lookup: exact-first ordering ═══');
// Old single-predicate find(): VOLTAS EQ (name contains 'LT', token 50) sorts before LT (647)
const oldCash = rows.find(r => r.exchange === 'NSE' && r.instrumentType === 'EQ' &&
  (['LARSEN', 'LT'].some(n => r.tradingSymbol.toUpperCase() === n.toUpperCase()) ||
   ['LARSEN', 'LT'].some(n => r.name.toUpperCase().includes(n.toUpperCase()))));
console.log(`  old single-predicate cash match: ${oldCash?.tradingSymbol}`);
check('old cash lookup grabs VOLTAS for LT (wrong spot price!)', oldCash?.tradingSymbol === 'VOLTAS');
const newCash =
  rows.find(r => r.exchange === 'NSE' && r.instrumentType === 'EQ' &&
    ['LARSEN', 'LT'].some(n => r.tradingSymbol.toUpperCase() === n.toUpperCase())) ||
  rows.find(r => r.exchange === 'NSE' && r.instrumentType === 'EQ' &&
    ['LARSEN', 'LT'].some(n => r.name.toUpperCase() === n.toUpperCase())) ||
  rows.find(r => r.exchange === 'NSE' && r.instrumentType === 'EQ' &&
    ['LARSEN', 'LT'].some(n => r.name.toUpperCase().includes(n.toUpperCase())));
check('new exact-first cash lookup finds the real LT share', newCash?.tradingSymbol === 'LT');

console.log('\n═══ 6. Regression: other symbols still resolve ═══');
for (const sym of ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'M&M', 'RELIANCE', 'TITAN']) {
  const sp = getInstrumentSpec(sym)!;
  const al = (sp.searchAliases || []).map(a => a.toUpperCase());
  const isIdx = sp.instrumentType === 'OPTIDX';
  const got = rows.filter(r =>
    r.segment.startsWith(sp.segment) && r.instrumentType === sp.instrumentType &&
    matchesUnderlying(r.tradingSymbol, r.name, sp.symbol, al));
  const uniqueUnderlyings = new Set(got.map(r => underlyingPrefix(r.tradingSymbol)));
  if (sym === 'SENSEX') {
    check('SENSEX: 0 NFO rows (its options live on BFO — correctly empty here)', got.length === 0);
  } else {
    check(`${sym}: only its own underlying matched (${got.length} rows, underlyings=${[...uniqueUnderlyings].join(',')})`,
      got.length > 0 && uniqueUnderlyings.size === 1 && uniqueUnderlyings.has(sym));
  }
}
// NIFTY must NOT contain BANKNIFTY/FINNIFTY rows (the old .includes('NIFTY') bug)
const niftyNew = rows.filter(r => r.segment.startsWith('NFO') && r.instrumentType === 'OPTIDX' &&
  matchesUnderlying(r.tradingSymbol, r.name, 'NIFTY', ['NIFTY 50', 'NIFTY']));
check('NIFTY set excludes BANKNIFTY/FINNIFTY options',
  niftyNew.every(r => !r.tradingSymbol.startsWith('BANKNIFTY') && !r.tradingSymbol.startsWith('FINNIFTY')));

console.log('\n═══ 7. All 19 tracked symbols have a resolvable spec ═══');
check(`INDEX_SPECS (${INDEX_SPECS.length}) + STOCK_SPECS (${STOCK_SPECS.length}) = 19`,
  INDEX_SPECS.length + STOCK_SPECS.length === 19);
check('LT spec intact with aliases', spec.symbol === 'LT' && (spec.searchAliases || []).length > 0);

console.log(`\n${'═'.repeat(50)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
