import https from 'https';

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
  const header = lines[0].split(',');
  const segIdx = header.indexOf('segment');
  const typeIdx = header.indexOf('instrument_type');
  const nameIdx = header.indexOf('name');
  const tsIdx = header.indexOf('tradingsymbol');

  // 1. Show all unique segment + instrument_type combos
  const combos = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length > segIdx && cols.length > typeIdx) {
      combos.add(`${cols[segIdx]} | ${cols[typeIdx]}`);
    }
  }
  console.log('=== ALL SEGMENT | INSTRUMENT_TYPE COMBOS ===');
  [...combos].sort().forEach(c => console.log(c));

  // 2. Find a NIFTY option (CE or PE) - any segment
  console.log('\n=== NIFTY CE/PE samples (any segment) ===');
  let found = 0;
  for (let i = 1; i < lines.length && found < 3; i++) {
    const cols = lines[i].split(',');
    const ts = (cols[tsIdx] || '');
    const name = (cols[nameIdx] || '');
    const seg = cols[segIdx] || '';
    const type = cols[typeIdx] || '';
    if (name.toUpperCase().includes('NIFTY') && ts.endsWith('CE') && !name.includes('BANK') && !name.includes('FIN')) {
      console.log(`seg="${seg}" type="${type}" name="${name}" ts="${ts}"`);
      found++;
    }
  }

  // 3. Find FINNIFTY option
  console.log('\n=== FINNIFTY/NIFTYFIN options ===');
  found = 0;
  for (let i = 1; i < lines.length && found < 3; i++) {
    const up = lines[i].toUpperCase();
    if ((up.includes('NIFTYFIN') || up.includes('FIN SERVICE')) && (lines[i].endsWith('CE') || lines[i].endsWith('PE'))) {
      const cols = lines[i].split(',');
      console.log(`seg="${cols[segIdx]}" type="${cols[typeIdx]}" name="${cols[nameIdx]}" ts="${cols[tsIdx]}"`);
      found++;
    }
  }
  if (found === 0) {
    // Try broader search
    for (let i = 1; i < lines.length; i++) {
      const up = lines[i].toUpperCase();
      if (up.includes('NIFTYFIN') || up.includes('FIN SERVICE')) {
        const cols = lines[i].split(',');
        console.log(`BROADER: seg="${cols[segIdx]}" type="${cols[typeIdx]}" name="${cols[nameIdx]}" ts="${cols[tsIdx]}"`);
      }
    }
  }

  // 4. Find HINDUNILVR option
  console.log('\n=== HINDUNILVR options ===');
  found = 0;
  for (let i = 1; i < lines.length && found < 3; i++) {
    const up = lines[i].toUpperCase();
    if ((up.includes('HINDUNILVR') || up.includes('HINDUSTAN UNILEVER')) && (lines[i].endsWith('CE') || lines[i].endsWith('PE'))) {
      const cols = lines[i].split(',');
      console.log(`seg="${cols[segIdx]}" type="${cols[typeIdx]}" name="${cols[nameIdx]}" ts="${cols[tsIdx]}"`);
      found++;
    }
  }

  // 5. Find BAJFINANCE option
  console.log('\n=== BAJFINANCE options ===');
  found = 0;
  for (let i = 1; i < lines.length && found < 3; i++) {
    const up = lines[i].toUpperCase();
    if ((up.includes('BAJFINANCE') || up.includes('BAJAJ FINANCE')) && (lines[i].endsWith('CE') || lines[i].endsWith('PE'))) {
      const cols = lines[i].split(',');
      console.log(`seg="${cols[segIdx]}" type="${cols[typeIdx]}" name="${cols[nameIdx]}" ts="${cols[tsIdx]}"`);
      found++;
    }
  }
}

main().catch(console.error);
