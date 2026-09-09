/**
 * Verify NSE report uploads — parse the 3 actual uploaded files with the
 * EXACT production parser and print exactly what keys/values the app
 * would have saved to Upstash.
 *
 * Run: npx tsx scripts/verify-participant-uploads.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseParticipantCsv } from '../src/lib/participant-csv-parser';

const FILES = [
  'fii-dii-nse-latest.csv',
  'fao_participant_oi_07092026.csv',
  'fao_participant_vol_07092026.csv',
];

const UPLOAD_DIR = path.join(__dirname, '..', 'upload');

console.log('═'.repeat(70));
console.log('NSE REPORT UPLOAD VERIFICATION — production parser simulation');
console.log('═'.repeat(70));

for (const name of FILES) {
  const p = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(p)) {
    console.log(`\n✗ ${name} — NOT FOUND in upload/`);
    continue;
  }
  const content = fs.readFileSync(p, 'utf-8');
  console.log(`\n${'─'.repeat(70)}\n📄 ${name}\n${'─'.repeat(70)}`);

  try {
    const parsed = parseParticipantCsv(name, content);
    console.log(`  Format detected : ${parsed.format}`);
    console.log(`  Report date     : ${parsed.date ?? '⚠ NO DATE PARSED'}`);

    if (parsed.format === 'fii_dii_cash') {
      console.log(`  FII net   : ${parsed.fiiNetCr} Cr`);
      console.log(`  DII net   : ${parsed.diiNetCr} Cr`);
      console.log(`  → SAVE ACTION: form auto-populated — data is saved ONLY after`);
      console.log(`    you click "Save" (key: participants:${parsed.date})`);
    } else {
      const pos = parsed.positioning!;
      console.log(`  Client : ${pos.client.longContracts.toLocaleString('en-IN')}L / ${pos.client.shortContracts.toLocaleString('en-IN')}S`);
      console.log(`  DII    : ${pos.dii.longContracts.toLocaleString('en-IN')}L / ${pos.dii.shortContracts.toLocaleString('en-IN')}S`);
      console.log(`  FII    : ${pos.fii.longContracts.toLocaleString('en-IN')}L / ${pos.fii.shortContracts.toLocaleString('en-IN')}S`);
      console.log(`  Pro    : ${pos.pro.longContracts.toLocaleString('en-IN')}L / ${pos.pro.shortContracts.toLocaleString('en-IN')}S`);
      const reportType = parsed.format === 'fao_participant_oi' ? 'fao_oi' : 'fao_vol';
      console.log(`  → SAVE ACTION: AUTO-SAVED on upload`);
      console.log(`    key: participant_positioning:${parsed.date}:${reportType}`);
      if (parsed.warnings.length > 0) {
        for (const w of parsed.warnings) console.log(`  ⚠ ${w}`);
      }
    }
    if (parsed.summary) console.log(`  Summary: ${parsed.summary}`);
  } catch (e) {
    console.log(`  ✗ PARSE ERROR: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${'═'.repeat(70)}`);
console.log('Expected Upstash keys after your upload:');
console.log('  participants:YYYY-MM-DD                        ← FII/DII flow (needs Save click)');
console.log('  participant_positioning:YYYY-MM-DD:fao_oi      ← OI snapshot (auto)');
console.log('  participant_positioning:YYYY-MM-DD:fao_vol     ← Volume snapshot (auto)');
console.log('═'.repeat(70));
