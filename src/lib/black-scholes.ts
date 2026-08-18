// ============================================================
// Black-Scholes Option Pricing & Greeks
// ============================================================

import { RISK_FREE_RATE } from './types';

// Standard Normal CDF (Cumulative Distribution Function)
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

// Standard Normal PDF (Probability Density Function)
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Calculate d1 and d2
function calcD1D2(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number = RISK_FREE_RATE
): { d1: number; d2: number } {
  if (timeToExpiry <= 0 || iv <= 0) {
    return { d1: 0, d2: 0 };
  }

  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate + (iv * iv) / 2) * timeToExpiry) /
    (iv * Math.sqrt(timeToExpiry));
  const d2 = d1 - iv * Math.sqrt(timeToExpiry);

  return { d1, d2 };
}

// Black-Scholes Call Price
export function bsCallPrice(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0) {
    return Math.max(spot - strike, 0);
  }
  const { d1, d2 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  return spot * normalCDF(d1) - strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2);
}

// Black-Scholes Put Price
export function bsPutPrice(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0) {
    return Math.max(strike - spot, 0);
  }
  const { d1, d2 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  return strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2) - spot * normalCDF(-d1);
}

// ============================================================
// Greeks
// ============================================================

// Delta: Rate of change of option price w.r.t. underlying
export function calcDelta(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  optionType: 'CE' | 'PE',
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0 || iv <= 0) {
    if (optionType === 'CE') return spot > strike ? 1 : 0;
    return spot < strike ? -1 : 0;
  }
  const { d1 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  if (optionType === 'CE') return normalCDF(d1);
  return normalCDF(d1) - 1;
}

// Gamma: Rate of change of delta w.r.t. underlying
export function calcGamma(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0 || iv <= 0 || spot <= 0) return 0;
  const { d1 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  return normalPDF(d1) / (spot * iv * Math.sqrt(timeToExpiry));
}

// Theta: Rate of change of option price w.r.t. time (per day)
export function calcTheta(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  optionType: 'CE' | 'PE',
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0 || iv <= 0) return 0;
  const { d1, d2 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  const firstTerm =
    -(spot * normalPDF(d1) * iv) / (2 * Math.sqrt(timeToExpiry));

  if (optionType === 'CE') {
    const secondTerm = -riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2);
    return (firstTerm + secondTerm) / 365; // per day
  }
  const secondTerm = riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2);
  return (firstTerm + secondTerm) / 365; // per day
}

// Vega: Sensitivity to volatility (per 1% change)
export function calcVega(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0 || iv <= 0) return 0;
  const { d1 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  return (spot * normalPDF(d1) * Math.sqrt(timeToExpiry)) / 100; // per 1%
}

// Rho: Sensitivity to interest rate
export function calcRho(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  optionType: 'CE' | 'PE',
  riskFreeRate: number = RISK_FREE_RATE
): number {
  if (timeToExpiry <= 0 || iv <= 0) return 0;
  const { d2 } = calcD1D2(spot, strike, timeToExpiry, iv, riskFreeRate);
  if (optionType === 'CE') {
    return (strike * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2)) / 100;
  }
  return (-strike * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2)) / 100;
}

// Implied Volatility via Newton-Raphson
export function calcImpliedVolatility(
  marketPrice: number,
  spot: number,
  strike: number,
  timeToExpiry: number,
  optionType: 'CE' | 'PE',
  riskFreeRate: number = RISK_FREE_RATE,
  maxIter: number = 100,
  tol: number = 1e-6
): number {
  if (timeToExpiry <= 0 || marketPrice <= 0) return 0.15; // fallback 15%

  let iv = 0.2; // initial guess

  for (let i = 0; i < maxIter; i++) {
    const price = optionType === 'CE'
      ? bsCallPrice(spot, strike, timeToExpiry, iv, riskFreeRate)
      : bsPutPrice(spot, strike, timeToExpiry, iv, riskFreeRate);

    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return iv;

    const vega = calcVega(spot, strike, timeToExpiry, iv, riskFreeRate) * 100;
    if (Math.abs(vega) < 1e-10) break;

    iv = iv - diff / vega;
    if (iv <= 0.001) iv = 0.001;
    if (iv > 5) iv = 5;
  }

  return iv;
}

// All Greeks in one call
export interface AllGreeksResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  theoreticalPrice: number;
}

export function calcAllGreeks(
  spot: number,
  strike: number,
  timeToExpiry: number,
  iv: number,
  optionType: 'CE' | 'PE',
  riskFreeRate: number = RISK_FREE_RATE
): AllGreeksResult {
  const theoreticalPrice = optionType === 'CE'
    ? bsCallPrice(spot, strike, timeToExpiry, iv, riskFreeRate)
    : bsPutPrice(spot, strike, timeToExpiry, iv, riskFreeRate);

  return {
    delta: calcDelta(spot, strike, timeToExpiry, iv, optionType, riskFreeRate),
    gamma: calcGamma(spot, strike, timeToExpiry, iv, riskFreeRate),
    theta: calcTheta(spot, strike, timeToExpiry, iv, optionType, riskFreeRate),
    vega: calcVega(spot, strike, timeToExpiry, iv, riskFreeRate),
    rho: calcRho(spot, strike, timeToExpiry, iv, optionType, riskFreeRate),
    iv,
    theoreticalPrice,
  };
}

// Time to expiry helper: days to fraction of year
export function daysToExpiry(days: number): number {
  return days / 365.25;
}

// Max Pain calculation (simplified)
export function calcMaxPain(strikes: number[], callOI: number[], putOI: number[]): number {
  if (strikes.length === 0) return 0;

  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  for (const strike of strikes) {
    let pain = 0;
    for (let i = 0; i < strikes.length; i++) {
      if (strikes[i] < strike) {
        pain += callOI[i] * (strike - strikes[i]);
      } else {
        pain += putOI[i] * (strikes[i] - strike);
      }
    }
    if (pain < minPain) {
      minPain = pain;
      maxPainStrike = strike;
    }
  }

  return maxPainStrike;
}
