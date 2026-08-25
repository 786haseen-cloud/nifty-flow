/**
 * Standalone test: download Kite CSV, parse with the new normalization + segment
 * filter, and verify NIFTY/BANKNIFTY options are found.
 *
 * Run: node /home/z/my-project/scripts/test-option-lookup.js
 *
 * This is a pure Node script (no Next.js), so it can run anywhere to verify the
 * fix works end-to-end against the real Kite API.
 */
const KITE_API_KEY = process.env.KITE_API_KEY || 'zp3rxsrw5m15rk4h';
const KITE_ACCESS_TOKEN = process.env.KITE_ACCESS_TOKEN || 'y05hgvxtwbQkAmhBLpb290bAWd6smrYj';
const KITE_BASE = 'https://api.kite.trade';

function kiteHeaders() {
  return {
    'Authorization': `token ${KITE_API_KEY}:${KITE_ACCESS_TOKEN}`,
    'X-Kite-Version': '3',
  };
}

const KNOWN_FNO_INDICES = new Set([
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX',
  'MIDCPNIFTY', 'NIFTY MID SELECT', 'NIFTY PSE',
]);

function normalizeInstrumentType(rawType, segment, name) {
  if (rawType === 'OPTIDX' || rawType === 'OPTSTK' || rawType === 'FUTIDX' || rawType === 'FUTSTK' ||
      rawType === 'EQ' || rawType === 'INDEX') {
    return rawType;
  }
  const isIndex = KNOWN_FNO_INDICES.has(name.toUpperCase());
  if (rawType === 'CE' || rawType === 'PE') return isIndex ? 'OPTIDX' : 'OPTSTK';
  if (rawType === 'FUT') return isIndex ? 'FUTIDX' : 'FUTSTK';
  return rawType;
}

async function getInstruments() {
  const res = await fetch(`${KITE_BASE}/instruments`, { headers: kiteHeaders() });
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, await res.text());
    return [];
  }
  const text = await res.text();
  const lines = text.trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 12) continue;
    const rawType = cols[9] || '';
    const segment = cols[10] || '';
    const rawName = cols[3] || '';
    const name = rawName.startsWith('"') && rawName.endsWith('"') ? rawName.slice(1, -1) : rawName;
    out.push({
      instrumentToken: parseInt(cols[0]) || 0,
      tradingSymbol: cols[2],
      name,
      exchange: cols[11] || '',
      segment,
      instrumentType: normalizeInstrumentType(rawType, segment, name),
      strike: parseFloat(cols[6]) || 0,
      lotSize: parseInt(cols[8]) || 1,
      expiry: cols[5] || '',
    });
  }
  return out;
}

// Replicates the FIXED getOptionInstruments logic — uses spec.segment (NFO/BFO)
function findOptions(allInstruments, spec, spotPrice, strikesAround = 5) {
  // OLD BUG: const instruments = allInstruments.filter(i => i.exchange === spec.exchange)  // 'NSE' = WRONG
  // FIX:     const instruments = allInstruments.filter(i => i.exchange === spec.segment)   // 'NFO' = CORRECT
  const instruments = allInstruments.filter(i => i.exchange === spec.segment);
  console.log(`   [${spec.symbol}] Instruments on exchange='${spec.segment}': ${instruments.length}`);

  const symUpper = spec.symbol.toUpperCase();
  const indexOptions = instruments.filter(i =>
    i.segment.startsWith(spec.segment) &&     // 'NFO-OPT'.startsWith('NFO') = true
    i.instrumentType === spec.instrumentType && // 'OPTIDX' === 'OPTIDX' ✓
    (i.name.toUpperCase().includes(symUpper) ||
     i.tradingSymbol.toUpperCase().includes(symUpper))
  );
  console.log(`   [${spec.symbol}] Options matching '${spec.symbol}': ${indexOptions.length}`);
  if (indexOptions.length === 0) return [];

  const expiries = [...new Set(indexOptions.map(i => i.expiry))].sort();
  const today = new Date();
  const nearestExpiry = expiries.find(e => new Date(e) >= new Date(today.toDateString())) || expiries[0];
  const expiryOptions = indexOptions.filter(i => i.expiry === nearestExpiry);
  console.log(`   [${spec.symbol}] Nearest expiry: ${nearestExpiry}, options at this expiry: ${expiryOptions.length}`);

  const strikes = [...new Set(expiryOptions.map(i => i.strike))].sort((a, b) => a - b);
  let strikeStep = 50;
  if (strikes.length >= 2) {
    const gaps = {};
    for (let i = 1; i < strikes.length; i++) {
      const gap = Math.round(strikes[i] - strikes[i - 1]);
      gaps[gap] = (gaps[gap] || 0) + 1;
    }
    strikeStep = parseInt(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]) || 50;
  }
  console.log(`   [${spec.symbol}] Strike step: ${strikeStep}, total strikes available: ${strikes.length}`);

  const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;
  const strikeList = Array.from({ length: strikesAround * 2 + 1 }, (_, i) =>
    atmStrike - strikesAround * strikeStep + i * strikeStep
  );
  const filtered = expiryOptions.filter(i => strikeList.includes(i.strike));
  console.log(`   [${spec.symbol}] Spot=${spotPrice}, ATM=${atmStrike}, strikesAround=${strikesAround}, matched: ${filtered.length}`);
  return filtered;
}

