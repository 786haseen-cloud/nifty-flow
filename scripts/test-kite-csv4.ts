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
  const tokenIdx = header.indexOf('instrument_token');
  const tsIdx = header.indexOf('tradingsymbol');
  const nameIdx = header.indexOf('name');
  const segIdx = header.indexOf('segment');
  const typeIdx = header.indexOf('instrument_type');
  const exchIdx = header.indexOf('exchange');

  // 1. Check actual tokens for indices
  console.log('=== INDEX TOKENS (EQ/INDICES) ===');
  const indexNames = ['NIFTY', 'NIFTY BANK', 'NIFTY FIN SERVICE', 'SENSEX'];
  for (const iname of indexNames) {
    for (const line of lines) {
      const cols = line.split(',');
      const name = (cols[nameIdx] || '').trim();
      const seg = (cols[segIdx] || '').trim();
      const exch = (cols[exchIdx] || '').trim();
      const token = (cols[tokenIdx] || '').trim();
      const ts = (cols[tsIdx] || '').trim();
      if (name === iname && (seg === 'INDICES' || seg === 'NSE' || seg === 'BSE') && (cols[typeIdx] || '').trim() === 'EQ') {
        console.log(`${iname}: token=${token} exchange=${exch} seg=${seg} ts=${ts}`);
      }
    }
  }

  // 2. Check HINDUNILVR exchange listing
  console.log('\n=== HINDUNILVR ALL EXCHANGES ===');
  for (const line of lines) {
    const cols = line.split(',');
    const ts = (cols[tsIdx] || '').trim();
    const seg = (cols[segIdx] || '').trim();
    const type = (cols[typeIdx] || '').trim();
    const exch = (cols[exchIdx] || '').trim();
    if (ts.toUpperCase() === 'HINDUNILVR' && type === 'EQ') {
      console.log(`seg=${seg} exchange=${exch} token=${cols[tokenIdx]}`);
    }
  }

  // 3. Check BAJFINANCE exchange listing
  console.log('\n=== BAJFINANCE ALL EXCHANGES ===');
  for (const line of lines) {
    const cols = line.split(',');
    const ts = (cols[tsIdx] || '').trim();
    const seg = (cols[segIdx] || '').trim();
    const type = (cols[typeIdx] || '').trim();
    const exch = (cols[exchIdx] || '').trim();
    if (ts.toUpperCase() === 'BAJFINANCE' && type === 'EQ') {
      console.log(`seg=${seg} exchange=${exch} token=${cols[tokenIdx]}`);
    }
  }

  // 4. Check TATAMOTORS / TMCV
  console.log('\n=== TATAMOTORS/TMCV ALL EXCHANGES ===');
  for (const line of lines) {
    const cols = line.split(',');
    const ts = (cols[tsIdx] || '').trim();
    const seg = (cols[segIdx] || '').trim();
    const type = (cols[typeIdx] || '').trim();
    const exch = (cols[exchIdx] || '').trim();
    if ((ts.toUpperCase().includes('TATAMOTOR') || ts.toUpperCase().includes('TMCV')) && type === 'EQ') {
      console.log(`ts=${ts} seg=${seg} exchange=${exch} token=${cols[tokenIdx]}`);
    }
  }

  // 5. Check if there's NSE HINDUNILVR at all
  console.log('\n=== HINDUNILVR on NSE (any type) ===');
  let found = 0;
  for (const line of lines) {
    const cols = line.split(',');
    const ts = (cols[tsIdx] || '').trim();
    const exch = (cols[exchIdx] || '').trim();
    if (ts.toUpperCase().includes('HINDU') && exch === 'NSE') {
      console.log(`ts=${ts} seg=${cols[segIdx]} type=${cols[typeIdx]}`);
      found++;
    }
  }
  if (found === 0) console.log('  (none)');
}

main().catch(console.error);
