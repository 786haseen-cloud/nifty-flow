// ============================================================
// Demo Data Generator — Realistic Indian Market Data
// ============================================================

import type {
  InstrumentData,
  VIXData,
  OptionStrike,
  InstitutionalFlow,
  BigTrade,
  TimeSeriesPoint,
  OIBuildupEvent,
  DailySummary,
  BuiltUpType,
} from './types';

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Instrument Data ----

const INSTRUMENT_CONFIGS: Record<string, {
  name: string; type: 'INDEX' | 'STOCK'; basePrice: number; strikeStep: number;
}> = {
  NIFTY: { name: 'Nifty 50', type: 'INDEX', basePrice: 24350, strikeStep: 50 },
  BANKNIFTY: { name: 'Bank Nifty', type: 'INDEX', basePrice: 51200, strikeStep: 100 },
  FINNIFTY: { name: 'Fin Nifty', type: 'INDEX', basePrice: 23800, strikeStep: 50 },
  MIDCPNIFTY: { name: 'Midcap Nifty', type: 'INDEX', basePrice: 12450, strikeStep: 50 },
  RELIANCE: { name: 'Reliance Industries', type: 'STOCK', basePrice: 1432, strikeStep: 20 },
  TCS: { name: 'Tata Consultancy', type: 'STOCK', basePrice: 3845, strikeStep: 20 },
  HDFCBANK: { name: 'HDFC Bank', type: 'STOCK', basePrice: 1680, strikeStep: 10 },
  INFY: { name: 'Infosys', type: 'STOCK', basePrice: 1567, strikeStep: 10 },
  ICICIBANK: { name: 'ICICI Bank', type: 'STOCK', basePrice: 1245, strikeStep: 10 },
  HINDUNILVR: { name: 'Hindustan Unilever', type: 'STOCK', basePrice: 2534, strikeStep: 20 },
  SBIN: { name: 'State Bank of India', type: 'STOCK', basePrice: 812, strikeStep: 5 },
  BHARTIARTL: { name: 'Bharti Airtel', type: 'STOCK', basePrice: 1640, strikeStep: 10 },
  ITC: { name: 'ITC Limited', type: 'STOCK', basePrice: 458, strikeStep: 5 },
  KOTAKBANK: { name: 'Kotak Mahindra Bank', type: 'STOCK', basePrice: 1935, strikeStep: 10 },
  LT: { name: 'Larsen & Toubro', type: 'STOCK', basePrice: 3560, strikeStep: 20 },
  AXISBANK: { name: 'Axis Bank', type: 'STOCK', basePrice: 1178, strikeStep: 10 },
  BAJFINANCE: { name: 'Bajaj Finance', type: 'STOCK', basePrice: 7245, strikeStep: 50 },
  ASIANPAINT: { name: 'Asian Paints', type: 'STOCK', basePrice: 2890, strikeStep: 20 },
  MARUTI: { name: 'Maruti Suzuki', type: 'STOCK', basePrice: 12450, strikeStep: 50 },
};

