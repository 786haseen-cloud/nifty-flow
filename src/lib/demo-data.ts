import {
  type GlobalIndex,
  type GIFTNifty,
  type NextMonthFutures,
  type ExpiryInfo,
  type NewsEvent,
  type VIXData,
  type InstrumentData,
  type OptionStrike,
  type PlayerFlow,
  type DayComparison,
  type BigTradeEntry,
  type NiftyDivergencePoint,
  type InstrumentType,
  type BuiltUpType,
  type NetMoneyFlow,
  type ExchangeStockData,
  type DualExchangeStock,
  GLOBAL_INDICES,
  INDICES,
  TOP_STOCKS,
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

function roundN(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// --- Global Indices ---
export function generateDemoGlobalIndices(): GlobalIndex[] {
  const istHour = new Date().getUTCHours() + 5.5;
  const asiaOpen = istHour >= 6 && istHour < 15;

  return GLOBAL_INDICES.map((idx) => {
    const changePercent = rand(-1.5, 1.5);
    const change = roundN(idx.baseValue * changePercent / 100, idx.baseValue > 10000 ? 0 : 2);
    const value = roundN(idx.baseValue + change, idx.baseValue > 10000 ? 0 : 2);
    const isUS = idx.country === 'US';
    const isEurope = idx.country === 'UK' || idx.country === 'Germany';
    const isAsia = idx.country === 'Japan' || idx.country === 'HK' || idx.country === 'China' || idx.country === 'Korea';

    let status: 'open' | 'closed' | 'pre-market' = 'closed';
    if (isUS) status = istHour >= 19.5 && istHour < 25 ? 'open' : istHour >= 18 ? 'pre-market' : 'closed';
    else if (isEurope) status = istHour >= 13 && istHour < 21.5 ? 'open' : 'closed';
    else if (isAsia) status = asiaOpen ? 'open' : 'closed';

    let impactOnNifty: GlobalIndex['impactOnNifty'];
    if (Math.abs(changePercent) < 0.15) impactOnNifty = changePercent >= 0 ? 'mild_positive' : 'mild_negative';
    else if (Math.abs(changePercent) < 0.4) impactOnNifty = changePercent >= 0 ? 'mild_positive' : 'mild_negative';
    else if (changePercent >= 0) impactOnNifty = 'positive';
    else impactOnNifty = 'negative';

    if (idx.country === 'China') impactOnNifty = changePercent >= 0 ? 'mild_positive' : 'mild_negative';
    if (Math.abs(changePercent) > 0.5 && changePercent > 0) impactOnNifty = 'positive';
    if (Math.abs(changePercent) > 0.5 && changePercent < 0) impactOnNifty = 'negative';

    return {
      name: idx.name,
      country: idx.country,
      value,
      change,
      changePercent: round2(changePercent),
      status,
      impactOnNifty,
    };
  });
}

// --- GIFT Nifty ---
export function generateDemoGIFTNifty(niftyClose: number = 24350): GIFTNifty {
  const change = round2(rand(-80, 80));
  const value = round2(niftyClose + change + rand(10, 30));
  return {
    value,
    change,
    indicativeOpen: round2(value - rand(5, 15)),
  };
}

// --- Next Month Futures ---
export function generateDemoNextMonthFutures(): NextMonthFutures {
  const ltp = round2(rand(24400, 24600));
  const spot = 24350;
  const basis = round2(ltp - spot);
  return {
    symbol: 'NIFTY',
    ltp,
    basis,
    oi: randInt(8000000, 12000000),
    premiumDiscount: basis >= 0 ? 'premium' : 'discount',
  };
}

// --- Expiry Info ---
function getNextExpiry(expiryDay: number, expiryType: 'weekly' | 'monthly'): { date: Date; daysToExpiry: number } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  if (expiryType === 'weekly') {
    // Find next expiryDay (0=Sun, 1=Mon, 2=Tue, ..., 6=Sat)
    const currentDay = istNow.getUTCDay();
    let daysUntil = expiryDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const expiryDate = new Date(istNow);
    expiryDate.setUTCDate(expiryDate.getUTCDate() + daysUntil);
    expiryDate.setUTCHours(15, 30, 0, 0);
    const diff = expiryDate.getTime() - istNow.getTime();
    return { date: expiryDate, daysToExpiry: Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000))) };
  } else {
    // Last specific weekday of current or next month
    const currentMonth = istNow.getUTCMonth();
    const currentYear = istNow.getUTCFullYear();
    const targetDay = expiryDay; // reuse for monthly: -1 means last Tuesday

    const actualDay = expiryDay === -1 ? 2 : expiryDay; // Tuesday = 2 for BankNifty/Finnifty
    // For Bankex: Thursday = 4 (handled separately in caller)

    let month = currentMonth;
    let year = currentYear;

    // Find last Tuesday/Thursday of the month
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    let lastTarget = lastDay.getUTCDay();
    let diff2 = lastTarget - actualDay;
    if (diff2 < 0) diff2 += 7;
    if (diff2 > 6) diff2 -= 7;
    let expiryDayNum = lastDay.getUTCDate() - diff2;
    let expiryDate = new Date(Date.UTC(year, month, expiryDayNum, 15, 30, 0));

    if (expiryDate <= istNow) {
      month++;
      if (month > 11) { month = 0; year++; }
      const lastDay2 = new Date(Date.UTC(year, month + 1, 0));
      let lastTarget2 = lastDay2.getUTCDay();
      let diff3 = lastTarget2 - actualDay;
      if (diff3 < 0) diff3 += 7;
      expiryDayNum = lastDay2.getUTCDate() - diff3;
      expiryDate = new Date(Date.UTC(year, month, expiryDayNum, 15, 30, 0));
    }

    const diffMs = expiryDate.getTime() - istNow.getTime();
    return { date: expiryDate, daysToExpiry: Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000))) };
  }
}

