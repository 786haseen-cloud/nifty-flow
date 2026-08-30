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

  // Strip quotes from name field for comparison
  const strip = (s: string) => s.replace(/^"|"$/g, '').trim();

  console.log('=== INDEX TOKENS (INDICES/EQ segments) ===');
  const searchNames = ['NIFTY', 'NIFTY BANK', 'NIFTY FIN SERVICE', 'SENSEX'];
  for (const sname of searchNames) {
    for (const line of lines) {
      const cols = line.split(',');
      const name = strip(cols[nameIdx] || '');
      const seg = strip(cols[segIdx] || '');
      const type = strip(cols[typeIdx] || '');
      const exch = strip(cols[exchIdx] || '');
      const token = strip(cols[tokenIdx] || '');
      if (name === sname && type === 'EQ') {
        console.log(`"${sname}": token=${token} exchange=${exch} seg=${seg}`);
      }
    }
  }

  // Check hardcoded tokens vs CSV
  console.log('\n=== HARDCODED TOKENS vs CSV ===');
  const hardcoded: Record<string, number> = {
    NIFTY: 256265,
    SENSEX: 265,
    BANKNIFTY: 260105,
    FINNIFTY: 64033,
  };
  for (const [name, oldToken] of Object.entries(hardcoded)) {
    // Find token in CSV
    let csvToken = 0;
    const kiteName = name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'NIFTY BANK' : name === 'FINNIFTY' ? 'NIFTY FIN SERVICE' : name;
    for (const line of lines) {
      const cols = line.split(',');
      const cname = strip(cols[nameIdx] || '');
      const ctype = strip(cols[typeIdx] || '');
      if (cname === kiteName && ctype === 'EQ') {
        csvToken = parseInt(strip(cols[tokenIdx] || ''));
        break;
      }
    }
    const match = csvToken === oldToken ? 'OK' : `MISMATCH (hardcoded=${oldToken} csv=${csvToken})`;
    console.log(`${name}: ${match}`);
  }
}

main().catch(console.error);