export function generateDemoInstrument(symbol: string): InstrumentData {
  const config = INSTRUMENT_CONFIGS[symbol] || {
    name: symbol, type: 'STOCK' as const, basePrice: 1000, strikeStep: 10,
  };

  const changePct = rand(-2, 2);
  const ltp = round2(config.basePrice * (1 + changePct / 100));
  const change = round2(ltp - config.basePrice);
  const atmStrike = Math.round(ltp / config.strikeStep) * config.strikeStep;

  // Generate 11 strikes (ATM ± 5)
  const strikes: OptionStrike[] = [];
  let totalCallOI = 0;
  let totalPutOI = 0;

  for (let i = -5; i <= 5; i++) {
    const strike = atmStrike + i * config.strikeStep;
    const isATM = i === 0;
    const isITMCall = strike < ltp;
    const isITMPut = strike > ltp;

    // OI distribution: highest near ATM, falls off
    const distanceFactor = Math.exp(-0.3 * Math.abs(i));
    const baseOI = config.type === 'INDEX' ? 50000 : 15000;
    const callOI = Math.round(baseOI * distanceFactor * rand(0.8, 1.5));
    const putOI = Math.round(baseOI * distanceFactor * rand(0.8, 1.5));

    totalCallOI += callOI;
    totalPutOI += putOI;

    const callLTP = isITMCall
      ? round2(Math.max(ltp - strike, 0) + rand(5, 50) * Math.exp(-0.5 * Math.abs(i)))
      : round2(rand(5, 200) * Math.exp(-0.6 * Math.abs(i)));
    const putLTP = isITMPut
      ? round2(Math.max(strike - ltp, 0) + rand(5, 50) * Math.exp(-0.5 * Math.abs(i)))
      : round2(rand(5, 200) * Math.exp(-0.6 * Math.abs(i)));

    const callIV = round2(rand(12, 25) + Math.abs(i) * 1.5);
    const putIV = round2(rand(12, 25) + Math.abs(i) * 1.5);

    // Built-up type determination
    const callOIChange = Math.round(rand(-5000, 15000) * (isATM ? 2 : 1));
    const putOIChange = Math.round(rand(-5000, 15000) * (isATM ? 2 : 1));

    let builtUpType: BuiltUpType = 'None';
    if (callOIChange > 3000 && callLTP > 0) builtUpType = callLTP > putLTP ? 'Long Build-up' : 'Short Build-up';
    else if (callOIChange < -3000) builtUpType = 'Long Unwinding';
    else if (putOIChange > 3000 && putLTP > 0) builtUpType = putLTP > callLTP ? 'Short Covering' : 'Short Build-up';
    else if (putOIChange < -3000) builtUpType = 'Long Unwinding';

    strikes.push({
      strike,
      callLTP: Math.max(callLTP, 0.05),
      callOI,
      callOIChange,
      callVolume: Math.round(callOI * rand(0.05, 0.3)),
      callIV,
      putLTP: Math.max(putLTP, 0.05),
      putOI,
      putOIChange,
      putVolume: Math.round(putOI * rand(0.05, 0.3)),
      putIV,
      builtUpType,
    });
  }

  const pcr = round2(totalPutOI / totalCallOI);
  const maxPain = round2(atmStrike + rand(-2, 2) * config.strikeStep);
  const ivSkew = round2(rand(-4, 4));
  const futuresPremium = round2(ltp + rand(-10, 30));
  const futuresOI = Math.round(rand(1, 5) * 1000000);
  const futuresOIChange = Math.round(rand(-200000, 300000));

  return {
    symbol,
    name: config.name,
    type: config.type,
    ltp,
    change,
    changePct: round2(changePct),
    atmStrike,
    strikes,
    totalCallOI,
    totalPutOI,
    pcr,
    maxPain,
    ivSkew,
    spotPrice: ltp,
    futuresPremium,
    futuresOI,
    futuresOIChange,
  };
}

// ---- VIX Data ----
export function generateDemoVIX(): VIXData {
  const value = round2(rand(13, 22));
  const open = round2(rand(13, 22));
  const prevClose = round2(rand(13, 22));
  const change = round2(value - prevClose);
  const changePct = round2((change / prevClose) * 100);

  let status: VIXData['status'] = 'normal';
  if (value > 30) status = 'extreme';
  else if (value > 25) status = 'high';
  else if (value > 20) status = 'elevated';
  else if (value < 12) status = 'low';

  return {
    value,
    change,
    changePct,
    dayHigh: round2(value + rand(1, 4)),
    dayLow: round2(value - rand(1, 3)),
    open,
    prevClose,
    status,
  };
}

