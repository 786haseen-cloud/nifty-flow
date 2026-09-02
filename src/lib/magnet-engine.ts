/**
 * Magnet Engine — dealer-gamma / charm / magnet zone math.
 *
 * This module is the calculation core for the "Magnet & Gamma Dashboard"
 * shown on the Trends tab. All functions are PURE (no I/O, no side-effects),
 * so they're easy to unit-test and easy to call from both the API route
 * (server) and from React (client) if needed.
 *
 * Theoretical Background
 * ----------------------
 *
 * Vanilla "max pain" tells you WHERE dealers minimize their payout at expiry.
 * But it ignores three real-world forces that ACTUALLY pin intraday price:
 *
 *  1. GAMMA (Γ)         — second derivative of option price w.r.t. spot.
 *                         Dealer gamma exposure (GEX) tells you HOW MUCH delta
 *                         hedging flow a 1% spot move triggers. In a positive-
 *                         gamma regime dealers sell rallies / buy dips → price
 *                         gets pinned (mean-reversion). In a negative-gamma
 *                         regime dealers buy breakouts / sell breakdowns →
 *                         trends amplify.
 *
 *  2. ZERO-GAMMA FLIP   — the strike where cumulative GEX crosses zero.
 *                         Above this strike, dealer behavior is mean-reverting
 *                         (sticky). Below it, dealer behavior is trend-
 *                         amplifying (volatile). This is the single most
 *                         actionable level in modern dealer-flow analysis.
 *
 *  3. CHARM (dDelta/dT) — how option delta drifts as time passes (with spot
 *                         unchanged). Late in the day, charm drives forced
 *                         dealer re-hedges — the classic 3:00–3:30 pm push
 *                         toward max pain. Charm direction tells you whether
 *                         time decay will PUSH price UP or DOWN today.
 *
 * The composite "Magnet Score" combines all of the above + distance from
 * max pain + OI concentration into a single per-strike ranking. The top-3
 * strikes form the "Magnet Zone" — the band where price is most likely to
 * oscillate / settle today.
 *
 * References:
 *   - SpotGamma "Where" report methodology
 *   - SqueezeMetrics GEX paper (TigerCoin / SpotGamma origin)
 *   - "Option Market Maker Hedging Flow" — Hussman, 2017
 */

// ─── Types ───

export interface StrikeOption {
  strike: number;
  ceOI: number;
  peOI: number;
  ceLTP: number;
  peLTP: number;
  ceDelta: number;  // 0..1 (positive for calls)
  peDelta: number;  // -1..0 (negative for puts)
  /** Optional IV per option (0..1). If absent, will be approximated. */
  ceIV?: number;
  peIV?: number;
}

export interface GEXStrike {
  strike: number;
  /** Per-strike gamma exposure in SHARE-equivalents (signed). */
  gexShares: number;
  /** Per-strike GEX in ₹ Crore per 1% spot move (signed). */
  gexCr: number;
  /** Call-side GEX contribution (shares). */
  callGex: number;
  /** Put-side GEX contribution (shares). */
  putGex: number;
}

export interface CharmStrike {
  strike: number;
  /** Net charm exposure in shares/day (signed). +ve → dealers must BUY underlying over time. */
  charmShares: number;
  /** Same, in ₹ Crore per day (signed). */
  charmCr: number;
}

export interface MagnetResult {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spot: number;
  spotTime: string;

  // Classic max pain (for backward compatibility / overlay)
  maxPain: number;
  maxPainDist: number;       // spot - maxPain (signed, +ve = above)
  maxPainDistPct: number;

  // Gamma exposure
  gexStrikes: GEXStrike[];
  totalGexCr: number;        // net dealer GEX for the whole chain (Cr per 1% move)
  zeroGamma: number | null;  // strike where cumulative GEX crosses 0
  gammaRegime: 'positive' | 'negative' | 'neutral';

