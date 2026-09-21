/**
 * Test for Task 42 — Smart Money OI Flow parser extension.
 *
 * Verifies the new `breakdown` field is correctly populated for both
 * fao_participant_oi and fao_participant_volume CSVs — using the actual
 * Sep 18, 2026 NSE uploads as fixture data.
 *
 * Run: npx tsx scripts/test-smart-money-oi-flow.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseParticipantCsv } from '../src/lib/participant-csv-parser';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

const UPLOAD_DIR = path.join(__dirname, '..', 'upload');

console.log('\n[1] F&O participant OI — per-category breakdown extraction');

const oiPath = path.join(UPLOAD_DIR, 'fao_participant_oi_18092026.csv');
if (!fs.existsSync(oiPath)) {
  console.error('  ✗ Skipping — file not found:', oiPath);
  process.exit(1);
}
const oiContent = fs.readFileSync(oiPath, 'utf-8');
const oiParsed = parseParticipantCsv('fao_participant_oi_18092026.csv', oiContent);

assert(oiParsed.format === 'fao_participant_oi', `format detected (got ${oiParsed.format})`);
assert(oiParsed.date === '2026-09-18', `date parsed (got ${oiParsed.date})`);
assert(!!oiParsed.breakdown, `breakdown populated (got ${!!oiParsed.breakdown})`);

if (oiParsed.breakdown) {
  const bd = oiParsed.breakdown;

  // Per the actual Sep 18 CSV, FII row:
  //   Future Index Long: 48406
  //   Future Index Short: 336834
  //   Future Stock Long: 3448501
  //   Future Stock Short: 2947706
  //   Option Index Call Long: 690977
  //   Option Index Put Long: 1299085
  //   Option Index Call Short: 959379
  //   Option Index Put Short: 668632
  //   Option Stock Call Long: 231500
  //   Option Stock Put Long: 431865
  //   Option Stock Call Short: 501288
  //   Option Stock Put Short: 222460

  assert(bd.fii.indexFutures.long === 48406,    `FII indexFutures.long = 48406 (got ${bd.fii.indexFutures.long})`);
  assert(bd.fii.indexFutures.short === 336834,  `FII indexFutures.short = 336834 (got ${bd.fii.indexFutures.short})`);
  assert(bd.fii.indexCalls.long === 690977,     `FII indexCalls.long = 690977 (got ${bd.fii.indexCalls.long})`);
  assert(bd.fii.indexCalls.short === 959379,   `FII indexCalls.short = 959379 (got ${bd.fii.indexCalls.short})`);
  assert(bd.fii.indexPuts.long === 1299085,    `FII indexPuts.long = 1299085 (got ${bd.fii.indexPuts.long})`);
  assert(bd.fii.indexPuts.short === 668632,    `FII indexPuts.short = 668632 (got ${bd.fii.indexPuts.short})`);
  assert(bd.fii.stockFutures.long === 3448501, `FII stockFutures.long = 3448501 (got ${bd.fii.stockFutures.long})`);
  assert(bd.fii.stockFutures.short === 2947706,`FII stockFutures.short = 2947706 (got ${bd.fii.stockFutures.short})`);
  assert(bd.fii.stockCalls.long === 231500,    `FII stockCalls.long = 231500 (got ${bd.fii.stockCalls.long})`);
  assert(bd.fii.stockCalls.short === 501288,   `FII stockCalls.short = 501288 (got ${bd.fii.stockCalls.short})`);
  assert(bd.fii.stockPuts.long === 431865,     `FII stockPuts.long = 431865 (got ${bd.fii.stockPuts.long})`);
  assert(bd.fii.stockPuts.short === 222460,    `FII stockPuts.short = 222460 (got ${bd.fii.stockPuts.short})`);

  // Spot-check another participant: Client row from Sep 18 CSV
  //   Future Index Long: 297981
  //   Future Index Short: 56561
  //   Option Index Call Long: 3604780
  //   Option Index Call Short: 3371765
  assert(bd.client.indexFutures.long === 297981,    `Client indexFutures.long = 297981 (got ${bd.client.indexFutures.long})`);
  assert(bd.client.indexFutures.short === 56561,    `Client indexFutures.short = 56561 (got ${bd.client.indexFutures.short})`);
  assert(bd.client.indexCalls.long === 3604780,     `Client indexCalls.long = 3604780 (got ${bd.client.indexCalls.long})`);
  assert(bd.client.indexCalls.short === 3371765,    `Client indexCalls.short = 3371765 (got ${bd.client.indexCalls.short})`);

  // Spot-check Pro (Sep 18 actual values from CSV)
  //   Future Index Long: 64601, Short: 30560
  //   Option Index Put Long: 1192066, Option Index Put Short: 1083208
  assert(bd.pro.indexFutures.long === 64601,    `Pro indexFutures.long = 64601 (got ${bd.pro.indexFutures.long})`);
  assert(bd.pro.indexFutures.short === 30560,   `Pro indexFutures.short = 30560 (got ${bd.pro.indexFutures.short})`);
  assert(bd.pro.indexPuts.long === 1192066,      `Pro indexPuts.long = 1192066 (got ${bd.pro.indexPuts.long})`);
  assert(bd.pro.indexPuts.short === 1083208,     `Pro indexPuts.short = 1083208 (got ${bd.pro.indexPuts.short})`);

  // Spot-check DII
  //   Future Index Long: 40741, Short: 27774
  //   Option Index Call Long: 8009, Option Index Call Short: 2390
  assert(bd.dii.indexFutures.long === 40741,    `DII indexFutures.long = 40741 (got ${bd.dii.indexFutures.long})`);
  assert(bd.dii.indexFutures.short === 27774,   `DII indexFutures.short = 27774 (got ${bd.dii.indexFutures.short})`);
  assert(bd.dii.indexCalls.long === 8009,       `DII indexCalls.long = 8009 (got ${bd.dii.indexCalls.long})`);
  assert(bd.dii.indexCalls.short === 2390,      `DII indexCalls.short = 2390 (got ${bd.dii.indexCalls.short})`);

  // Aggregated totals should match (existing back-compat field)
  assert(oiParsed.positioning!.fii.longContracts === 6150334,  `FII total long = 6150334 (got ${oiParsed.positioning!.fii.longContracts})`);
  assert(oiParsed.positioning!.fii.shortContracts === 5636299, `FII total short = 5636299 (got ${oiParsed.positioning!.fii.shortContracts})`);
}

console.log('\n[2] F&O participant Volume — per-category breakdown extraction');

const volPath = path.join(UPLOAD_DIR, 'fao_participant_vol_18092026.csv');
if (!fs.existsSync(volPath)) {
  console.error('  ✗ Skipping — file not found:', volPath);
  process.exit(1);
}
const volContent = fs.readFileSync(volPath, 'utf-8');
const volParsed = parseParticipantCsv('fao_participant_vol_18092026.csv', volContent);

assert(volParsed.format === 'fao_participant_volume', `format detected (got ${volParsed.format})`);
assert(volParsed.date === '2026-09-18', `date parsed (got ${volParsed.date})`);
assert(!!volParsed.breakdown, `breakdown populated for volume file too (got ${!!volParsed.breakdown})`);

if (volParsed.breakdown) {
  // Per Sep 18 vol CSV, FII row:
  //   Future Index Long: 9610, Short: 7997
  //   Option Index Call Long: 2671215, Short: 2656725
  //   Option Index Put Long: 2780101, Short: 2762358
  const bd = volParsed.breakdown;
  assert(bd.fii.indexFutures.long === 9610,    `FII vol indexFutures.long = 9610 (got ${bd.fii.indexFutures.long})`);
  assert(bd.fii.indexFutures.short === 7997,   `FII vol indexFutures.short = 7997 (got ${bd.fii.indexFutures.short})`);
  assert(bd.fii.indexCalls.long === 2671215,  `FII vol indexCalls.long = 2671215 (got ${bd.fii.indexCalls.long})`);
  assert(bd.fii.indexCalls.short === 2656725, `FII vol indexCalls.short = 2656725 (got ${bd.fii.indexCalls.short})`);
  assert(bd.fii.indexPuts.long === 2780101,   `FII vol indexPuts.long = 2780101 (got ${bd.fii.indexPuts.long})`);
  assert(bd.fii.indexPuts.short === 2762358,  `FII vol indexPuts.short = 2762358 (got ${bd.fii.indexPuts.short})`);
}

console.log('\n[3] Old parser behaviors preserved — aggregated totals still work');

assert(oiParsed.fii === 0, `oiParsed.fii still 0 for OI file (got ${oiParsed.fii})`);
assert(oiParsed.dii === 0, `oiParsed.dii still 0 for OI file (got ${oiParsed.dii})`);
assert(oiParsed.warnings.length > 0, `warnings still populated`);

console.log(`\n────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────\n`);
process.exit(failed > 0 ? 1 : 0);