export function generateDemoExpiryInfo(): ExpiryInfo[] {
  const expiryConfigs = [
    ...INDICES,
    { symbol: 'BANKEX', name: 'Bankex', lotSize: 15, strikes: 11, step: 100, expiryDay: -1, expiryType: 'monthly' as const },
  ];

  return expiryConfigs.map((idx) => {
    let daysToExpiry: number;
    let nextExpiryDate: string;

    if (idx.symbol === 'BANKEX') {
      // Last Thursday of month
      const result = getLastWeekdayOfMonth(4);
      daysToExpiry = result.daysToExpiry;
      nextExpiryDate = result.dateStr;
    } else {
      const result = getNextExpiry(idx.expiryDay, idx.expiryType);
      daysToExpiry = result.daysToExpiry;
      nextExpiryDate = result.date.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    return {
      symbol: idx.symbol,
      name: idx.name,
      nextExpiryDate,
      daysToExpiry,
      expiryType: idx.expiryType,
      isSmartMoneyWindow: daysToExpiry <= 2,
    };
  });
}

function getLastWeekdayOfMonth(weekday: number): { dateStr: string; daysToExpiry: number } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  let month = istNow.getUTCMonth();
  let year = istNow.getUTCFullYear();

  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  let diff = lastDay.getUTCDay() - weekday;
  if (diff < 0) diff += 7;
  let dayNum = lastDay.getUTCDate() - diff;
  let expiryDate = new Date(Date.UTC(year, month, dayNum, 15, 30, 0));

  if (expiryDate <= istNow) {
    month++;
    if (month > 11) { month = 0; year++; }
    const lastDay2 = new Date(Date.UTC(year, month + 1, 0));
    let diff2 = lastDay2.getUTCDay() - weekday;
    if (diff2 < 0) diff2 += 7;
    dayNum = lastDay2.getUTCDate() - diff2;
    expiryDate = new Date(Date.UTC(year, month, dayNum, 15, 30, 0));
  }

  const diffMs = expiryDate.getTime() - istNow.getTime();
  const daysToExpiry = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  const dateStr = expiryDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  return { dateStr, daysToExpiry };
}