(async () => {
  console.log('=== Downloading Kite instruments CSV ===');
  const all = await getInstruments();
  console.log(`Total instruments: ${all.length}`);

  const byExchange = {};
  for (const i of all) byExchange[i.exchange] = (byExchange[i.exchange] || 0) + 1;
  console.log('By exchange:', byExchange);

  const byType = {};
  for (const i of all) byType[i.instrumentType] = (byType[i.instrumentType] || 0) + 1;
  console.log('By instrument type:', byType);

  const specs = [
    { symbol: 'NIFTY',     exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX' },
    { symbol: 'BANKNIFTY', exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX' },
    { symbol: 'FINNIFTY',  exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTIDX' },
    { symbol: 'SENSEX',    exchange: 'BSE', segment: 'BFO', instrumentType: 'OPTIDX' },
    { symbol: 'RELIANCE',  exchange: 'NSE', segment: 'NFO', instrumentType: 'OPTSTK' },
  ];

  // Spot prices — note these may be stale by the time you run the script.
  // The dashboard fetches real spot from Kite quote API, so it'll always have current values.
  const spotPrices = {
    NIFTY: 24334.55,
    BANKNIFTY: 51200,
    FINNIFTY: 23100,
    SENSEX: 80450,
    RELIANCE: 1300,
  };

  console.log('\n=== Testing option lookup per symbol ===');
  for (const spec of specs) {
    console.log(`\n[${spec.symbol}] (spec.segment='${spec.segment}', spec.exchange='${spec.exchange}')`);
    const found = findOptions(all, spec, spotPrices[spec.symbol], 5);
    if (found.length > 0) {
      console.log(`   ✓ FOUND ${found.length} options. First 3:`);
      for (const inst of found.slice(0, 3)) {
        console.log(`     - ${inst.tradingSymbol} (token=${inst.instrumentToken}, strike=${inst.strike}, lot=${inst.lotSize}, expiry=${inst.expiry})`);
      }
    } else {
      console.log(`   ✗ NOT FOUND`);
    }
  }

  console.log('\n=== Comparing OLD (broken) vs NEW (fixed) lookup for NIFTY ===');
  const nseInstruments = all.filter(i => i.exchange === 'NSE');
  const nfoInstruments = all.filter(i => i.exchange === 'NFO');
  console.log(`OLD: getInstruments('NSE') returned ${nseInstruments.length} instruments`);
  console.log(`     → NIFTY options found: ${nseInstruments.filter(i => i.instrumentType === 'OPTIDX' && i.name.includes('NIFTY')).length}  (this was the bug)`);
  console.log(`NEW: getInstruments('NFO') returned ${nfoInstruments.length} instruments`);
  console.log(`     → NIFTY options found: ${nfoInstruments.filter(i => i.instrumentType === 'OPTIDX' && i.name.includes('NIFTY') && !i.name.includes('BANK') && !i.name.includes('FIN')).length}  (fix)`);
})();
