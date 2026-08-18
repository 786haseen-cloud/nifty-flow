import {
  type Signal,
  type SignalType,
  type SignalMode,
  type SignalReasoning,
  type InstrumentData,
  type VIXData,
  type DayComparison,
  type GlobalIndex,
  type PlayerFlow,
  SIGNAL_WEIGHTS,
} from './types';

interface SignalContext {
  instrument: InstrumentData;
  vix: VIXData;
  dayComparison: DayComparison[];
  globalIndices: GlobalIndex[];
  daysToExpiry: number;
  stockSentiment: number; // -1 to 1
}

export function generateHolisticSignal(
  instrument: InstrumentData,
  context: SignalContext,
  mode: SignalMode = 'conservative'
): Signal {
  const threshold = mode === 'aggressive' ? 30 : 50;

  // 1. FII Flow Direction (25%)
  const fiiFlowScore = calcFIIFlowScore(context.dayComparison);

  // 2. PropDesk Flow Direction (20%)
  const propdeskFlowScore = calcPropDeskFlowScore(context.dayComparison);

  // 3. Client Contrarian (15%) — retail is usually wrong at extremes
  const clientContrarianScore = calcClientContrarianScore(context.dayComparison);

  // 4. 3-Day OI Trend (15%)
  const threeDayOITrendScore = calc3DayOITrendScore(instrument, context.dayComparison);

  // 5. Cash+Fut Alignment (10%)
  const cashFutAlignScore = calcCashFutAlignScore(context.dayComparison);

  // 6. Global Context (10%)
  const globalContextScore = calcGlobalContextScore(context.globalIndices);

  // 7. Stock Sentiment (5%)
  const stockSentimentScore = context.stockSentiment * 100;

  // THETA AND VIX ARE NOT IN THE SCORE
  const totalScore =
    fiiFlowScore * SIGNAL_WEIGHTS.fiiFlow +
    propdeskFlowScore * SIGNAL_WEIGHTS.propdeskFlow +
    clientContrarianScore * SIGNAL_WEIGHTS.clientContrarian +
    threeDayOITrendScore * SIGNAL_WEIGHTS.threeDayOITrend +
    cashFutAlignScore * SIGNAL_WEIGHTS.cashFutAlign +
    globalContextScore * SIGNAL_WEIGHTS.globalContext +
    stockSentimentScore * SIGNAL_WEIGHTS.stockSentiment;

  // Determine signal type
  let signalType: SignalType;
  const absScore = Math.abs(totalScore);
  if (absScore < threshold) {
    signalType = 'WAIT';
  } else if (totalScore > 0) {
    signalType = 'CALL_BUY';
  } else {
    signalType = 'PUT_BUY';
  }

  // Check for specific patterns
  const fiiBullish = fiiFlowScore > 30;
  const propdeskBullish = propdeskFlowScore > 30;
  const clientHeavyCallBuying = clientContrarianScore < -30; // contrarian: client buying calls = bearish

  if (fiiBullish && propdeskBullish) {
    signalType = 'CALL_BUY';
  } else if (fiiBullish && !propdeskBullish && propdeskFlowScore < -10) {
    signalType = 'WAIT'; // conflict
  } else if (clientHeavyCallBuying && fiiFlowScore < -20 && propdeskFlowScore < -20) {
    signalType = 'PUT_BUY'; // contrarian: retail buying calls, smart money selling
  }

  const allNegative = context.globalIndices.filter(g => g.changePercent < 0).length >= 6;
  if (allNegative && fiiFlowScore < -30) {
    signalType = 'PUT_BUY';
  }

  // Calculate strike, premium, SL, target
  const isCall = signalType === 'CALL_BUY';
  const atmStrike = instrument.atmStrike;
  const step = instrument.symbol === 'NIFTY' || instrument.symbol === 'FINNIFTY' ? 50 : 100;
  const suggestedStrike = isCall ? atmStrike - step : atmStrike + step;

  const atmStrikeData = instrument.strikes.find(s => s.isATM);
  const premium = isCall
    ? (atmStrikeData?.callLTP ?? 150)
    : (atmStrikeData?.putLTP ?? 150);

  const sl = round2(premium * (mode === 'aggressive' ? 1.8 : 1.5));
  const target = round2(premium * (mode === 'aggressive' ? 2.5 : 2.0));
  const confidence = Math.min(95, Math.max(15, Math.abs(totalScore) * 1.2));

  // Theta info (NOT in score)
  const callTheta = instrument.strikes
    .filter(s => s.isATM || Math.abs(s.strike - atmStrike) <= step)
    .reduce((sum, s) => sum + s.callTheta, 0) / 3;
  const putTheta = instrument.strikes
    .filter(s => s.isATM || Math.abs(s.strike - atmStrike) <= step)
    .reduce((sum, s) => sum + s.putTheta, 0) / 3;

  const thetaInfo = {
    callMelting: round2(Math.abs(callTheta)),
    putMelting: round2(Math.abs(putTheta)),
    fasterSide: Math.abs(callTheta) > Math.abs(putTheta) ? 'call' as const
      : Math.abs(putTheta) > Math.abs(callTheta) ? 'put' as const
      : 'equal' as const,
  };

  const vixInfo = {
    panicLevel: context.vix.panicLevel,
    percentile: context.vix.percentile,
  };

  const details = buildReasoningDetails(
    fiiFlowScore, propdeskFlowScore, clientContrarianScore,
    threeDayOITrendScore, cashFutAlignScore, globalContextScore,
    stockSentimentScore, totalScore, signalType
  );

  const reasoning: SignalReasoning = {
    fiiFlowScore: round2(fiiFlowScore),
    propdeskFlowScore: round2(propdeskFlowScore),
    clientContrarianScore: round2(clientContrarianScore),
    threeDayOITrendScore: round2(threeDayOITrendScore),
    cashFutAlignScore: round2(cashFutAlignScore),
    globalContextScore: round2(globalContextScore),
    stockSentimentScore: round2(stockSentimentScore),
    totalScore: round2(totalScore),
    details,
    thetaInfo,
    vixInfo,
    smartMoneyWindow: context.daysToExpiry <= 2,
  };

  return {
    instrument: instrument.symbol,
    signalType,
    mode,
    confidence: round2(confidence),
    suggestedStrike,
    optionType: isCall ? 'CE' : 'PE',
    premium: round2(premium),
    stopLoss: sl,
    target,
    reasoning,
    timestamp: new Date(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// FII Flow: Net buying across cash+fut+opt = bullish score
function calcFIIFlowScore(dayComp: DayComparison[]): number {
  const latest = dayComp.find(d => d.label === 'Day-0');
  if (!latest) return 0;
  const total = latest.fii.cashNet + latest.fii.futNet + latest.fii.optCallNet + latest.fii.optPutNet;
  // Scale: ₹1000 Cr net = score 50
  return Math.max(-100, Math.min(100, (total / 10000) * 50));
}

// PropDesk Flow: Their direction is smart money
function calcPropDeskFlowScore(dayComp: DayComparison[]): number {
  const latest = dayComp.find(d => d.label === 'Day-0');
  if (!latest) return 0;
  const total = latest.propdesk.cashNet + latest.propdesk.futNet + latest.propdesk.optCallNet + latest.propdesk.optPutNet;
  return Math.max(-100, Math.min(100, (total / 5000) * 50));
}

// Client Contrarian: If retail buying calls heavily, bearish signal
function calcClientContrarianScore(dayComp: DayComparison[]): number {
  const latest = dayComp.find(d => d.label === 'Day-0');
  if (!latest) return 0;
  // Client net positive = they're buying → bearish (contrarian)
  // Client net negative = they're selling → bullish
  const total = latest.client.cashNet + latest.client.futNet + latest.client.optCallNet + latest.client.optPutNet;
  return Math.max(-100, Math.min(100, -(total / 10000) * 50));
}

// 3-Day OI Trend: Consistent call writing = bullish support
function calc3DayOITrendScore(instrument: InstrumentData, dayComp: DayComparison[]): number {
  // Use current OI data from instrument
  const totalCallOI = instrument.totalCallOI;
  const totalPutOI = instrument.totalPutOI;
  const pcr = totalPutOI / totalCallOI;

  // PCR > 1 = more put writing = bullish support
  // PCR < 1 = more call writing = bearish
  let score = 0;
  if (pcr > 1.2) score = 60; // Strong put writing = bullish
  else if (pcr > 1.0) score = 30;
  else if (pcr > 0.8) score = -30;
  else score = -60; // Heavy call writing = bearish

  // Check 3-day trend consistency
  if (dayComp.length >= 3) {
    const oiTrendConsistent = true; // simplified
    if (oiTrendConsistent) score *= 1.2;
  }

  return Math.max(-100, Math.min(100, score));
}

// Cash+Fut Alignment: Does futures confirm cash direction?
function calcCashFutAlignScore(dayComp: DayComparison[]): number {
  const latest = dayComp.find(d => d.label === 'Day-0');
  if (!latest) return 0;

  const fiiCash = latest.fii.cashNet;
  const fiiFut = latest.fii.futNet;

  // If both same direction = aligned = bullish/bearish confirmation
  if (fiiCash > 0 && fiiFut > 0) return 60;
  if (fiiCash < 0 && fiiFut < 0) return -60;
  if (Math.abs(fiiCash) < 100 || Math.abs(fiiFut) < 100) return 0;
  // Divergent = weak signal
  return (fiiCash + fiiFut) > 0 ? 20 : -20;
}

// Global Context: Are global markets aligned?
function calcGlobalContextScore(globalIndices: GlobalIndex[]): number {
  if (!globalIndices.length) return 0;
  const avgChg = globalIndices.reduce((s, g) => s + g.changePercent, 0) / globalIndices.length;
  return Math.max(-100, Math.min(100, avgChg * 30));
}

function buildReasoningDetails(
  fii: number, propdesk: number, client: number,
  oi3d: number, cashFut: number, globalCtx: number,
  stockSent: number, total: number, signal: SignalType
): string {
  const parts: string[] = [];

  if (Math.abs(fii) > 30) parts.push(`FII ${fii > 0 ? 'buying' : 'selling'} strongly`);
  if (Math.abs(propdesk) > 30) parts.push(`PropDesk ${propdesk > 0 ? 'bullish' : 'bearish'}`);
  if (Math.abs(client) > 20) parts.push(`Retail ${client > 0 ? 'contrarian bullish' : 'contrarian bearish'}`);
  if (Math.abs(oi3d) > 30) parts.push(`3-day OI ${oi3d > 0 ? 'bullish support' : 'bearish resistance'}`);
  if (Math.abs(cashFut) > 20) parts.push(`Cash+Fut ${cashFut > 0 ? 'aligned bullish' : 'aligned bearish'}`);
  if (Math.abs(globalCtx) > 15) parts.push(`Global markets ${globalCtx > 0 ? 'supportive' : 'negative'}`);

  parts.push(`Signal: ${signal} (Score: ${total.toFixed(1)})`);
  return parts.join(' | ');
}

// Generate signals for all instruments
export function generateAllSignals(
  instruments: InstrumentData[],
  context: Omit<SignalContext, 'instrument'>,
  mode: SignalMode = 'conservative'
): Signal[] {
  return instruments.map(inst =>
    generateHolisticSignal(inst, { ...context, instrument: inst }, mode)
  );
}