// --- News Events ---
export function generateDemoNews(): NewsEvent[] {
  const now = new Date();
  const istH = ((now.getUTCHours() + 5) % 24 + 24) % 24;
  const istM = now.getUTCMinutes() + 30;

  const newsPool: Omit<NewsEvent, 'time'>[] = [
    { category: 'geopolitical', headline: 'US-China trade talks resume; tariffs on tech imports discussed', impact: 'high', sentiment: 'bullish' },
    { category: 'government_data', headline: 'India CPI inflation rises to 5.2% vs 4.8% expected', impact: 'high', sentiment: 'bearish' },
    { category: 'policy', headline: 'RBI keeps repo rate unchanged at 6.5%; stance remains focused on withdrawal of accommodation', impact: 'high', sentiment: 'neutral' },
    { category: 'corporate', headline: 'Reliance Q2 results: Net profit up 18% YoY, Jio adds 8M subscribers', impact: 'medium', sentiment: 'bullish' },
    { category: 'global', headline: 'Fed signals potential rate cut in September; dot plot shifts dovish', impact: 'high', sentiment: 'bullish' },
    { category: 'geopolitical', headline: 'Middle East tensions ease as ceasefire talks progress', impact: 'medium', sentiment: 'bullish' },
    { category: 'government_data', headline: 'India IIP grows 4.5% vs 3.2% previous month', impact: 'medium', sentiment: 'bullish' },
    { category: 'policy', headline: 'SEBI tightens F&O trading rules; lot size changes effective next month', impact: 'high', sentiment: 'bearish' },
    { category: 'corporate', headline: 'HDFC Bank Q2: NIM stable at 3.5%; provisions decline QoQ', impact: 'medium', sentiment: 'bullish' },
    { category: 'global', headline: 'ECB holds rates; Lagarde hints at October cut possibility', impact: 'low', sentiment: 'mild_bullish' as NewsEvent['sentiment'], },
    { category: 'geopolitical', headline: 'Russia-Ukraine conflict: New sanctions imposed on energy sector', impact: 'medium', sentiment: 'bearish' },
    { category: 'government_data', headline: 'India WPI inflation at 2.1%; remains in comfort zone', impact: 'low', sentiment: 'bullish' },
    { category: 'corporate', headline: 'TCS wins $2B deal from UK-based financial services firm', impact: 'medium', sentiment: 'bullish' },
    { category: 'global', headline: 'BOJ ends negative rate policy; yen strengthens to 148/USD', impact: 'medium', sentiment: 'neutral' },
    { category: 'policy', headline: 'Govt announces PLI scheme extension for semiconductor manufacturing', impact: 'low', sentiment: 'bullish' },
  ];

  return newsPool.map((n, i) => {
    const h = istH - i;
    const m = istM - randInt(0, 30);
    const timeStr = `${((h % 24) + 24) % 24}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
    return { ...n, time: timeStr, sentiment: n.sentiment === 'mild_bullish' ? 'bullish' : n.sentiment };
  });
}

// --- VIX ---
export function generateDemoVIX(): VIXData {
  const value = round2(rand(12, 22));
  const change = round2(rand(-2, 2));
  const dayOpen = round2(value - change);
  const dayHigh = round2(Math.max(value, dayOpen) + rand(0.5, 2));
  const dayLow = round2(Math.min(value, dayOpen) - rand(0.5, 2));

  let panicLevel: VIXData['panicLevel'];
  if (value < 12) panicLevel = 'calm';
  else if (value < 16) panicLevel = 'normal';
  else if (value < 20) panicLevel = 'elevated';
  else panicLevel = 'panic';

  let trend: VIXData['trend'];
  if (change > 0.3) trend = 'rising';
  else if (change < -0.3) trend = 'falling';
  else trend = 'stable';

  return {
    value,
    change,
    changePercent: round2((change / dayOpen) * 100),
    dayHigh,
    dayLow,
    dayOpen,
    trend,
    percentile: round2(rand(20, 80)),
    panicLevel,
  };
}

// --- Instrument Data ---
export function generateDemoInstrument(
  symbol: string = 'NIFTY',
  name: string = 'Nifty 50',
  type: InstrumentType = 'index',
  basePrice: number = 24350
): InstrumentData {
  const cashChange = round2(rand(-200, 200));
  const cashLTP = round2(basePrice + cashChange);
  const cashChangePercent = round2((cashChange / basePrice) * 100);
  const futureLTP = round2(cashLTP + rand(-20, 40));
  const futureBasis = round2(futureLTP - cashLTP);

  const step = symbol === 'NIFTY' || symbol === 'FINNIFTY' ? 50 : 100;
  const numStrikes = 11;
  const atmStrike = Math.round(cashLTP / step) * step;

  const strikes: OptionStrike[] = [];
  const halfStrikes = Math.floor(numStrikes / 2);

  for (let i = -halfStrikes; i <= halfStrikes; i++) {
    const strike = atmStrike + i * step;
    const isATM = i === 0;
    const distFromATM = Math.abs(i);

    const callITM = strike < cashLTP;
    const putITM = strike > cashLTP;

    const callBase = Math.max(1, cashLTP - strike + rand(-20, 20));
    const callLTP = round2(Math.max(0.5, callBase * Math.exp(-distFromATM * 0.15)));
    const putBase = Math.max(1, strike - cashLTP + rand(-20, 20));
    const putLTP = round2(Math.max(0.5, putBase * Math.exp(-distFromATM * 0.15)));

    const callOI = roundN(rand(50000, 5000000) * (1 + distFromATM * 0.3), 0);
    const putOI = roundN(rand(50000, 5000000) * (1 + distFromATM * 0.3), 0);

    const callIV = round2(rand(10, 25) + distFromATM * 1.5);
    const putIV = round2(rand(10, 25) + distFromATM * 1.5);

    const callDelta = round2(callITM ? rand(0.5, 0.99) : rand(0.01, 0.49));
    const putDelta = round2(-(putITM ? rand(0.5, 0.99) : rand(0.01, 0.49)));

    const callGamma = round2(rand(0.0001, 0.002) * (1 - distFromATM * 0.08));
    const putGamma = round2(rand(0.0001, 0.002) * (1 - distFromATM * 0.08));

    const callTheta = round2(-rand(1, 20) * (1 + distFromATM * 0.05));
    const putTheta = round2(-rand(1, 20) * (1 + distFromATM * 0.05));

    const callVega = round2(rand(5, 30) * (1 - distFromATM * 0.06));
    const putVega = round2(rand(5, 30) * (1 - distFromATM * 0.06));

    let builtUp: BuiltUpType = 'None';
    const callOIChg = roundN(rand(-200000, 500000), 0);
    const putOIChg = roundN(rand(-200000, 500000), 0);

    if (callOIChg > 100000 && callLTP < putLTP) builtUp = 'Call Writing';
    else if (callOIChg > 100000 && callLTP > putLTP) builtUp = 'Call Long Cvr.';
    else if (putOIChg > 100000 && putLTP < callLTP) builtUp = 'Put Writing';
    else if (putOIChg > 100000 && putLTP > callLTP) builtUp = 'Put Long Cvr.';
    else if (putOIChg < -100000) builtUp = 'Put Short Cvr.';

    strikes.push({
      strike,
      callLTP,
      callOI,
      callOIChg,
      callVolume: randInt(1000, 500000),
      callIV,
      callDelta,
      callGamma,
      callTheta,
      callVega,
      callChg: round2(rand(-10, 10)),
      putLTP,
      putOI,
      putOIChg,
      putVolume: randInt(1000, 500000),
      putIV,
      putDelta,
      putGamma,
      putTheta,
      putVega,
      putChg: round2(rand(-10, 10)),
      isATM,
      builtUp,
      callITM,
      putITM,
    });
  }

  const totalCallOI = strikes.reduce((s, k) => s + k.callOI, 0);
  const totalPutOI = strikes.reduce((s, k) => s + k.putOI, 0);
  const pcr = round2(totalPutOI / totalCallOI);

  return {
    symbol,
    name,
    type,
    cashLTP,
    cashChange,
    cashChangePercent,
    futureLTP,
    futureBasis,
    nextMonthFutLTP: round2(futureLTP + rand(30, 80)),
    nextMonthFutBasis: round2(futureLTP + rand(30, 80) - cashLTP),
    atmStrike,
    strikes,
    totalCallOI,
    totalPutOI,
    pcr,
    chgOiPCR: round2(rand(0.5, 1.5)),
    volumePCR: round2(rand(0.4, 1.2)),
    maxPainStrike: atmStrike + (Math.random() > 0.5 ? step : -step),
  };
}

// --- Institutional Flow ---
export function generateDemoInstitutionalFlow(): DayComparison {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const fii: PlayerFlow = {
    player: 'FII',
    cashNet: roundN(rand(-3000, -500), 0),
    futNet: roundN(rand(-1500, 1500), 0),
    optCallNet: roundN(rand(-2000, 500), 0),
    optPutNet: roundN(rand(-500, 2000), 0),
    totalNet: 0,
  };
  fii.totalNet = roundN(fii.cashNet + fii.futNet + fii.optCallNet + fii.optPutNet, 0);

  const propdesk: PlayerFlow = {
    player: 'PROPDESK',
    cashNet: roundN(rand(-200, 200), 0),
    futNet: roundN(rand(-800, 800), 0),
    optCallNet: roundN(rand(-1200, 1200), 0),
    optPutNet: roundN(rand(-1200, 1200), 0),
    totalNet: 0,
  };
  propdesk.totalNet = roundN(propdesk.cashNet + propdesk.futNet + propdesk.optCallNet + propdesk.optPutNet, 0);

  const client: PlayerFlow = {
    player: 'CLIENT',
    cashNet: roundN(rand(500, 3000), 0),
    futNet: roundN(rand(-1000, 1000), 0),
    optCallNet: roundN(rand(500, 3000), 0),
    optPutNet: roundN(rand(-2000, 500), 0),
    totalNet: 0,
  };
  client.totalNet = roundN(client.cashNet + client.futNet + client.optCallNet + client.optPutNet, 0);

  const dii: PlayerFlow = {
    player: 'DII',
    cashNet: roundN(rand(500, 2000), 0),
    futNet: roundN(rand(-50, 50), 0),
    optCallNet: roundN(rand(-10, 10), 0),
    optPutNet: roundN(rand(-10, 10), 0),
    totalNet: 0,
  };
  dii.totalNet = roundN(dii.cashNet + dii.futNet + dii.optCallNet + dii.optPutNet, 0);

  return { date: dateStr, label: 'Day-0', fii, propdesk, client, dii };
}

// --- 3-Day Comparison ---
export function generateDemo3DayComparison(): DayComparison[] {
  const result: DayComparison[] = [];
  const today = new Date();

  for (let d = 2; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const label = `Day-${2 - d}`;

    const decay = 1 + (2 - d) * 0.3;

    const fii: PlayerFlow = {
      player: 'FII',
      cashNet: roundN(rand(-3000, -500) * decay, 0),
      futNet: roundN(rand(-1500, 1500) * decay, 0),
      optCallNet: roundN(rand(-2000, 500) * decay, 0),
      optPutNet: roundN(rand(-500, 2000) * decay, 0),
      totalNet: 0,
    };
    fii.totalNet = roundN(fii.cashNet + fii.futNet + fii.optCallNet + fii.optPutNet, 0);

    const propdesk: PlayerFlow = {
      player: 'PROPDESK',
      cashNet: roundN(rand(-200, 200) * decay, 0),
      futNet: roundN(rand(-800, 800) * decay, 0),
      optCallNet: roundN(rand(-1200, 1200) * decay, 0),
      optPutNet: roundN(rand(-1200, 1200) * decay, 0),
      totalNet: 0,
    };
    propdesk.totalNet = roundN(propdesk.cashNet + propdesk.futNet + propdesk.optCallNet + propdesk.optPutNet, 0);

    const client: PlayerFlow = {
      player: 'CLIENT',
      cashNet: roundN(rand(500, 3000) * decay, 0),
      futNet: roundN(rand(-1000, 1000) * decay, 0),
      optCallNet: roundN(rand(500, 3000) * decay, 0),
      optPutNet: roundN(rand(-2000, 500) * decay, 0),
      totalNet: 0,
    };
    client.totalNet = roundN(client.cashNet + client.futNet + client.optCallNet + client.optPutNet, 0);

    const dii: PlayerFlow = {
      player: 'DII',
      cashNet: roundN(rand(500, 2000) * decay, 0),
      futNet: 0,
      optCallNet: 0,
      optPutNet: 0,
      totalNet: 0,
    };
    dii.totalNet = dii.cashNet;

    result.push({ date: dateStr, label, fii, propdesk, client, dii });
  }

  return result;
}

// --- Big Trades ---
export function generateDemoBigTrades(): BigTradeEntry[] {
  const instruments = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'];
  const players: Array<'FII' | 'PROPDESK' | 'CLIENT'> = ['FII', 'PROPDESK', 'CLIENT'];
  const trades: BigTradeEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < 20; i++) {
    const player = players[randInt(0, 2)];
    const instrument = instruments[randInt(0, 3)];
    const isCall = Math.random() > 0.5;
    const isBuy = Math.random() > 0.5;

    trades.push({
      timestamp: new Date(now - i * randInt(60000, 600000)),
      instrument,
      tradeType: isCall ? 'Call' : 'Put',
      action: isBuy ? 'BUY' : 'SELL',
      player,
      quantity: roundN(rand(500, 50000) * (player === 'FII' ? 3 : player === 'PROPDESK' ? 2 : 1), 0),
      value: roundN(rand(10, 500), 2),
      strike: roundN(rand(24000, 25000) / 50, 0) * 50,
    });
  }

  return trades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// --- Nifty Divergence ---
export function generateDemoNiftyDivergence(): NiftyDivergencePoint[] {
  const data: NiftyDivergencePoint[] = [];
  let niftyPrice = 24000;
  let fiiFlow = 0;

  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    niftyPrice += rand(-150, 150);
    fiiFlow += rand(-500, 400);

    data.push({
      date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      niftyPrice: round2(niftyPrice),
      fiiNetFlow: roundN(fiiFlow, 0),
    });
  }

  return data;
}

// --- Top Stocks Quick View (with Net Money Flow) ---
export interface StockQuickView {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePercent: number;
  callOI: number;
  putOI: number;
  pcr: number;
  netMoneyFlow: NetMoneyFlow;    // Money In - Money Out
  nseLTP: number;                 // NSE price
  bseLTP: number;                 // BSE price
  nseBseDiff: number;             // NSE - BSE difference
}

const STOCK_BASE_PRICES = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', base: 2950 },
  { symbol: 'TCS', name: 'Tata Consultancy', base: 3900 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', base: 1680 },
  { symbol: 'INFY', name: 'Infosys', base: 1580 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', base: 1250 },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', base: 2520 },
  { symbol: 'SBIN', name: 'State Bank India', base: 830 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', base: 1620 },
  { symbol: 'ITC', name: 'ITC Limited', base: 470 },
  { symbol: 'KOTAKBANK', name: 'Kotak Bank', base: 1800 },
  { symbol: 'LT', name: 'Larsen & Toubro', base: 3600 },
  { symbol: 'AXISBANK', name: 'Axis Bank', base: 1170 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', base: 7200 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', base: 12500 },
  { symbol: 'TITAN', name: 'Titan Company', base: 3550 },
];

export function generateDemoStocks(): StockQuickView[] {
  return STOCK_BASE_PRICES.map((s) => {
    const change = round2(rand(-s.base * 0.02, s.base * 0.02));
    const ltp = round2(s.base + change);
    const callOI = roundN(rand(100000, 5000000), 0);
    const putOI = roundN(rand(100000, 5000000), 0);

    // Net Money Flow: Money In - Money Out
    // Higher weight stocks have larger absolute flows
    const moneyIn = roundN(rand(50, 500) * (s.base / 1000) * 10000000, 0);   // In ₹
    const moneyOut = roundN(rand(40, 480) * (s.base / 1000) * 10000000, 0);  // In ₹
    const netFlow = moneyIn - moneyOut;
    const netFlowCr = round2(netFlow / 10000000);

    let intensity: NetMoneyFlow['intensity'];
    const ratio = netFlowCr / (moneyIn / 10000000);
    if (ratio > 0.15) intensity = 'heavy_inflow';
    else if (ratio > 0.05) intensity = 'inflow';
    else if (ratio > -0.05) intensity = 'neutral';
    else if (ratio > -0.15) intensity = 'outflow';
    else intensity = 'heavy_outflow';

    // Dual exchange: NSE and BSE have slightly different prices
    // NSE typically has higher volume, BSE might have slight price difference
    const nseLTP = round2(ltp + rand(-2, 2));
    const bseLTP = round2(ltp + rand(-3, 1));  // BSE often slightly lower
    const nseBseDiff = round2(nseLTP - bseLTP);

    return {
      symbol: s.symbol,
      name: s.name,
      ltp,
      change,
      changePercent: round2((change / s.base) * 100),
      callOI,
      putOI,
      pcr: round2(putOI / callOI),
      netMoneyFlow: {
        symbol: s.symbol,
        moneyIn,
        moneyOut,
        netFlow,
        netFlowCr,
        intensity,
      },
      nseLTP,
      bseLTP,
      nseBseDiff,
    };
  });
}

// --- Net Money Flow for all top stocks ---
export function generateDemoNetMoneyFlow(): NetMoneyFlow[] {
  return STOCK_BASE_PRICES.map((s) => {
    const moneyIn = roundN(rand(50, 500) * (s.base / 1000) * 10000000, 0);
    const moneyOut = roundN(rand(40, 480) * (s.base / 1000) * 10000000, 0);
    const netFlow = moneyIn - moneyOut;
    const netFlowCr = round2(netFlow / 10000000);

    let intensity: NetMoneyFlow['intensity'];
    const ratio = netFlowCr / (moneyIn / 10000000);
    if (ratio > 0.15) intensity = 'heavy_inflow';
    else if (ratio > 0.05) intensity = 'inflow';
    else if (ratio > -0.05) intensity = 'neutral';
    else if (ratio > -0.15) intensity = 'outflow';
    else intensity = 'heavy_outflow';

    return {
      symbol: s.symbol,
      moneyIn,
      moneyOut,
      netFlow,
      netFlowCr,
      intensity,
    };
  });
}

// --- Dual Exchange Stock Data ---
// Same stock, different buyers/sellers on NSE vs BSE
export function generateDemoDualExchangeStocks(): DualExchangeStock[] {
  return STOCK_BASE_PRICES.map((s) => {
    const change = round2(rand(-s.base * 0.02, s.base * 0.02));
    const baseLTP = round2(s.base + change);

    // NSE: Higher volume, tighter spreads
    const nseLTP = round2(baseLTP + rand(-1, 1));
    const nseVolume = roundN(rand(500000, 15000000), 0);
    const nseBuyVol = roundN(nseVolume * rand(0.4, 0.6), 0);
    const nseSellVol = nseVolume - nseBuyVol;
    const nseMoneyIn = roundN(nseBuyVol * nseLTP * rand(0.95, 1.05), 0);
    const nseMoneyOut = roundN(nseSellVol * nseLTP * rand(0.95, 1.05), 0);
    const nseVWAP = round2((nseMoneyIn + nseMoneyOut) / nseVolume);

    const nse: ExchangeStockData = {
      symbol: s.symbol,
      exchange: 'NSE',
      ltp: nseLTP,
      change: round2(nseLTP - s.base),
      changePercent: round2(((nseLTP - s.base) / s.base) * 100),
      volume: nseVolume,
      buyVolume: nseBuyVol,
      sellVolume: nseSellVol,
      moneyIn: nseMoneyIn,
      moneyOut: nseMoneyOut,
      netMoneyFlow: nseMoneyIn - nseMoneyOut,
      vwap: nseVWAP,
    };

    // BSE: Lower volume, slightly different price (sometimes arbitrage opportunity)
    const bseLTP = round2(baseLTP + rand(-3, 1));  // BSE often slightly lower
    const bseVolume = roundN(rand(100000, 2000000), 0);  // Much lower volume
    const bseBuyVol = roundN(bseVolume * rand(0.35, 0.65), 0);
    const bseSellVol = bseVolume - bseBuyVol;
    const bseMoneyIn = roundN(bseBuyVol * bseLTP * rand(0.94, 1.06), 0);
    const bseMoneyOut = roundN(bseSellVol * bseLTP * rand(0.94, 1.06), 0);
    const bseVWAP = round2((bseMoneyIn + bseMoneyOut) / bseVolume);

    const bse: ExchangeStockData = {
      symbol: s.symbol,
      exchange: 'BSE',
      ltp: bseLTP,
      change: round2(bseLTP - s.base),
      changePercent: round2(((bseLTP - s.base) / s.base) * 100),
      volume: bseVolume,
      buyVolume: bseBuyVol,
      sellVolume: bseSellVol,
      moneyIn: bseMoneyIn,
      moneyOut: bseMoneyOut,
      netMoneyFlow: bseMoneyIn - bseMoneyOut,
      vwap: bseVWAP,
    };

    const combinedNetFlow = nse.netMoneyFlow + bse.netMoneyFlow;
    const nseBseDiff = round2(nseLTP - bseLTP);
    const totalMoneyIn = nseMoneyIn + bseMoneyIn;
    const totalMoneyOut = nseMoneyOut + bseMoneyOut;

    const dominantExchange: 'NSE' | 'BSE' | 'both' =
      nseVolume > bseVolume * 5 ? 'NSE' :
      bseVolume > nseVolume * 2 ? 'BSE' : 'both';

    return {
      symbol: s.symbol,
      name: s.name,
      nse,
      bse,
      combinedNetFlow,
      combinedNetFlowCr: round2(combinedNetFlow / 10000000),
      nseBseDiff,
      dominantExchange,
      totalMoneyIn,
      totalMoneyOut,
    };
  });
}

// --- Market Status ---
export function getMarketStatus(): 'pre-open' | 'open' | 'closing' | 'closed' {
  const now = new Date();
  const istH = ((now.getUTCHours() + 5) % 24 + 24) % 24;
  const istM = now.getUTCMinutes() + 30;
  const totalMin = istH * 60 + (istM % 60);
  const day = now.getUTCDay();

  if (day === 0 || day === 6) return 'closed';
  if (totalMin >= 570 && totalMin < 585) return 'pre-open';
  if (totalMin >= 585 && totalMin < 930) return 'open';
  if (totalMin >= 930 && totalMin < 935) return 'closing';
  return 'closed';
}

// --- Format Helpers ---
export function formatNum(n: number): string {
  if (Math.abs(n) >= 10000000) return `${round2(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `${round2(n / 100000).toFixed(2)} L`;
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

export function formatCr(n: number): string {
  return `${round2(n / 10000000).toFixed(1)} Cr`;
}

export function formatLakh(n: number): string {
  return `${round2(n / 100000).toFixed(1)} L`;
}
