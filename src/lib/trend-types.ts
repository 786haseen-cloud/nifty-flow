/**
 * Shared types for the Trend Analysis feature.
 *
 * These types are used by:
 *  - /src/lib/trend-store.ts         (global Zustand store)
 *  - /src/components/dashboard/trend-analysis-tab.tsx  (UI)
 *  - /src/app/api/kite/trends/route.ts                 (API)
 *
 * Keeping them in one place avoids circular imports and makes the
 * data contract between client and server explicit.
 */

export interface NiftyCandle {
  time: string;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface StockCashFlow {
  symbol: string;
  name: string;
  nseLtp: number;
  nseOpen: number;
  nseChange: number;
  nseVolume: number;
  nseCashFlow: number; // (lastPrice - open) * volume  — cumulative since market open
  bseLtp: number;
  bseOpen: number;
  bseChange: number;
  bseVolume: number;
  bseCashFlow: number;
  combinedFlow: number;
  niftyWeight: number;
  weightedFlow: number;
}

export interface StrikeData {
  strike: number;
  ceLTP: number;
  peLTP: number;
  ceOI: number;
  peOI: number;
  ceVol: number;
  peVol: number;
  ceDelta: number;
  peDelta: number;
}

export interface SymbolSnapshot {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spotPrice: number;
  lotSize: number;
  strikes: StrikeData[];
}

/**
 * One point on the cash-flow trend chart.
 *
 * IMPORTANT: `nse`, `bse`, `net`, `weighted` are CUMULATIVE-SINCE-MARKET-OPEN
 * values (Cr), NOT deltas accumulated by the client. This is the key fix —
 * the previous code accumulated deltas and so only showed data from when the
 * tab was first opened, not from market open.
 *
 * `interval` is the 15s delta (Cr) for the same point — used in the header
 * card and tooltip to show "this 15s flow".
 */
export interface CashFlowTrendPoint {
  time: string;
  nse: number;      // cumulative NSE cash flow (Cr) since market open
  bse: number;      // cumulative BSE cash flow (Cr) since market open
  net: number;      // cumulative combined net (Cr) since market open
  weighted: number; // cumulative Nifty-weighted net (Cr) since market open
  interval: number; // this 15s interval's net flow (Cr)
}

export interface FlowTrendPoint {
  time: string;
  NIFTY: number;
  BANKNIFTY: number;
  FINNIFTY: number;
  SENSEX: number;
  stockAggregate: number;
}

export interface HighestBetResponse {
  mode: string;
  timestamp: string;
  symbols: SymbolSnapshot[];
}

export const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'] as const;

export const IDX_COLORS: Record<string, { stroke: string; fill: string; bg: string }> = {
  NIFTY:     { stroke: '#10b981', fill: '#10b98120', bg: 'bg-emerald-500/10' },
  BANKNIFTY: { stroke: '#3b82f6', fill: '#3b82f620', bg: 'bg-blue-500/10' },
  FINNIFTY:  { stroke: '#f59e0b', fill: '#f59e0b20', bg: 'bg-amber-500/10' },
  SENSEX:    { stroke: '#a855f7', fill: '#a855f720', bg: 'bg-purple-500/10' },
};

export const IDX_NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50',
  BANKNIFTY: 'Bank Nifty',
  FINNIFTY: 'Fin Nifty',
  SENSEX: 'Sensex',
};

/**
 * 4-Color Delta-Weighted Flow Engine
 * ----------------------------------
 * Computes net options flow (in ₹ Cr) from two consecutive OI snapshots.
 *
 * For each strike:
 *   - Δ OI > 0  → new positions opened, valued at full delta × lotSize
 *   - Δ OI < 0  → positions closed (short covering / unwinding), valued at 0.3× factor
 *
 * Direction (bullish/bearish) is decided by sign of Δ price:
 *   - CE ΔOI > 0 + Δ price > 0 → CE Buy (bullish)
 *   - CE ΔOI > 0 + Δ price < 0 → CE Write (bearish)
 *   - PE ΔOI > 0 + Δ price > 0 → PE Write (bullish)
 *   - PE ΔOI > 0 + Δ price < 0 → PE Buy (bearish)
 */
export function computeSymbolFlow(
  prev: StrikeData[],
  curr: StrikeData[],
  lotSize: number
): { bullish: number; bearish: number; net: number } {
  let bullish = 0;
  let bearish = 0;

  const CR = 10000000; // 1 Crore

  for (const currStrike of curr) {
    const prevStrike = prev.find((s) => s.strike === currStrike.strike);
    if (!prevStrike) continue;

    const ceDeltaOI = currStrike.ceOI - prevStrike.ceOI;
    const peDeltaOI = currStrike.peOI - prevStrike.peOI;
    const ceDeltaPrice = currStrike.ceLTP - prevStrike.ceLTP;
    const peDeltaPrice = currStrike.peLTP - prevStrike.peLTP;

    // CE Flow
    if (ceDeltaOI > 0) {
      const val = (Math.abs(ceDeltaOI) * currStrike.ceDelta * lotSize) / CR;
      if (ceDeltaPrice > 0) bullish += val;
      else bearish += val;
    } else if (ceDeltaOI < 0) {
      const val = (Math.abs(ceDeltaOI) * 0.3 * currStrike.ceDelta * lotSize) / CR;
      if (ceDeltaPrice > 0) bullish += val;
      else bearish += val;
    }

    // PE Flow
    if (peDeltaOI > 0) {
      const val = (Math.abs(peDeltaOI) * currStrike.peDelta * lotSize) / CR;
      if (peDeltaPrice > 0) bullish += val;
      else bearish += val;
    } else if (peDeltaOI < 0) {
      const val = (Math.abs(peDeltaOI) * 0.3 * currStrike.peDelta * lotSize) / CR;
      if (peDeltaPrice > 0) bullish += val;
      else bearish += val;
    }
  }

  return { bullish, bearish, net: bullish - bearish };
}
