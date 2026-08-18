// ============================================================
// Holistic Signal Engine
// ============================================================

import {
  type SignalType,
  type SignalMode,
  type SignalReasoning,
  type HolisticContext,
  type InstrumentData,
  type VIXData,
  type BuiltUpType,
  RISK_FREE_RATE,
} from './types';

function pcrSignal(pcr: number): { score: number; desc: string } {
  if (pcr > 1.5) return { score: 80, desc: 'PCR very high → Oversold → Bullish reversal likely' };
  if (pcr > 1.2) return { score: 60, desc: 'PCR elevated → Put writing dominant → Mildly bullish' };
  if (pcr > 0.8) return { score: 50, desc: 'PCR neutral → Balanced market' };
  if (pcr > 0.5) return { score: 40, desc: 'PCR low → Call writing dominant → Mildly bearish' };
  return { score: 20, desc: 'PCR very low → Overbought → Bearish reversal likely' };
}

function oiSignal(totalCallOI: number, totalPutOI: number): { score: number; desc: string } {
  const ratio = totalPutOI / (totalCallOI || 1);
  if (ratio > 1.4) return { score: 70, desc: 'Put OI dominant → Support strong → Bullish' };
  if (ratio > 1.1) return { score: 55, desc: 'Put OI slightly higher → Mild support' };
  if (ratio > 0.9) return { score: 50, desc: 'OI balanced' };
  if (ratio > 0.6) return { score: 45, desc: 'Call OI slightly higher → Resistance nearby' };
  return { score: 30, desc: 'Call OI dominant → Resistance strong → Bearish' };
}

function vixSignal(vix: number): { score: number; desc: string } {
  if (vix > 25) return { score: 75, desc: 'VIX very high → Fear → Potential bottom / Buy signals' };
  if (vix > 20) return { score: 60, desc: 'VIX elevated → Cautious → Watch for reversal' };
  if (vix > 14) return { score: 50, desc: 'VIX normal → Range-bound market' };
  if (vix > 10) return { score: 40, desc: 'VIX low → Complacency → Caution on longs' };
  return { score: 30, desc: 'VIX very low → Extreme complacency → Potential top' };
}

function ivSkewSignal(skew: number): { score: number; desc: string } {
  if (skew > 5) return { score: 70, desc: 'IV skew steep → Put demand high → Protective → Fear' };
  if (skew > 2) return { score: 55, desc: 'IV skew mild → Slight put demand' };
  if (skew > -2) return { score: 50, desc: 'IV skew flat → Balanced expectations' };
  if (skew > -5) return { score: 45, desc: 'IV skew negative → Call demand → Greed' };
  return { score: 35, desc: 'IV skew very negative → Extreme call demand → Overbought' };
}

function builtUpSignal(builtUp: BuiltUpType): { score: number; desc: string } {
  switch (builtUp) {
    case 'Long Build-up': return { score: 70, desc: 'Long Build-up → Bullish momentum' };
    case 'Short Build-up': return { score: 30, desc: 'Short Build-up → Bearish momentum' };
    case 'Long Unwinding': return { score: 35, desc: 'Long Unwinding → Bullish exhaustion' };
    case 'Short Covering': return { score: 65, desc: 'Short Covering → Bearish exhaustion / Rally' };
    default: return { score: 50, desc: 'No clear build-up pattern' };
  }
}

function trendSignal(changePct: number): { score: number; desc: string } {
  if (changePct > 2) return { score: 75, desc: 'Strong uptrend (+2%+)' };
  if (changePct > 0.5) return { score: 60, desc: 'Mild uptrend' };
  if (changePct > -0.5) return { score: 50, desc: 'Sideways / flat' };
  if (changePct > -2) return { score: 40, desc: 'Mild downtrend' };
  return { score: 25, desc: 'Strong downtrend (-2%+)' };
}

// Determine signal type from score
function scoreToSignal(score: number, mode: SignalMode): SignalType {
  if (mode === 'aggressive') {
    if (score >= 70) return 'STRONG_BUY';
    if (score >= 55) return 'BUY';
    if (score >= 45) return 'NEUTRAL';
    if (score >= 30) return 'SELL';
    return 'STRONG_SELL';
  }
  // Conservative
  if (score >= 75) return 'STRONG_BUY';
  if (score >= 60) return 'BUY';
  if (score >= 40) return 'NEUTRAL';
  if (score >= 25) return 'SELL';
  return 'STRONG_SELL';
}

