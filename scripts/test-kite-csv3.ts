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
  const exchIdx = header.indexOf('exchange');

  // Check how the code parses (see getInstruments in kite-api.ts)
  // Count options per segment
  console.log('=== Option counts by segment ===');
  const segCounts: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const seg = cols[segIdx] || '';
    const type = cols[typeIdx] || '';
    if (type === 'CE' || type === 'PE') {
      segCounts[seg] = (segCounts[seg] || 0) + 1;
    }
  }
  Object.entries(segCounts).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  // Now search for each problem symbol in NFO-OPT
  const searches = ['NIFTYFIN', 'FIN SERVICE', 'HINDU', 'UNILEVER', 'BAJAJ', 'BAJFIN'];

  for (const search of searches) {
    const sup = search.toUpperCase();
    let count = 0;
    let samples: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(segIdx, typeIdx, nameIdx, tsIdx)) continue;
      const seg = (cols[segIdx] || '').trim();
      const type = (cols[typeIdx] || '').trim();
      const name = (cols[nameIdx] || '').toUpperCase().trim();
      const ts = (cols[tsIdx] || '').toUpperCase().trim();

      if (seg === 'NFO-OPT' && (type === 'CE' || type === 'PE')) {
        if (name.includes(sup) || ts.includes(sup)) {
          count++;
          if (samples.length < 2) {
            samples.push(`  name="${name}" ts="${ts}"`);
          }
        }
      }
    }
    if (count > 0) {
      console.log(`\n"${search}" in NFO-OPT: ${count} matches`);
      samples.forEach(s => console.log(s));
    } else {
      console.log(`\n"${search}" in NFO-OPT: 0 matches`);
    }
  }

  // Also check: does the existing code's normalization work?
  // The code does: if type is CE/PE, normalize to OPTIDX/OPTSTK
  // and checks segment.startsWith('NFO')
  console.log('\n=== Does existing code logic find them? ===');
  const testSymbols = [
    { sym: 'NIFTY', aliases: [] },
    { sym: 'FINNIFTY', aliases: ['NIFTYFIN', 'NIFTY FIN SERVICE'] },
    { sym: 'HINDUNILVR', aliases: ['HINDUSTAN UNILEVER'] },
    { sym: 'BAJFINANCE', aliases: ['BAJAJ FINANCE'] },
    { sym: 'RELIANCE', aliases: [] },
  ];

  for (const test of testSymbols) {
    const terms = [test.sym, ...test.aliases].map(s => s.toUpperCase());
    let count = 0;
    let sample = '';
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(segIdx, typeIdx, nameIdx, tsIdx)) continue;
      const seg = (cols[segIdx] || '').trim();
      const type = (cols[typeIdx] || '').trim();
      const name = (cols[nameIdx] || '').toUpperCase().trim();
      const ts = (cols[tsIdx] || '').toUpperCase().trim();

      // SIMULATE existing code: segment.startsWith('NFO') && instrumentType matches
      // After normalization: CE/PE → OPTIDX/OPTSTK
      const normalizedType = (type === 'CE' || type === 'PE') ? 'OPTIDX' : type;
      if (seg.startsWith('NFO') && normalizedType === 'OPTIDX') {
        if (terms.some(t => name.includes(t) || ts.includes(t))) {
          count++;
          if (!sample) sample = `name="${name}" ts="${ts}" seg="${seg}"`;
        }
      }
    }
    console.log(`${test.sym}: ${count} → ${count > 0 ? 'OK' : 'FAIL'} ${sample}`);
  }
}

main().catch(console.error);
