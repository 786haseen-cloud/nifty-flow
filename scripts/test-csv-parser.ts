/**
 * Quick test: parse both uploaded CSV files and verify the parser works.
 */
import { readFileSync } from 'fs';
import { parseParticipantCsv } from '../src/lib/participant-csv-parser';

const files = [
  '/home/z/my-project/upload/fii-dii-nse-latest.csv',
  '/home/z/my-project/upload/fao_participant_oi_07092026.csv',
  '/home/z/my-project/upload/fao_participant_vol_07092026.csv',
];

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