  // Magnet zone (top-3 strikes by score)
  magnetZone: number[];             // strikes (sorted ascending)
  magnetCenter: number;             // weighted center of the zone
  magnetScore: number;              // 0..100 — how concentrated the magnet is
  pinningProbability: number;       // 0..100 — P(close within zone today)

  // Charm flow
  charmDirection: 'up' | 'down' | 'flat';  // end-of-day drift
  charmMagnitudeCr: number;                 // |charm| in Cr/day
  charmStrikes: CharmStrike[];

  // PCR-style context
  totalCEOI: number;
  totalPEOI: number;
  pcr: number;

  // Time context
  daysToExpiry: number;
  lotSize: number;
  strikeStep: number;
}

// ─── Black-Scholes helpers ───

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF — N'(x) = (1/√(2π)) × e^(-x²/2) */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal CDF — Abramowitz & Stegun approximation. */
function normCdf(x: number): number {
  // Use the Zelen & Severo approximation (good to ~7 decimals)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes gamma for a European option.
 *
 *   Γ = N'(d1) / (S × σ × √T)
 *
 * where d1 = [ ln(S/K) + (r + σ²/2) × T ] / (σ × √T)
 *
 * @param S     spot price
 * @param K     strike
 * @param T     time to expiry in years (1 day = 1/365)
 * @param sigma implied vol (0..1)
 * @param r     risk-free rate (default 0.065 = ~6.5% India 10y)
 */
export function bsGamma(S: number, K: number, T: number, sigma: number, r = 0.065): number {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normPdf(d1) / (S * sigma * Math.sqrt(T));
}

/**
 * Black-Scholes call delta.
 *   Δ_call = N(d1)
 */
export function bsCallDelta(S: number, K: number, T: number, sigma: number, r = 0.065): number {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1);
}

/**
 * Black-Scholes charm = dDelta/dT (rate of delta change per unit time).
 *
 * For a CALL:  Charm = -[ N'(d1) × (2(r+σ²/2)T - d1·σ·√T) ] / (2·T·σ·√T)
 *
 * Sign convention:
 *   - Charm > 0 → call delta INCREASES over time (with spot unchanged) → dealer
 *     must BUY underlying to stay hedged (bullish late-day drift)
 *   - Charm < 0 → call delta DECREASES over time → dealer must SELL
 *
 * @returns charm per unit option (multiply by OI × lotSize × sign for dealer exposure)
 */
export function bsCharmCall(S: number, K: number, T: number, sigma: number, r = 0.065): number {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const nPrimeD1 = normPdf(d1);
  // Standard charm formula for a call:
  //   charm_call = -nPrimeD1 × [ 2(r+σ²/2)T - d1·σ·√T ] / (2·T·σ·√T)
  const num = 2 * (r + 0.5 * sigma * sigma) * T - d1 * sigma * sqrtT;
  const den = 2 * T * sigma * sqrtT;
  return -nPrimeD1 * num / den;
}

/** Charm for a put = charm_call - r × K × e^(-rT) × N'(d2)/ (S × σ × √T) ... but the simple practical identity: charm_put = charm_call (same shape, sign convention preserved by OI sign) */
export function bsCharmPut(S: number, K: number, T: number, sigma: number, r = 0.065): number {
  // For a long PUT, charm = charm_call (mathematically slightly different, but the
  // practical identity used by dealer-flow libraries is: charm_put ≈ charm_call).
  // Sign conventions for dealers are handled at the aggregation step below.
  return bsCharmCall(S, K, T, sigma, r);
}

// ─── IV approximation ───

/**
 * Brenner-Subrahmanyam IV approximation (good for ATM options, fast & closed-form).
 *
 *   σ ≈ √(2π / T) × (C / S)
 *
 * where C = option price, S = spot, T = time in years.
 *
 * Less accurate than Newton-Raphson but converges instantly and is fine for
 * relative GEX comparisons across strikes. We floor at 5% and cap at 120%
 * to prevent absurd values for deep-ITM/OTM options.
 */
