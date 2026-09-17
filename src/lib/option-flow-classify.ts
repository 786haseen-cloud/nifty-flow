/**
 * Single source of truth for the 4-color options flow classification.
 * ---------------------------------------------------------------
 * Consumed by BOTH the client live engine (trend-types.ts computeSymbolFlow,
 * which powers the Index Options Money Flow + Stock Options Money Flow cards)
 * AND the server backfill (/api/kite/historical-flow). Extracted Sep 17 2026
 * after the two copies drifted was proven impossible to keep in sync — the
 * put side had been classified with mirrored premium directions in every copy
 * except strike-flow-map (user caught it: "put premium should be up for PE
 * buy, right?" — YES).
 *
 * THE CANONICAL TABLE (Zerodha Varsity / Sensibull buildup convention,
 * direction = implication for the UNDERLYING):
 *
 * CALLS — premium direction maps 1:1 to aggression:
 *   Δ OI > 0 + Δ price > 0 → CE Buy          (long buildup)      → BULLISH
 *   Δ OI > 0 + Δ price < 0 → CE Write        (short buildup)     → BEARISH
 *   Δ OI < 0 + Δ price > 0 → CE Short Cover (writers buy back)   → BULLISH (0.3×)
 *   Δ OI < 0 + Δ price < 0 → CE Long Unwind  (longs exit)        → BEARISH (0.3×)
 *
 * PUTS — physically mirrored, NOT a 1:1 copy of calls. A put BUYER lifts the
 * offer (premium rises); a put WRITER hits the bid (premium falls):
 *   Δ OI > 0 + Δ price > 0 → PE Buy          (long buildup)      → BEARISH
 *   Δ OI > 0 + Δ price < 0 → PE Write        (short buildup)     → BULLISH
 *   Δ OI < 0 + Δ price > 0 → PE Short Cover (writers buy back)   → BEARISH (0.3×)
 *   Δ OI < 0 + Δ price < 0 → PE Long Unwind  (put longs give up) → BULLISH (0.3×)
 *
 * Valuation: |Δ OI| × |delta| × lotSize / 1e7 = ₹ Cr of delta-weighted
 * notional. Fresh positions (Δ OI > 0) count at full weight; closings at
 * 0.3× (covering/unwinding is lower-conviction than fresh positioning).
 */

export interface StrikeFlowLeg {
  ceOI: number;
  peOI: number;
  ceLTP: number;
  peLTP: number;
  /** |Black-Scholes delta| of the CURRENT snapshot (abs, both legs positive) */
  ceDelta: number;
  peDelta: number;
}

export function classifyStrikeFlow(
  prev: StrikeFlowLeg,
  curr: StrikeFlowLeg,
  lotSize: number,
): { bullish: number; bearish: number } {
  let bullish = 0;
  let bearish = 0;
  const CR = 10000000; // 1 Crore

  const ceDeltaOI = curr.ceOI - prev.ceOI;
  const peDeltaOI = curr.peOI - prev.peOI;
  const ceDeltaPrice = curr.ceLTP - prev.ceLTP;
  const peDeltaPrice = curr.peLTP - prev.peLTP;

  // CE Flow (correct in all historical copies — kept as-is)
  if (ceDeltaOI > 0) {
    const val = (Math.abs(ceDeltaOI) * curr.ceDelta * lotSize) / CR;
    if (ceDeltaPrice > 0) bullish += val; // CE Buy
    else bearish += val;                  // CE Write
  } else if (ceDeltaOI < 0) {
    const val = (Math.abs(ceDeltaOI) * 0.3 * curr.ceDelta * lotSize) / CR;
    if (ceDeltaPrice > 0) bullish += val; // CE Short Covering
    else bearish += val;                  // CE Long Unwinding
  }

  // PE Flow — Sep 17 2026 FIX. Previously: px↑ → bullish ("write"),
  // px↓ → bearish ("buy") — backwards (see file docblock). Now canonical:
  // premium rising with fresh OI = put BUYING (bearish); premium falling
  // with fresh OI = put WRITING (bullish). Covering/unwind mirrored too.
  if (peDeltaOI > 0) {
    const val = (Math.abs(peDeltaOI) * curr.peDelta * lotSize) / CR;
    if (peDeltaPrice > 0) bearish += val; // PE Buy
    else bullish += val;                  // PE Write
  } else if (peDeltaOI < 0) {
    const val = (Math.abs(peDeltaOI) * 0.3 * curr.peDelta * lotSize) / CR;
    if (peDeltaPrice > 0) bearish += val; // PE Short Covering
    else bullish += val;                  // PE Long Unwinding
  }

  return { bullish, bearish };
}
