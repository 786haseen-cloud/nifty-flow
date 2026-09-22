import { RISK_FREE_RATE } from './types';

function normCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function calcD1(S: number, K: number, T: number, r: number, sigma: number): number {
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

function calcD2(S: number, K: number, T: number, r: number, sigma: number): number {
  return calcD1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
}

export function callPrice(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return Math.max(S - K, 0);
  return S * normCDF(calcD1(S, K, T, r, sigma)) - K * Math.exp(-r * T) * normCDF(calcD2(S, K, T, r, sigma));
}

export function putPrice(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return Math.max(K - S, 0);
  return K * Math.exp(-r * T) * normCDF(-calcD2(S, K, T, r, sigma)) - S * normCDF(-calcD1(S, K, T, r, sigma));
}

export function calcDelta(S: number, K: number, T: number, r: number, sigma: number, optionType: 'CE' | 'PE'): number {
  if (T <= 0) return optionType === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1Val = calcD1(S, K, T, r, sigma);
  return optionType === 'CE' ? normCDF(d1Val) : normCDF(d1Val) - 1;
}

export function calcGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return 0;
  const d1Val = calcD1(S, K, T, r, sigma);
  return normPDF(d1Val) / (S * sigma * Math.sqrt(T));
}

export function calcTheta(S: number, K: number, T: number, r: number, sigma: number, optionType: 'CE' | 'PE'): number {
  if (T <= 0) return 0;
  const d1Val = calcD1(S, K, T, r, sigma);
  const d2Val = calcD2(S, K, T, r, sigma);
  const term1 = -(S * normPDF(d1Val) * sigma) / (2 * Math.sqrt(T));

  if (optionType === 'CE') {
    const term2 = -r * K * Math.exp(-r * T) * normCDF(d2Val);
    return (term1 + term2) / 365;
  } else {
    const term2 = r * K * Math.exp(-r * T) * normCDF(-d2Val);
    return (term1 + term2) / 365;
  }
}

export function calcVega(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return 0;
  const d1Val = calcD1(S, K, T, r, sigma);
  return S * normPDF(d1Val) * Math.sqrt(T) / 100;
}

export function impliedVolatility(
  marketPrice: number, S: number, K: number, T: number, r: number, optionType: 'CE' | 'PE',
  maxIter: number = 100, precision: number = 0.0001
): number {
  // FULL-AUDIT FIX: guard degenerate inputs. A marketPrice ≤ 0 (stale/illiquid
  // quote) or below intrinsic value makes Newton-Raphson unbounded — the old
  // code silently returned the clamp floor 0.001 (IV = 0.1%) or ceiling 5
  // (500%) and calculateGreeks then emitted garbage Greeks from it. NaN is
  // the honest answer; consumers already guard null-ish Greeks downstream.
  const intrinsic = optionType === 'CE'
    ? Math.max(0, S - K * Math.exp(-r * T))
    : Math.max(0, K * Math.exp(-r * T) - S);
  if (!(marketPrice > 0) || S <= 0 || K <= 0 || T <= 0 || marketPrice < intrinsic * 0.999) {
    return NaN;
  }

  let sigma = 0.3;
  const priceFunc = optionType === 'CE' ? callPrice : putPrice;

  for (let i = 0; i < maxIter; i++) {
    const price = priceFunc(S, K, T, r, sigma);
    const diff = price - marketPrice;

    if (Math.abs(diff) < precision) return sigma;

    const vega = calcVega(S, K, T, r, sigma) * 100;
    if (Math.abs(vega) < 0.0001) return NaN; // no convergence possible

    sigma = sigma - diff / vega;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }

  // Exhausted iterations without converging — do NOT return the last clamp
  // value as if it were a solved IV.
  return NaN;
}

export function calculateGreeks(
  spotPrice: number, strike: number, daysToExpiry: number,
  marketPrice: number, optionType: 'CE' | 'PE', r: number = RISK_FREE_RATE
) {
  const T = Math.max(daysToExpiry / 365, 0.001);
  const iv = impliedVolatility(marketPrice, spotPrice, strike, T, r, optionType);

  return {
    iv,
    delta: calcDelta(spotPrice, strike, T, r, iv, optionType),
    gamma: calcGamma(spotPrice, strike, T, r, iv),
    theta: calcTheta(spotPrice, strike, T, r, iv, optionType),
    vega: calcVega(spotPrice, strike, T, r, iv),
  };
}
