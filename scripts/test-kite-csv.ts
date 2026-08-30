import https from 'https';
import fs from 'fs';

function fetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const csv = await fetch('https://api.kite.trade/instruments');
  const lines = csv.split('\n');
  console.log('Total lines:', lines.length);
  console.log('Header:', lines[0]);
  console.log('---');

  const header = lines[0].split(',');
  console.log('Columns:', header);
  console.log('---');

  // Find NIFTY option line
  for (let i = 1; i < Math.min(lines.length, 50000); i++) {
    const line = lines[i];
    if (line.toUpperCase().includes('NIFTY') && (line.includes('CE') || line.includes('PE')) && line.includes('OPT')) {
      console.log('NIFTY option sample:', line);
      break;
    }
  }

  // Find FINNIFTY/NIFTYFIN line
  for (let i = 1; i < Math.min(lines.length, 50000); i++) {
    const line = lines[i];
    const up = line.toUpperCase();
    if (up.includes('NIFTYFIN') || up.includes('FIN SERVICE') || up.includes('FINNIFTY')) {
      console.log('FINNIFTY sample:', line);
      break;
    }
  }

  // Find HINDUNILVR line
  for (let i = 1; i < Math.min(lines.length, 50000); i++) {
    const line = lines[i];
    const up = line.toUpperCase();
    if (up.includes('HINDUNILVR') || up.includes('HINDUSTAN UNILEVER')) {
      console.log('HINDUNILVR sample:', line);
      break;
    }
  }

  // Find BAJFINANCE line
  for (let i = 1; i < Math.min(lines.length, 50000); i++) {
    const line = lines[i];
    const up = line.toUpperCase();
    if (up.includes('BAJFINANCE') || up.includes('BAJAJ FINANCE')) {
      console.log('BAJFINANCE sample:', line);
      break;
    }
  }

  // Now test matching with our logic
  console.log('\n=== MATCHING TEST ===');
  const tests = [
    { symbol: 'FINNIFTY', aliases: ['NIFTYFIN', 'NIFTY FIN SERVICE'] },
    { symbol: 'HINDUNILVR', aliases: ['HINDUSTAN UNILEVER'] },
    { symbol: 'BAJFINANCE', aliases: ['BAJAJ FINANCE'] },
    { symbol: 'NIFTY', aliases: [] },
    { symbol: 'RELIANCE', aliases: [] },
  ];

  for (const test of tests) {
    const terms = [test.symbol, ...test.aliases].map(s => s.toUpperCase());
    let count = 0;
    let sample = '';
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 10) continue;
      const name = (cols[header.indexOf('name')] || '').toUpperCase();
      const ts = (cols[header.indexOf('trading_symbol')] || '').toUpperCase();
      const seg = cols[header.indexOf('segment')] || '';
      const type = cols[header.indexOf('instrument_type')] || '';

      if ((seg === 'NFO' || seg.startsWith('NFO')) && (type === 'OPTIDX' || type === 'OPTSTK')) {
        const match = terms.some(t => name.includes(t) || ts.includes(t));
        if (match) {
          count++;
          if (!sample) sample = `name="${name}" ts="${ts}" seg="${seg}" type="${type}"`;
        }
      }
    }
    console.log(`${test.symbol}: ${count} matches → ${count > 0 ? 'OK' : 'MISSING'} ${sample}`);
  }
}

main().catch(console.error);