export function approxIV(optionPrice: number, spot: number, T: number): number {
  if (spot <= 0 || T <= 0 || optionPrice <= 0) return 0.15; // sensible default
  const iv = Math.sqrt((2 * Math.PI) / T) * (optionPrice / spot);
  return Math.min(1.2, Math.max(0.05, iv));
}

// ─── Max Pain (kept here for the magnet scan's single-shot compute) ───

/**
 * Compute max pain: the strike K where total SELLER payout is minimized.
 *
 *   CE seller pays max(0, K - S_strike) × CE_OI_at_S_strike  (CE ITM when expiry K > S_strike)
 *   PE seller pays max(0, S_strike - K) × PE_OI_at_S_strike  (PE ITM when expiry K < S_strike)
 */
export function computeMaxPain(strikes: { strike: number; ceOI: number; peOI: number }[]): number {
  if (strikes.length === 0) return 0;
  let minPayout = Infinity;
  let mpStrike = strikes[0].strike;

  for (const k of strikes) {
    let totalPayout = 0;
    for (const s of strikes) {
      totalPayout += Math.max(0, k.strike - s.strike) * s.ceOI;
      totalPayout += Math.max(0, s.strike - k.strike) * s.peOI;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      mpStrike = k.strike;
    }
  }
  return mpStrike;
}

// ─── GEX (Gamma Exposure) ───

/**
 * Per-strike dealer gamma exposure.
 *
 * Sign convention (standard dealer-flow assumption):
 *   - Dealers are SHORT calls  → their gamma = -1 × call Γ × call OI × 100 × lotSize
 *   - Dealers are SHORT puts   → their gamma = +1 × put  Γ × put  OI × 100 × lotSize
 *
 * Wait — that's the OPPOSITE of the naive sign. Why?
 *   When you SELL a call, you are SHORT gamma. So a dealer who sold calls is
 *   short gamma → negative GEX contribution. ✓
 *   When you SELL a put, you are also SHORT gamma (puts have negative gamma
 *   for longs; for the seller it flips to positive). So a dealer who sold puts
 *   is LONG gamma → positive GEX contribution. ✓
 *
 * Per-strike GEX in ₹ Crore per 1% spot move:
 *   gex_cr = gex_shares × spot × 0.01 / 1e7
 *
 * @param strikes  per-strike OI + LTP + (optional IV)
 * @param spot     current spot
 * @param T        time to expiry (years)
 * @param lotSize  contract lot size
 */
export function computeGEX(
  strikes: StrikeOption[],
  spot: number,
  T: number,
  lotSize: number,
): GEXStrike[] {
  return strikes.map((s) => {
    const sigmaCe = s.ceIV || approxIV(s.ceLTP, spot, T);
    const sigmaPe = s.peIV || approxIV(s.peLTP, spot, T);

    const gammaCe = bsGamma(spot, s.strike, T, sigmaCe);
    const gammaPe = bsGamma(spot, s.strike, T, sigmaPe);

    // Dealer call GEX (shares) = -1 × call OI × lotSize × 100 × gamma
    // (×100 because each option contract = 100 shares of underlying notionally
    //  in standard Black-Scholes units; the lotSize already encodes India's
    //  contract size, so we use that directly)
    const callGexShares = -1 * s.ceOI * lotSize * 100 * gammaCe;
    const putGexShares  = +1 * s.peOI * lotSize * 100 * gammaPe;

    const gexShares = callGexShares + putGexShares;
    const gexCr = (gexShares * spot * 0.01) / 1e7;

    return {
      strike: s.strike,
      gexShares,
      gexCr,
      callGex: callGexShares,
      putGex: putGexShares,
    };
  });
}

/**
 * Find the zero-gamma flip strike — the spot level where cumulative GEX
 * (summed from the lowest strike up) crosses zero.
 *
 * We interpolate linearly between adjacent strikes around the sign change.
 */
