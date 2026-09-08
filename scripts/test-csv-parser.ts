/**
 * Test: parse uploaded CSV files + synthetic Cash Market participant volume
 * report, verifying all supported NSE formats parse correctly.
 */
import { readFileSync } from 'fs';
import { parseParticipantCsv } from '../src/lib/participant-csv-parser';

const files = [
  '/home/z/my-project/upload/fii-dii-nse-latest.csv',
  '/home/z/my-project/upload/fao_participant_oi_07092026.csv',
  '/home/z/my-project/upload/fao_participant_vol_07092026.csv',
];

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures++;
  }
}

for (const f of files) {
  console.log('\n=== ' + f.split('/').pop() + ' ===');
  const content = readFileSync(f, 'utf-8');
  const result = parseParticipantCsv(f.split('/').pop()!, content);
  console.log('Format:    ' + result.format);
  console.log('Date:      ' + result.date);
  console.log('FII:       ' + result.fii + ' Cr');
  console.log('DII:       ' + result.dii + ' Cr');
  console.log('Client:    ' + result.client + ' Cr');
  console.log('PropDesk:  ' + result.propdesk + ' Cr');
  if (result.positioning) {
    console.log('Positioning:');
    for (const [k, v] of Object.entries(result.positioning)) {
      console.log(`  ${k}: ${v.longContracts.toLocaleString()}L / ${v.shortContracts.toLocaleString()}S contracts`);
    }
  }
  console.log('Summary:   ' + result.summary);
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of result.warnings) console.log('  ⚠ ' + w);
  }
}

// ─── Synthetic test: NSE Cash Market participant volume report ───
// Format mirrors NSE "Participant wise Trading Volume - Capital Market
// Segment" (values in ₹ Lakhs, converted to Cr by the parser).
console.log('\n=== synthetic cm_participant_08092026.csv (₹ Lakhs) ===');
{
  const csv = [
    '"Participant wise Trading Volume - Capital Market Segment as on Sep 08, 2026",,,,,',
    '"Values in Rs. Lakhs",,,,,',
    'Client Type,Buy Value,Sell Value,Net Value',
    'Client,533890.13,539890.13,-6000.00',
    'NRI,1234.56,1200.00,34.56',
    'DII,85000.00,73000.00,12000.00',
    'Pro,420000.50,426000.50,-6000.00',
    'TOTAL,1040125.19,1040090.63,34.56',
  ].join('\n');
  const r = parseParticipantCsv('cm_participant_08092026.csv', csv);
  console.log('Format:    ' + r.format);
  console.log('Date:      ' + r.date);
  console.log('Client:    ' + r.client + ' Cr  (expect -60.00 = -6000 Lakhs / 100)');
  console.log('PropDesk:  ' + r.propdesk + ' Cr  (expect -60.00 = -6000 Lakhs / 100)');
  console.log('FII:       ' + r.fii + ' Cr  (expect 0 — no FII row in CM report)');
  console.log('Summary:   ' + r.summary);
  check('format = cm_participant_volume', r.format === 'cm_participant_volume', r.format);
  check('date = 2026-09-08', r.date === '2026-09-08', String(r.date));
  check('client = -60 Cr (Lakhs→Cr)', r.client === -60, String(r.client));
  check('propdesk = -60 Cr (Lakhs→Cr)', r.propdesk === -60, String(r.propdesk));
  check('fii = 0 (not in this file)', r.fii === 0, String(r.fii));
}

// ─── Synthetic test: same file but already in ₹ Crore ───
console.log('\n=== synthetic cm volume in ₹ Cr (no unit row) ===');
{
  const csv = [
    '"Participant wise Trading Volume - Capital Market Segment as on Sep 08, 2026",,,,,',
    'Client Type,Buy Value,Sell Value,Net Value',
    'Client,5338.90,5398.90,-60.00',
    'NRI,12.34,12.00,0.34',
    'DII,850.00,730.00,120.00',
    'Pro,4200.00,4260.00,-60.00',
    'TOTAL,10401.24,10400.90,0.34',
  ].join('\n');
  const r = parseParticipantCsv('cash_volume.csv', csv);
  console.log('Format:    ' + r.format);
  console.log('Client:    ' + r.client + ' Cr  (expect -60.00, unit assumed Cr)');
  check('format = cm_participant_volume (content-detected)', r.format === 'cm_participant_volume', r.format);
  check('client = -60 Cr (no conversion)', r.client === -60, String(r.client));
  check('assumed-Cr warning present', r.warnings.some(w => w.includes('assuming ₹ Crore')), 'missing');
}

// ─── Regression: FII/DII activity + F&O files still detect correctly ───
console.log('\n=== regression checks ===');
{
  const cash = readFileSync(files[0], 'utf-8');
  const r1 = parseParticipantCsv('fii-dii-nse-latest.csv', cash);
  check('fii_dii_cash format', r1.format === 'fii_dii_cash', r1.format);
  check('FII positive', r1.fii > 0, String(r1.fii));

  const oi = readFileSync(files[1], 'utf-8');
  const r2 = parseParticipantCsv('fao_participant_oi_07092026.csv', oi);
  check('fao_participant_oi format', r2.format === 'fao_participant_oi', r2.format);
  check('positioning present', !!r2.positioning, 'no positioning');

  const vol = readFileSync(files[2], 'utf-8');
  const r3 = parseParticipantCsv('fao_participant_vol_07092026.csv', vol);
  check('fao_participant_volume format', r3.format === 'fao_participant_volume', r3.format);
  check('fii/dii not populated from contracts file', r3.fii === 0 && r3.dii === 0, `fii=${r3.fii} dii=${r3.dii}`);
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED ✓' : `${failures} CHECK(S) FAILED ✗`));
process.exit(failures === 0 ? 0 : 1);