// ---- Institutional Flow ----
export function generateDemoInstitutionalFlow(): InstitutionalFlow {
  const today = new Date().toISOString().split('T')[0];

  // FII: typically net seller in cash, mixed in derivatives
  const fiiCashBuy = round2(rand(2000, 5000));
  const fiiCashSell = round2(rand(3000, 8000));
  const fiiCashNet = round2(fiiCashBuy - fiiCashSell);

  const fiiFutBuy = round2(rand(3000, 8000));
  const fiiFutSell = round2(rand(3000, 8000));
  const fiiFutNet = round2(fiiFutBuy - fiiFutSell);

  const fiiOptCallBuy = round2(rand(5000, 15000));
  const fiiOptCallSell = round2(rand(5000, 15000));
  const fiiOptCallNet = round2(fiiOptCallBuy - fiiOptCallSell);

  const fiiOptPutBuy = round2(rand(3000, 10000));
  const fiiOptPutSell = round2(rand(3000, 10000));
  const fiiOptPutNet = round2(fiiOptPutBuy - fiiOptPutSell);

  const fiiTotalNet = round2(fiiCashNet + fiiFutNet + fiiOptCallNet + fiiOptPutNet);

  // DII: typically net buyer in cash
  const diiCashBuy = round2(rand(3000, 7000));
  const diiCashSell = round2(rand(1000, 4000));
  const diiCashNet = round2(diiCashBuy - diiCashSell);

  const diiFutBuy = round2(rand(500, 3000));
  const diiFutSell = round2(rand(500, 3000));
  const diiFutNet = round2(diiFutBuy - diiFutSell);

  const diiOptCallBuy = round2(rand(500, 3000));
  const diiOptCallSell = round2(rand(500, 3000));
  const diiOptCallNet = round2(diiOptCallBuy - diiOptCallSell);

  const diiOptPutBuy = round2(rand(300, 2000));
  const diiOptPutSell = round2(rand(300, 2000));
  const diiOptPutNet = round2(diiOptPutBuy - diiOptPutSell);

  const diiTotalNet = round2(diiCashNet + diiFutNet + diiOptCallNet + diiOptPutNet);

  // Dominant player
  const absFii = Math.abs(fiiTotalNet);
  const absDii = Math.abs(diiTotalNet);
  const dominantPlayer = absFii > absDii * 1.5 ? 'FII' : absDii > absFii * 1.5 ? 'DII' : 'NONE';

  // Dominant segment
  const segments = [
    { name: 'cash' as const, val: Math.abs(fiiCashNet + diiCashNet) },
    { name: 'futures' as const, val: Math.abs(fiiFutNet + diiFutNet) },
    { name: 'options' as const, val: Math.abs(fiiOptCallNet + fiiOptPutNet + diiOptCallNet + diiOptPutNet) },
  ];
  segments.sort((a, b) => b.val - a.val);
  const dominantSegment = segments[0].val > segments[1].val * 2 ? segments[0].name : 'mixed';

  // Stance
  const totalNet = fiiTotalNet + diiTotalNet;
  const stance = totalNet > 1000 ? 'bullish' : totalNet < -1000 ? 'bearish' : 'neutral';

  return {
    date: today,
    fii: {
      cashBuy: fiiCashBuy,
      cashSell: fiiCashSell,
      cashNet: fiiCashNet,
      futBuy: fiiFutBuy,
      futSell: fiiFutSell,
      futNet: fiiFutNet,
      optCallBuy: fiiOptCallBuy,
      optCallSell: fiiOptCallSell,
      optCallNet: fiiOptCallNet,
      optPutBuy: fiiOptPutBuy,
      optPutSell: fiiOptPutSell,
      optPutNet: fiiOptPutNet,
      totalNet: fiiTotalNet,
    },
    dii: {
      cashBuy: diiCashBuy,
      cashSell: diiCashSell,
      cashNet: diiCashNet,
      futBuy: diiFutBuy,
      futSell: diiFutSell,
      futNet: diiFutNet,
      optCallBuy: diiOptCallBuy,
      optCallSell: diiOptCallSell,
      optCallNet: diiOptCallNet,
      optPutBuy: diiOptPutBuy,
      optPutSell: diiOptPutSell,
      optPutNet: diiOptPutNet,
      totalNet: diiTotalNet,
    },
    dominantPlayer,
    dominantSegment,
    stance,
  };
}

// ---- Big Trades of the Day ----
const TRADE_INSTRUMENTS = [
  'NIFTY 24300 CE', 'NIFTY 24400 PE', 'NIFTY 24350 CE', 'NIFTY 24200 PE',
  'BANKNIFTY 51200 CE', 'BANKNIFTY 51300 PE', 'BANKNIFTY 51100 CE',
  'RELIANCE FUT', 'HDFCBANK FUT', 'TCS FUT', 'ICICIBANK FUT',
  'NIFTY 24250 CE', 'NIFTY 24300 PE', 'NIFTY 24400 CE',
  'FINNIFTY 23800 CE', 'FINNIFTY 23900 PE',
  'SBIN FUT', 'BHARTIARTL FUT', 'INFY FUT',
  'NIFTY 24150 PE',
];

export function generateDemoBigTrades(): BigTrade[] {
  const trades: BigTrade[] = [];
  const now = new Date();
  const marketOpen = new Date(now);
  marketOpen.setHours(9, 15, 0, 0);

  for (let i = 0; i < 20; i++) {
    const minutesSinceOpen = randInt(0, 375); // 9:15 to 15:30 = 375 min
    const tradeTime = new Date(marketOpen.getTime() + minutesSinceOpen * 60000);

    const instrument = TRADE_INSTRUMENTS[i % TRADE_INSTRUMENTS.length];
    const isOption = instrument.includes('CE') || instrument.includes('PE');
    const tradeType: BigTrade['tradeType'] = isOption
      ? (instrument.includes('CE') ? 'CE' : 'PE')
      : 'FUTURE';
    const action: BigTrade['action'] = Math.random() > 0.5 ? 'BUY' : 'SELL';

    const quantity = isOption ? randInt(500, 25000) * 25 : randInt(10000, 500000);
    const value = round2(rand(5, 50)); // in Crores
    const strike = isOption ? parseInt(instrument.match(/\d+/)?.[0] || '0') : undefined;
    const ltp = round2(rand(50, 500));

    let impact: BigTrade['impact'] = 'Light';
    if (value > 30) impact = 'Heavy';
    else if (value > 15) impact = 'Moderate';

    trades.push({
      timestamp: tradeTime,
      instrument,
      tradeType,
      action,
      quantity,
      value,
      strike,
      ltp,
      impact,
    });
  }

  // Sort by value descending
  trades.sort((a, b) => b.value - a.value);
  return trades;
}

