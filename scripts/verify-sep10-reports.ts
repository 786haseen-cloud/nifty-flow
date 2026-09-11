/**
 * Verify the 3 NSE reports uploaded on Sep 10 evening (~20:30 IST):
 *   1. fii-dii-nse-latest (3).csv        → cash FII/DII activity (₹ Cr)
 *   2. fao_participant_oi_10092026.csv   → F&O participant OI snapshot
 *   3. fao_participant_vol_10092026.csv  → F&O participant trading volume
 *
 * Checks:
 *   A. Format detection + date extraction for each file
 *   B. Positioning extraction (long/short contracts per participant)
 *   C. Three-segment breakdown (cash / options / futures) per participant —
 *      validates the user's market model:
 *        - DII plays cash only, rarely options
 *        - FII + prop desks position against retail in all 3 segments
 *        - Futures = big-player arena (clean smart-money signal → Factor 13)
 *   D. What Factor 12 becomes once the bias picks up Sep 10 data
 *      (replicates computeParticipantBias formula exactly — capped dampener)
 */
import { readFileSync } from 'fs';
import { parseParticipantCsv } from '../src/lib/participant-csv-parser';

const UPLOAD_DIR = '/home/z/my-project/upload';
const FILES = [
  'fii-dii-nse-latest (3).csv',
  'fao_participant_oi_10092026.csv',
  'fao_participant_vol_10092026.csv',
];

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${tag}] ${name} — ${detail}`);
}

console.log('════════════════════════════════════════════════════════════');
console.log(' A. PARSE + FORMAT DETECTION');
console.log('════════════════════════════════════════════════════════════');
const parsed = FILES.map((f) => {
  const content = readFileSync(`${UPLOAD_DIR}/${f}`, 'utf-8');
  const p = parseParticipantCsv(f, content);
  console.log(`\nfile: ${f}`);
  console.log(`  format   : ${p.format}`);
  console.log(`  date     : ${p.date}`);
  console.log(`  fii/dii  : ${p.fii} / ${p.dii} (₹ Cr)`);
  console.log(`  cli/prop : ${p.client} / ${p.propdesk} (₹ Cr)`);
  console.log(`  summary  : ${p.summary}`);
  return p;
});

const cash = parsed[0];
const oi = parsed[1];
const vol = parsed[2];

console.log('\n════════════════════════════════════════════════════════════');
console.log(' B. ASSERTIONS — INGESTION CORRECTNESS');
console.log('════════════════════════════════════════════════════════════');
check('cash format detected', cash.format === 'fii_dii_cash', cash.format);
check('cash date = 2026-09-10', cash.date === '2026-09-10', String(cash.date));
check('FII = -357.38', cash.fii === -357.38, String(cash.fii));
check('DII = +937.22', cash.dii === 937.22, String(cash.dii));
check('Client/Prop = 0 (not in this file)', cash.client === 0 && cash.propdesk === 0, `${cash.client}/${cash.propdesk}`);

check('OI format detected', oi.format === 'fao_participant_oi', oi.format);
check('OI date = 2026-09-10', oi.date === '2026-09-10', String(oi.date));
check('OI positioning present', !!oi.positioning, 'positioning object');

check('VOL format detected', vol.format === 'fao_participant_volume', vol.format);
check('VOL date = 2026-09-10', vol.date === '2026-09-10', String(vol.date));
check('VOL positioning present', !!vol.positioning, 'positioning object');

if (!oi.positioning || !vol.positioning) {
  console.log('\nFATAL: positioning missing — aborting segment analysis');
  process.exit(1);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' C. THREE-SEGMENT BREAKDOWN (Sep 10, 2026)');
console.log('════════════════════════════════════════════════════════════');

// ── CASH ──
console.log('\n── CASH MARKET (₹ Cr) ──');
const fii = cash.fii, dii = cash.dii;
const cliPropInferred = -(fii + dii);
console.log(`  FII           : ${fii.toFixed(2)}  (sell)`);
console.log(`  DII           : +${dii.toFixed(2)}  (buy — absorbing)` );
console.log(`  Client+Prop   : ${cliPropInferred.toFixed(2)}  (INFERRED zero-sum balance — CM report not uploaded)`);
console.log(`  DII absorption: DII bought ${Math.abs(dii / fii).toFixed(1)}x the FII sell`);

// ── FAO OI ──
console.log('\n── F&O OPEN INTEREST (contracts, positions at close) ──');
const P = oi.positioning;
const futL = (x: { longContracts: number; shortContracts: number }) => x.longContracts; // not used per-segment; segment cols not parsed (total only)
type Part = { longContracts: number; shortContracts: number };
// Note: parser stores TOTAL long/short per participant (all derivatives).
// Segment split below uses the raw file columns — read directly:
const oiRows: Record<string, number[]> = {};
{
  const lines = readFileSync(`${UPLOAD_DIR}/${FILES[1]}`, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^"?(Client|DII|FII|Pro)"?,(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (m) oiRows[m[1]] = m.slice(2).map(Number);
  }
}
const cols = ['FutIdxL','FutIdxS','FutStkL','FutStkS','OptIdxCallL','OptIdxPutL','OptIdxCallS','OptIdxPutS','OptStkCallL','OptStkPutL','OptStkCallS','OptStkPutS','TotL','TotS'];
const row = (cat: string) => {
  const r = oiRows[cat];
  if (!r) return null;
  const o: Record<string, number> = {};
  cols.forEach((c, i) => (o[c] = r[i]));
  return o;
};
const cl = row('Client')!, di = row('DII')!, fi = row('FII')!, pr = row('Pro')!;
for (const [name, r] of [['Client', cl], ['DII', di], ['FII', fi], ['Pro', pr]] as const) {
  const futL_ = r.FutIdxL + r.FutStkL, futS_ = r.FutIdxS + r.FutStkS;
  const optL = r.OptIdxCallL + r.OptIdxPutL + r.OptStkCallL + r.OptStkPutL;
  const optS = r.OptIdxCallS + r.OptIdxPutS + r.OptStkCallS + r.OptStkPutS;
  console.log(`  ${name.padEnd(6)} FUTURES ${futL_.toLocaleString()}L / ${futS_.toLocaleString()}S  |  OPTIONS ${optL.toLocaleString()}L / ${optS.toLocaleString()}S (net ${optL - optS >= 0 ? '+' : ''}${(optL - optS).toLocaleString()})  |  TOTAL ${(r.TotL).toLocaleString()}L / ${(r.TotS).toLocaleString()}S`);
}
console.log(`\n  Index futures war: FII ${fi.FutIdxS.toLocaleString()} SHORT vs ${fi.FutIdxL.toLocaleString()} LONG (ratio 1:${(fi.FutIdxS / fi.FutIdxL).toFixed(1)}) — Client ${cl.FutIdxL.toLocaleString()} LONG vs ${cl.FutIdxS.toLocaleString()} SHORT (ratio ${(cl.FutIdxL / cl.FutIdxS).toFixed(1)}:1)`);
console.log(`  DII stock futures: ${di.FutStkS.toLocaleString()} SHORT vs ${di.FutStkL.toLocaleString()} LONG → portfolio hedge vs their +${dii.toFixed(0)} Cr cash buy, not directional`);
const diiTotO = di.OptIdxCallL + di.OptIdxPutL + di.OptIdxCallS + di.OptIdxPutS + di.OptStkCallL + di.OptStkPutL + di.OptStkCallS + di.OptStkPutS;
const allTotO = cl.TotL + cl.TotS + di.TotL + di.TotS + fi.TotL + fi.TotS + pr.TotL + pr.TotS; // approx total contracts both sides
console.log(`  DII option OI: ${diiTotO.toLocaleString()} contracts = ${((diiTotO / (5704449 + 4447961 + 3724879 + 2246338)) * 100).toFixed(2)}% of all index+stock option OI → ABSENT`);

// ── FAO VOL ──
console.log('\n── F&O TRADING VOLUME (contracts traded during the day) ──');
console.log(`  Client: ${vol.positioning.client.longContracts.toLocaleString()}L / ${vol.positioning.client.shortContracts.toLocaleString()}S`);
console.log(`  DII   : ${vol.positioning.dii.longContracts.toLocaleString()}L / ${vol.positioning.dii.shortContracts.toLocaleString()}S`);
console.log(`  FII   : ${vol.positioning.fii.longContracts.toLocaleString()}L / ${vol.positioning.fii.shortContracts.toLocaleString()}S`);
console.log(`  Pro   : ${vol.positioning.pro.longContracts.toLocaleString()}L / ${vol.positioning.pro.shortContracts.toLocaleString()}S`);
const volTotal = (p: Part) => p.longContracts + p.shortContracts;
const vC = volTotal(vol.positioning.client), vD = volTotal(vol.positioning.dii), vF = volTotal(vol.positioning.fii), vP = volTotal(vol.positioning.pro);
const vAll = vC + vD + vF + vP;
console.log(`  Share of total F&O trades: Client ${(vC / vAll * 100).toFixed(1)}% | Pro ${(vP / vAll * 100).toFixed(1)}% | FII ${(vF / vAll * 100).toFixed(1)}% | DII ${(vD / vAll * 100).toFixed(2)}%`);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' D. FACTOR 12 WITH SEP 10 DATA (formula replica of computeParticipantBias)');
console.log('════════════════════════════════════════════════════════════');
function factor12(fiiV: number, diiV: number, clientV: number, propV: number) {
  const smart = fiiV + propV;
  const retail = clientV;
  const smartDirection = smart > 0 ? 1 : smart < 0 ? -1 : 0;
  const smartMag = Math.abs(smart);
  const baseScore = smartDirection * Math.min(2.0, smartMag / 1250);
  const contrarianAdj = -retail / 5000;
  let diiDampenAdj = 0;
  if (smartDirection !== 0 && Math.sign(diiV) !== smartDirection && diiV !== 0) {
    const rawDampen = -smartDirection * Math.min(0.5, Math.abs(diiV) / 2000);
    const cap = 0.5 * Math.abs(baseScore);
    diiDampenAdj = Math.sign(rawDampen) * Math.min(Math.abs(rawDampen), cap);
  }
  let raw = baseScore + contrarianAdj + diiDampenAdj;
  if (baseScore !== 0 && diiDampenAdj !== 0 && Math.sign(raw) !== Math.sign(baseScore)) raw = 0;
  const weight = Math.max(-2.0, Math.min(2.0, Math.round(raw * 100) / 100));
  const direction = weight > 0.15 ? 'bull' : weight < -0.15 ? 'bear' : 'neutral';
  return { weight, direction, base: +baseScore.toFixed(4), dampen: +diiDampenAdj.toFixed(4) };
}
const sep09 = factor12(-627.31, 1314.49, 0, 0);
const sep10 = factor12(cash.fii, cash.dii, 0, 0);
console.log(`  Sep 09 (what bias shows NOW ): weight ${sep09.weight} (${sep09.direction})  base ${sep09.base} dampen +${sep09.dampen}`);
console.log(`  Sep 10 (after the offset fix): weight ${sep10.weight} (${sep10.direction})  base ${sep10.base} dampen +${sep10.dampen}`);
check('Sep 09 bias = -0.25 bear (matches production)', sep09.weight === -0.25 && sep09.direction === 'bear', `${sep09.weight} ${sep09.direction}`);
console.log(`\n  Sep 10 note: FII sold less (-357 vs -627) and DII absorbed 2.6x — reduced conviction is the CORRECT read. Factor 13 (live footprint) + engine structure carry the directional load when Factor 12 is soft.`);

console.log('\n════════════════════════════════════════════════════════════');
console.log(` RESULT: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
console.log('════════════════════════════════════════════════════════════');
process.exit(failures === 0 ? 0 : 1);