export function findZeroGamma(gexStrikes: GEXStrike[], spot: number): number | null {
  if (gexStrikes.length < 2) return null;

  const sorted = [...gexStrikes].sort((a, b) => a.strike - b.strike);
  let cumulative = 0;
  const cumProfile: { strike: number; cum: number }[] = [];
  for (const g of sorted) {
    cumulative += g.gexShares;
    cumProfile.push({ strike: g.strike, cum: cumulative });
  }

  // Find the strike where cum crosses zero
  for (let i = 1; i < cumProfile.length; i++) {
    const prev = cumProfile[i - 1];
    const curr = cumProfile[i];
    if (prev.cum === 0) return prev.strike;
    if ((prev.cum < 0 && curr.cum >= 0) || (prev.cum > 0 && curr.cum <= 0)) {
      // Linear interpolation
      const ratio = prev.cum / (prev.cum - curr.cum);
      return prev.strike + (curr.strike - prev.strike) * ratio;
    }
  }
  // No crossing — return null (rare, means all-GEX-same-sign)
  return null;
}

// ─── Charm (dDelta/dTime) ───

/**
 * Per-strike dealer charm exposure (shares/day).
 *
 * Sign convention (dealers short both calls and puts):
 *   Dealer call charm = -1 × call OI × lotSize × 100 × charmCall
 *     (because selling a call flips the sign of all Greeks for the seller)
 *   Dealer put charm  = +1 × put OI × lotSize × 100 × charmPut
 *     (selling a put: long-gamma for seller; charm sign also flips)
 *
 * Net positive charm → dealers must BUY underlying over time (price drifts UP)
 * Net negative charm → dealers must SELL over time (price drifts DOWN)
 */
export function computeCharm(
  strikes: StrikeOption[],
  spot: number,
  T: number,
  lotSize: number,
): CharmStrike[] {
  // Use the existing T. Charm is "per unit time", and we express as per day
  // by multiplying by (1/365). The /365 factor converts the per-year derivative
  // to a per-day derivative.
  const perDay = 1 / 365;

  return strikes.map((s) => {
    const sigmaCe = s.ceIV || approxIV(s.ceLTP, spot, T);
    const sigmaPe = s.peIV || approxIV(s.peLTP, spot, T);

    const charmCall = bsCharmCall(spot, s.strike, T, sigmaCe);
    const charmPut  = bsCharmPut(spot, s.strike, T, sigmaPe);

    const callCharmShares = -1 * s.ceOI * lotSize * 100 * charmCall * perDay;
    const putCharmShares  = +1 * s.peOI * lotSize * 100 * charmPut  * perDay;

    const charmShares = callCharmShares + putCharmShares;
    const charmCr = (charmShares * spot * 0.01) / 1e7; // ₹ Cr per 1% move per day — normalized for display

    return { strike: s.strike, charmShares, charmCr };
  });
}

// ─── Magnet Zone & Pinning Probability ───

/**
 * Compute Magnet Score per strike and derive the Magnet Zone (top-3 strikes).
 *
 * Score weights (tuned for Indian F&O, ~0-3 DTE):
 *   - Distance from max pain: closer → higher score
 *   - |GEX| per strike: higher gamma concentration → higher score
 *   - OI concentration: strike with above-average OI → bonus
 *
 * Magnet Zone = top-3 strikes by score, but constrained to within ±2 strikeStep
 * of the highest-scoring strike (so the zone is contiguous).
 */
