import {
  type Signal,
  type SignalType,
  type SignalMode,
  type SignalReasoning,
  type InstrumentData,
  type OptionStrike,
  type VIXData,
  type DayComparison,
  type GlobalIndex,
  type PlayerFlow,
  type MarketDataContext,
  SIGNAL_WEIGHTS,
} from './types';
import { classifyStrikeFlow } from './option-flow-classify';

interface SignalContext {
  instrument: InstrumentData;
  vix: VIXData;
  dayComparison: DayComparison[];
  globalIndices: GlobalIndex[];
  daysToExpiry: number;
  stockSentiment: number; // -1 to 1
  marketDataContext?: MarketDataContext; // NEW: Live vs after-market awareness
  /**
   * Previous-poll per-strike snapshot (Task 44). When provided, the OI-flow
   * scoring uses classifyStrikeFlow (premium-aware 4-quadrant classification)
   * instead of the PCR-level heuristic. PCR alone can't distinguish put
   * writing (bullish) from put buying (bearish) — premium direction resolves
   * the ambiguity. Optional; current demo callers don't provide it so the
   * PCR-level fallback is preserved for back-compat.
   */
  prevStrikes?: OptionStrike[] | null;
}

export function generateHolisticSignal(
  instrument: InstrumentData,
  context: SignalContext,
  mode: SignalMode = 'conservative'
): Signal {
  const threshold = mode === 'aggressive' ? 30 : 50;

  // Check data availability
  const isLiveData = context.marketDataContext?.availability === 'live_flow_only';
  const isAfterMarketData = context.marketDataContext?.availability === 'after_market_available';

  // 1. FII Flow Direction (25%)
  // During live: Use money flow inference (we don't know WHO)
  // After market: Use actual NSE participant data
  let fiiFlowScore: number;
  if (isLiveData && context.marketDataContext?.liveInference) {
    // Live: Infer FII from money flow pattern
    // Big positive flow + likely institutional = probable FII buying
    const inference = context.marketDataContext.liveInference;
    const flowDirection = inference.netFlow >= 0 ? 1 : -1;
    const magnitude = Math.min(100, Math.abs(inference.netFlow / 10000000) * 2);
    fiiFlowScore = flowDirection * magnitude * (inference.likelyInstitutional ? 0.8 : 0.3);
  } else {
    // After market or no inference: Use actual data
    fiiFlowScore = calcFIIFlowScore(context.dayComparison);
  }

  // 2. PropDesk Flow Direction (20%)
  let propdeskFlowScore: number;
  if (isLiveData && context.marketDataContext?.liveInference) {
    // During live: PropDesk follows FII often, use correlation from past 3 days
    const inference = context.marketDataContext.liveInference;
    const flowDirection = inference.netFlow >= 0 ? 1 : -1;
    const magnitude = Math.min(100, Math.abs(inference.netFlow / 10000000) * 1.5);
    propdeskFlowScore = flowDirection * magnitude * 0.5; // Lower confidence during live
  } else {
    propdeskFlowScore = calcPropDeskFlowScore(context.dayComparison);
  }

  // 3. Client Contrarian (15%) — retail is usually wrong at extremes
  let clientContrarianScore: number;
  if (isLiveData) {
    // During live: We can't know client activity, use 3-day data if available
    const rollingWindow = context.marketDataContext?.rollingWindow;
    if (rollingWindow) {
      clientContrarianScore = rollingWindow.clientTrend === 'contrarian_bearish' ? -40
        : rollingWindow.clientTrend === 'contrarian_bullish' ? 40 : 0;
    } else {
      clientContrarianScore = 0; // No data during live
    }
  } else {
    clientContrarianScore = calcClientContrarianScore(context.dayComparison);
  }

  // 4. 3-Day OI Trend (15%) — uses prevStrikes if available (premium-aware
  // classification per Task 44), else falls back to PCR-level heuristic.
  const threeDayOITrendScore = calc3DayOITrendScore(instrument, context.dayComparison, context.prevStrikes ?? null);

  // 5. Cash+Fut Alignment (10%)
  const cashFutAlignScore = calcCashFutAlignScore(context.dayComparison);

  // 6. Global Context (10%)
  const globalContextScore = calcGlobalContextScore(context.globalIndices);

  // 7. Stock Sentiment (5%)
  const stockSentimentScore = context.stockSentiment * 100;

  // THETA AND VIX ARE NOT IN THE SCORE
  const totalScore =
    fiiFlowScore * SIGNAL_WEIGHTS.netFlow +
    propdeskFlowScore * SIGNAL_WEIGHTS.foFlow +
    clientContrarianScore * SIGNAL_WEIGHTS.contrarianFlow +
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

  // Task 47-followup (full-audit fix): the premium shown / used for SL and
  // target must belong to the SUGGESTED strike, not the ATM strike — the
  // suggested strike is ±1 step ITM, whose premium differs materially from
  // ATM (e.g. NIFTY 24350 CE ≈ ₹150 vs 24300 CE ≈ ₹220). Without this the
  // displayed SL/target could not actually be placed on the suggested strike.
  const suggestedStrikeData = instrument.strikes.find(s => s.strike === suggestedStrike);
  const atmStrikeData = instrument.strikes.find(s => s.isATM);
  const premium = isCall
    ? (suggestedStrikeData?.callLTP ?? atmStrikeData?.callLTP ?? 150)
    : (suggestedStrikeData?.putLTP ?? atmStrikeData?.putLTP ?? 150);

  // ─── FULL-AUDIT FIX (was CRITICAL): stop-loss must sit BELOW the entry
  // premium on a BUY signal. The old code multiplied the premium by 1.5/1.8
  // — a WRITER's stop convention applied to a BUYER's trade — printing
  // "SL ₹225 / Target ₹300" on a ₹150 long option: an SL above entry
  // triggers instantly (LTP 150 < trigger 225) and the implied R:R was
  // negative. Long-option convention: risk a fraction of the premium
  // (decay stop), reward a multiple of it.
  //   conservative: SL = 50% of premium, target = 2.0×  → R:R = 2.0
  //   aggressive:   SL = 35% of premium, target = 2.5×  → R:R ≈ 2.3
  const sl = round2(premium * (mode === 'aggressive' ? 0.35 : 0.5));
  const target = round2(premium * (mode === 'aggressive' ? 2.5 : 2.0));
  const confidence = Math.min(95, Math.max(15, Math.abs(totalScore) * 1.2));

  // Theta info (NOT in score)
  // FULL-AUDIT FIX: divide by the number of MATCHED strikes, not a hardcoded
  // /3. The 4 index callers happen to match exactly 3 strikes at their step
  // spacing, but any stock instrument (2.5–10 step per STOCK_SPECS) matched
  // ~all 11 strikes — overstating average theta ~3.7×.
  const thetaStrikes = instrument.strikes
    .filter(s => s.isATM || Math.abs(s.strike - atmStrike) <= step);
  const callTheta = thetaStrikes.length > 0
    ? thetaStrikes.reduce((sum, s) => sum + s.callTheta, 0) / thetaStrikes.length
    : 0;
  const putTheta = thetaStrikes.length > 0
    ? thetaStrikes.reduce((sum, s) => sum + s.putTheta, 0) / thetaStrikes.length
    : 0;

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
    stockSentimentScore, totalScore, signalType,
    isLiveData, isAfterMarketData
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
  // Scale: ₹1000 Cr net = score 50, saturating at ±100 (₹2000 Cr). Full-audit
  // fix: the divisor said 10000 while this comment said 1000 — a 10× scale
  // contradiction that muted the 25%-weight FII factor. Honored the documented
  // intent (1000 Cr = 50). FII daily nets run ±500–5000 Cr, so ±2000 Cr now
  // saturates as designed.
  return Math.max(-100, Math.min(100, (total / 1000) * 50));
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

// 3-Day OI Trend — premium-aware per-strike classification when prevStrikes
// available (Task 44 fix); falls back to PCR-level heuristic otherwise.
//
// The PCR-level heuristic assumes PCR > 1 = "put writing = bullish" — but
// PCR alone can't tell put writing (bullish) from put buying (bearish).
// When market is falling + PCR rising = put BUYING = bearish (heuristic
// wrongly says bullish). The premium-aware path uses ΔLTP to disambiguate
// via the canonical 4-quadrant table (option-flow-classify.ts, Task 39).
function calc3DayOITrendScore(
  instrument: InstrumentData,
  dayComp: DayComparison[],
  prevStrikes: OptionStrike[] | null,
): number {
  // ─── Preferred path: per-strike premium-aware classification (Task 44) ───
  if (prevStrikes && prevStrikes.length > 0) {
    const currStrikes = instrument.strikes;
    const prevMap = new Map<number, OptionStrike>();
    for (const s of prevStrikes) prevMap.set(s.strike, s);

    let bullishCr = 0;
    let bearishCr = 0;
    let lotSize = 1; // instrument.lotSize if present — most callers don't set it
    // For options, NSE lot size varies by underlying (NIFTY=75, BANKNIFTY=30,
    // stocks=1). Without a lotSize field on InstrumentData we use 1 — the
    // RELATIVE bullish/bearish ratio is still correct, only the absolute
    // ₹ Cr magnitude is understated for index options.

    for (const curr of currStrikes) {
      const prev = prevMap.get(curr.strike);
      if (!prev) continue;
      // Map OptionStrike → StrikeFlowLeg (option-flow-classify.ts).
      // putDelta is signed (-1..0); StrikeFlowLeg.peDelta is abs-positive.
      const flow = classifyStrikeFlow(
        {
          ceOI: prev.callOI, peOI: prev.putOI,
          ceLTP: prev.callLTP, peLTP: prev.putLTP,
          ceDelta: prev.callDelta,
          peDelta: Math.abs(prev.putDelta),
        },
        {
          ceOI: curr.callOI, peOI: curr.putOI,
          ceLTP: curr.callLTP, peLTP: curr.putLTP,
          ceDelta: curr.callDelta,
          peDelta: Math.abs(curr.putDelta),
        },
        lotSize,
      );
      bullishCr += flow.bullish;
      bearishCr += flow.bearish;
    }

    // Convert ₹ Cr net flow to ±60 score (matching the old PCR scale).
    // 50 Cr of directional flow = saturated ±60 (matches old PCR=±1.5 case).
    // Below 50 Cr scales linearly.
    const netFlow = bullishCr - bearishCr;
    const scaled = Math.max(-60, Math.min(60, (netFlow / 50) * 60));

    // 3-day trend consistency multiplier (unchanged from old impl).
    if (dayComp.length >= 3) {
      return Math.max(-100, Math.min(100, scaled * 1.2));
    }
    return Math.max(-100, Math.min(100, scaled));
  }

  // ─── Fallback path: PCR-level heuristic (back-compat for demo callers) ───
  // Note: this heuristic has the known limitation — PCR rising on a falling
  // market reads as bullish when it's actually put buying (bearish). The
  // preferred path above resolves this via premium direction.
  const totalCallOI = instrument.totalCallOI;
  const totalPutOI = instrument.totalPutOI;
  const pcr = totalPutOI / totalCallOI;

  let score = 0;
  if (pcr > 1.2) score = 60; // Strong put writing = bullish (heuristic)
  else if (pcr > 1.0) score = 30;
  else if (pcr > 0.8) score = -30;
  else score = -60; // Heavy call writing = bearish (heuristic)

  if (dayComp.length >= 3) {
    score *= 1.2;
  }

  return Math.max(-100, Math.min(100, score));
}

// Cash+Fut Alignment: Does futures confirm cash direction?
function calcCashFutAlignScore(dayComp: DayComparison[]): number {
  const latest = dayComp.find(d => d.label === 'Day-0');
  if (!latest) return 0;

  const fiiCash = latest.fii.cashNet;
  const fiiFut = latest.fii.futNet;

  // FULL-AUDIT FIX: the noise guard must run BEFORE the same-direction
  // returns. Previously +5 Cr cash / +5 Cr futures (both far below the
  // 100-Cr meaningfulness threshold) returned the full +60 alignment score
  // because the sign check hit first — noise-level data was scoring as a
  // strong alignment.
  if (Math.abs(fiiCash) < 100 || Math.abs(fiiFut) < 100) return 0;
  // If both same direction = aligned = bullish/bearish confirmation
  if (fiiCash > 0 && fiiFut > 0) return 60;
  if (fiiCash < 0 && fiiFut < 0) return -60;
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
  stockSent: number, total: number, signal: SignalType,
  isLiveData: boolean, isAfterMarketData: boolean
): string {
  const parts: string[] = [];

  // Data availability context
  if (isLiveData) {
    parts.push('LIVE: Only money flow visible (participant identity inferred from flow patterns)');
  } else if (isAfterMarketData) {
    parts.push('AFTER-MARKET: NSE participant data available for correlation');
  }

  if (Math.abs(fii) > 30) parts.push(`Net flow ${fii > 0 ? 'strongly buying' : 'strongly selling'}`);
  if (Math.abs(propdesk) > 30) parts.push(`F&O flow ${propdesk > 0 ? 'bullish' : 'bearish'}`);
  if (Math.abs(client) > 20) parts.push(`Contrarian flow ${client > 0 ? 'bullish' : 'bearish'}`);
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