// ---- Time Series for Divergence Chart ----
export function generateDemoTimeSeries(): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  const times = [
    '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00',
    '11:15', '11:30', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00',
    '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45', '15:00',
    '15:15', '15:30',
  ];

  let price = 24350;
  let score = 50;

  for (const time of times) {
    // Price random walk
    price += rand(-30, 30);
    price = Math.max(24100, Math.min(24600, price));

    // Score random walk (sometimes diverges from price)
    score += rand(-8, 8);
    score = Math.max(10, Math.min(90, score));

    // Detect divergence
    const priceChange = rand(-1, 1);
    const scoreChange = rand(-1, 1);
    let divergence: TimeSeriesPoint['divergence'] = undefined;

    if (priceChange > 0 && scoreChange < -0.3) divergence = 'bearish';
    else if (priceChange < 0 && scoreChange > 0.3) divergence = 'bullish';
    else if (Math.abs(priceChange) > 0 && Math.sign(priceChange) === Math.sign(scoreChange)) divergence = 'confirmed';

    points.push({
      time,
      niftyPrice: round2(price),
      signalScore: round2(score),
      divergence,
    });
  }

  return points;
}

// ---- OI Buildup Events ----
export function generateDemoOIBuildupEvents(): OIBuildupEvent[] {
  const events: OIBuildupEvent[] = [];
  const times = [
    '09:22', '09:38', '09:55', '10:12', '10:30', '10:48', '11:05', '11:23',
    '11:42', '12:00', '12:18', '12:37', '13:00', '13:18', '13:37', '13:55',
    '14:12', '14:30', '14:48', '15:05',
  ];

  const strikes = [24100, 24200, 24250, 24300, 24350, 24400, 24450];
  const builtUpTypes = ['Call Writing', 'Put Writing', 'Call Buying', 'Put Buying', 'Call Unwinding', 'Put Unwinding'];

  for (let i = 0; i < 20; i++) {
    const oiChange = randInt(5000, 35000) * (Math.random() > 0.3 ? 1 : -1);
    const absChange = Math.abs(oiChange);
    let significance: OIBuildupEvent['significance'] = 'low';
    if (absChange > 25000) significance = 'high';
    else if (absChange > 12000) significance = 'medium';

    events.push({
      time: times[i],
      instrument: 'NIFTY',
      strike: strikes[randInt(0, strikes.length - 1)],
      optionType: Math.random() > 0.5 ? 'CE' : 'PE',
      oiChange,
      builtUpType: builtUpTypes[randInt(0, builtUpTypes.length - 1)],
      significance,
    });
  }

  return events;
}

// ---- Daily Summary (historical) ----
export function generateDemoDailySummaries(days: number = 5): DailySummary[] {
  const summaries: DailySummary[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const totalCallOI = Math.round(rand(2000000, 5000000));
    const totalPutOI = Math.round(rand(2000000, 5000000));

    summaries.push({
      date: dateStr,
      instrument: 'NIFTY',
      totalOI: totalCallOI + totalPutOI,
      totalVolume: Math.round(rand(1000000, 3000000)),
      callOI: totalCallOI,
      putOI: totalPutOI,
      pcr: round2(totalPutOI / totalCallOI),
      vixOpen: round2(rand(13, 22)),
      vixHigh: round2(rand(18, 28)),
      vixLow: round2(rand(10, 16)),
      vixClose: round2(rand(13, 22)),
      signals: i === 0 ? 'Bullish' : rand(0, 1) > 0.5 ? 'Bullish' : 'Bearish',
      summary: `Day ${i + 1}: ${rand(0, 1) > 0.5 ? 'FII selling absorbed by DII' : 'DII selling met by FII buying'}`,
      fiiCashNet: round2(rand(-4000, -500)),
      diiCashNet: round2(rand(500, 3000)),
      fiiFutNet: round2(rand(-2000, 2000)),
      diiFutNet: round2(rand(-500, 500)),
      fiiOptNet: round2(rand(-3000, 3000)),
      diiOptNet: round2(rand(-500, 500)),
    });
  }

  return summaries;
}

// All instruments at once
export function generateAllDemoInstruments(): InstrumentData[] {
  const instruments: InstrumentData[] = [];
  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY',
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR',
    'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT', 'AXISBANK',
    'BAJFINANCE', 'ASIANPAINT', 'MARUTI'];

  for (const symbol of symbols) {
    instruments.push(generateDemoInstrument(symbol));
  }
  return instruments;
}