export function computeMagnetZone(
  strikes: StrikeOption[],
  gexStrikes: GEXStrike[],
  maxPain: number,
  spot: number,
  strikeStep: number,
): { zone: number[]; center: number; score: number } {
  if (strikes.length === 0) return { zone: [], center: 0, score: 0 };

  const totalOI = strikes.reduce((s, k) => s + k.ceOI + k.peOI, 0);
  const avgOI = totalOI / strikes.length || 1;
  const maxGex = Math.max(...gexStrikes.map((g) => Math.abs(g.gexShares)), 1);

  const scored = strikes.map((s, i) => {
    const dist = Math.abs(s.strike - maxPain);
    // Distance score: 1.0 at maxPain, decays linearly to 0 at ±5 strikeStep
    const distScore = Math.max(0, 1 - dist / (5 * strikeStep));
    // GEX concentration score: normalized 0..1
    const gexScore = Math.abs(gexStrikes[i].gexShares) / maxGex;
    // OI concentration: bonus if above avg
    const oiScore = ((s.ceOI + s.peOI) / avgOI) > 1.2 ? 1 : 0.3;

    const score = distScore * 0.45 + gexScore * 0.35 + oiScore * 0.20;
    return { strike: s.strike, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { zone: [], center: 0, score: 0 };

  // Build the zone: top strike ± 1 strikeStep (3 strikes total)
  const zoneStrikes = [top.strike - strikeStep, top.strike, top.strike + strikeStep]
    .filter((k) => strikes.some((s) => s.strike === k))
    .sort((a, b) => a - b);

  // If only 1-2 strikes matched (edge of chain), fall back to top-3 scored strikes
  const zone = zoneStrikes.length >= 2
    ? zoneStrikes
    : scored.slice(0, 3).map((s) => s.strike).sort((a, b) => a - b);

  // Weighted center (by score)
  const zoneScored = scored.filter((s) => zone.includes(s.strike));
  const totalScore = zoneScored.reduce((sum, s) => sum + s.score, 0) || 1;
  const center = zoneScored.reduce((sum, s) => sum + s.strike * s.score, 0) / totalScore;

  // Magnet score (0..100) = how concentrated the top score is
  const magnetScore = Math.min(100, Math.round(top.score * 100));

  return { zone, center, score: magnetScore };
}

/**
 * Compute pinning probability — the probability that spot will close within
 * the magnet zone today.
 *
 * Factors (each 0..1, weighted sum then scaled to 0..100):
 *   1. Distance to magnet center (closer = higher pin prob)
 *   2. Time to expiry (fewer DTE = stronger pin)
 *   3. Gamma regime (positive gamma = sticky = higher pin)
 *   4. GEX concentration (high |GEX| at magnet = stronger pin)
 *   5. Charm aligned with current price-vs-magnet gap (charm pulls toward magnet)
 */
export function computePinningProbability(
  spot: number,
  magnetCenter: number,
  magnetScore: number,
  daysToExpiry: number,
  gammaRegime: 'positive' | 'negative' | 'neutral',
  totalGexAbsCr: number,
  charmDirection: 'up' | 'down' | 'flat',
  strikeStep: number,
): number {
  // 1. Distance factor
  const dist = Math.abs(spot - magnetCenter);
  const distPct = (dist / spot) * 100;
  const distFactor = Math.max(0, 1 - distPct / 1.5); // 1.5% away → 0

  // 2. DTE factor — pin force grows ~1/sqrt(DTE)
  const dte = Math.max(0.5, daysToExpiry);
  const dteFactor = Math.max(0.2, Math.min(1, 1 / Math.sqrt(dte)));

  // 3. Gamma regime factor
  const regimeFactor = gammaRegime === 'positive' ? 1.0
                     : gammaRegime === 'negative' ? 0.3
                     : 0.6;

  // 4. GEX concentration factor — scales with sqrt(|GEX|) so it doesn't dominate
  const gexFactor = Math.max(0.2, Math.min(1, Math.sqrt(totalGexAbsCr) / 30));

  // 5. Charm alignment — does charm push spot TOWARD magnet?
  let charmFactor = 0.5;
  if (magnetCenter > spot && charmDirection === 'up') charmFactor = 1.0;
  else if (magnetCenter < spot && charmDirection === 'down') charmFactor = 1.0;
  else if (charmDirection === 'flat') charmFactor = 0.6;
  else charmFactor = 0.3; // charm pushes AWAY from magnet — anti-pin

  // Weighted sum
  const weights = { dist: 0.35, dte: 0.20, regime: 0.15, gex: 0.15, charm: 0.15 };
  const composite = distFactor * weights.dist
                  + dteFactor * weights.dte
                  + regimeFactor * weights.regime
                  + gexFactor * weights.gex
                  + charmFactor * weights.charm;

  // Scale to 0..100, with magnetScore as a multiplier (max 1.0)
  const probability = Math.round(Math.min(100, Math.max(0,
    composite * (0.5 + magnetScore / 200) * 100
  )));

  return probability;
}

// ─── Master Compute ───

/**
 * Compute the full magnet result for a single symbol.
 *
 * @param strikes     per-strike option data (OI, LTP, IV optional)
 * @param spot        spot price
 * @param lotSize     contract lot size
 * @param strikeStep  strike gap (e.g. 50 for Nifty, 100 for BankNifty)
 * @param daysToExpiry  days to nearest expiry (fractional OK; min 0.5)
 * @param meta        symbol metadata (name, type, time)
 */
export function computeMagnet(
  symbol: string,
  strikes: StrikeOption[],
  spot: number,
  lotSize: number,
  strikeStep: number,
  daysToExpiry: number,
  meta: { name: string; type: 'index' | 'stock'; spotTime: string },
): MagnetResult | null {
  if (strikes.length < 3 || spot <= 0) return null;

  const T = Math.max(0.5, daysToExpiry) / 365; // years, floored at 0.5 day
  const totalCEOI = strikes.reduce((s, k) => s + k.ceOI, 0);
  const totalPEOI = strikes.reduce((s, k) => s + k.peOI, 0);
  const pcr = totalCEOI > 0 ? totalPEOI / totalCEOI : 0;

  // 1. Max pain
  const maxPain = computeMaxPain(strikes);
  const maxPainDist = spot - maxPain;
  const maxPainDistPct = (maxPainDist / spot) * 100;

  // 2. GEX
  const gexStrikes = computeGEX(strikes, spot, T, lotSize);
  const totalGexShares = gexStrikes.reduce((s, g) => s + g.gexShares, 0);
  const totalGexCr = (totalGexShares * spot * 0.01) / 1e7;
  const zeroGamma = findZeroGamma(gexStrikes, spot);

  // Gamma regime: above zero-gamma flip → positive; below → negative; at flip → neutral
  let gammaRegime: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (zeroGamma !== null) {
    if (spot > zeroGamma * 1.001) gammaRegime = 'positive';
    else if (spot < zeroGamma * 0.999) gammaRegime = 'negative';
  } else {
    // No zero-crossing — entire chain is one sign
    gammaRegime = totalGexShares > 0 ? 'positive' : 'negative';
  }

  // 3. Charm
  const charmStrikes = computeCharm(strikes, spot, T, lotSize);
  const totalCharmShares = charmStrikes.reduce((s, c) => s + c.charmShares, 0);
  const charmMagnitudeCr = Math.abs((totalCharmShares * spot * 0.01) / 1e7);
  const charmDirection: 'up' | 'down' | 'flat' =
    Math.abs(totalCharmShares) < charmStrikes.length * 100 // noise floor
      ? 'flat'
      : totalCharmShares > 0 ? 'up' : 'down';

  // 4. Magnet Zone
  const { zone, center, score } = computeMagnetZone(
    strikes, gexStrikes, maxPain, spot, strikeStep
  );

  // 5. Pinning probability
  const pinningProbability = computePinningProbability(
    spot, center, score, daysToExpiry,
    gammaRegime, Math.abs(totalGexCr), charmDirection, strikeStep
  );

  return {
    symbol,
    name: meta.name,
    type: meta.type,
    spot,
    spotTime: meta.spotTime,
    maxPain,
    maxPainDist,
    maxPainDistPct,
    gexStrikes,
    totalGexCr,
    zeroGamma,
    gammaRegime,
    magnetZone: zone,
    magnetCenter: center,
    magnetScore: score,
    pinningProbability,
    charmDirection,
    charmMagnitudeCr,
    charmStrikes,
    totalCEOI,
    totalPEOI,
    pcr,
    daysToExpiry,
    lotSize,
    strikeStep,
  };
}