// Main holistic signal generator
export function generateHolisticSignal(
  instrument: InstrumentData,
  vix: VIXData,
  mode: SignalMode,
  // Cross-index correlation data (optional)
  crossIndexData?: { niftyTrend: number; bankNiftyTrend: number }
): {
  signalType: SignalType;
  confidence: number;
  reasoning: SignalReasoning;
  context: HolisticContext;
  strike: number;
  optionType: 'CE' | 'PE';
  premium: number;
  stopLoss: number;
  target: number;
} {
  // ---- Own Data Analysis (weight: 0.40) ----
  const pcrS = pcrSignal(instrument.pcr);
  const oiS = oiSignal(instrument.totalCallOI, instrument.totalPutOI);
  const ivS = ivSkewSignal(instrument.ivSkew);
  const trendS = trendSignal(instrument.changePct);

  // Dominant built-up at ATM
  const atmStrike = instrument.strikes.find(
    (s) => s.strike === instrument.atmStrike
  );
  const buS = builtUpSignal(atmStrike?.builtUpType || 'None');

  const ownScore = (pcrS.score * 0.3 + oiS.score * 0.25 + ivS.score * 0.15 + buS.score * 0.15 + trendS.score * 0.15);

  // ---- Stock Sentiment (weight: 0.20) ----
  const sentimentScore = trendS.score;

  // ---- Cross-Index Correlation (weight: 0.15) ----
  let crossIndexScore = 50;
  if (crossIndexData) {
    const avgCross = (crossIndexData.niftyTrend + crossIndexData.bankNiftyTrend) / 2;
    crossIndexScore = 50 + avgCross * 10;
    crossIndexScore = Math.max(0, Math.min(100, crossIndexScore));
  }

  // ---- VIX Score (weight: 0.15) ----
  const vixS = vixSignal(vix.value);

  // ---- Theta Score (weight: 0.10) ----
  // High theta = time decay is high = bearish for option buyers
  let thetaScore = 50;
  if (atmStrike) {
    // Simplified: if ATM call is expensive, theta decay hurts buyers
    const callPremium = atmStrike.callLTP;
    const putPremium = atmStrike.putLTP;
    if (callPremium > putPremium * 1.5) thetaScore = 40; // Calls expensive → theta hurts buyers
    else if (putPremium > callPremium * 1.5) thetaScore = 60; // Puts expensive → sellers covering
    else thetaScore = 50;
  }

  // ---- Weights ----
  const ownWeight = 0.40;
  const sentimentWeight = 0.20;
  const crossIndexWeight = 0.15;
  const vixWeight = 0.15;
  const thetaWeight = 0.10;

  // ---- Final Score ----
  const finalScore =
    ownScore * ownWeight +
    sentimentScore * sentimentWeight +
    crossIndexScore * crossIndexWeight +
    vixS.score * vixWeight +
    thetaScore * thetaWeight;

  const signalType = scoreToSignal(finalScore, mode);
  const confidence = Math.round(
    Math.abs(finalScore - 50) * 2 // 0-100
  );

  // Determine strike & option
  const strike = instrument.atmStrike;
  const optionType: 'CE' | 'PE' = finalScore >= 50 ? 'CE' : 'PE';
  const premium = atmStrike
    ? optionType === 'CE'
      ? atmStrike.callLTP
      : atmStrike.putLTP
    : 0;

  const stopLoss = Math.round(premium * 0.7 * 100) / 100;
  const target = Math.round(premium * 1.8 * 100) / 100;

  const context: HolisticContext = {
    ownDataScore: Math.round(ownScore),
    stockSentimentScore: Math.round(sentimentScore),
    crossIndexScore: Math.round(crossIndexScore),
    vixScore: Math.round(vixS.score),
    thetaScore: Math.round(thetaScore),
    ownWeight,
    sentimentWeight,
    crossIndexWeight,
    vixWeight,
    thetaWeight,
    finalScore: Math.round(finalScore),
    confidence,
    signalType,
  };

  const reasoning: SignalReasoning = {
    pcrSignal: pcrS.desc,
    oiSignal: oiS.desc,
    vixSignal: vixS.desc,
    ivSignal: ivS.desc,
    builtUpSignal: buS.desc,
    trendSignal: trendS.desc,
    holistic: {
      ownWeight,
      sentimentWeight,
      crossIndexWeight,
      vixWeight,
      thetaWeight,
      ownScore: Math.round(ownScore),
      sentimentScore: Math.round(sentimentScore),
      crossIndexScore: Math.round(crossIndexScore),
      vixScore: Math.round(vixS.score),
      thetaScore: Math.round(thetaScore),
      finalScore: Math.round(finalScore),
    },
  };

  return {
    signalType,
    confidence,
    reasoning,
    context,
    strike,
    optionType,
    premium,
    stopLoss,
    target,
  };
}

// Helper: generate signal score for time series (simplified)
export function generateSignalScore(
  pcr: number,
  vix: number,
  changePct: number,
  totalCallOI: number,
  totalPutOI: number
): number {
  const pcrS = pcrSignal(pcr);
  const vixS = vixSignal(vix);
  const trendS = trendSignal(changePct);
  const oiS = oiSignal(totalCallOI, totalPutOI);

  return Math.round(
    pcrS.score * 0.3 + vixS.score * 0.25 + trendS.score * 0.25 + oiS.score * 0.2
  );
}
