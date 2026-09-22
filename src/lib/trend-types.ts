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

import { classifyStrikeFlow } from './option-flow-classify';

export interface NiftyCandle {
  time: string;
  close: number;
  high: number;
  low: number;
  volume: number;
  /** IST trading date 'YYYY-MM-DD' (Task 46 FIFO). Server stamps it from
   *  the Kite candle timestamp; the store evicts any candle not dated
   *  today — "yesterday out, new data in". Optional for demo/legacy data. */
  d?: string;
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
  /** IST trading date 'YYYY-MM-DD' (Task 46 FIFO — evict non-today pts). */
  d?: string;
}

export interface FlowTrendPoint {
  time: string;
  /** IST trading date 'YYYY-MM-DD' (Task 46 FIFO — evict non-today pts). */
  d?: string;
  NIFTY: number;
  BANKNIFTY: number;
  FINNIFTY: number;
  SENSEX: number;
  stockAggregate: number;
  // Per-stock cumulative option money flow (Cr). Added Sep 11 2026 — the
  // aggregate line at ±14,000 Cr hides which stock is driving the move.
  // Per-stock values are at NIFTY-like scale (~10-500 Cr each), so live
  // 15s oscillations are visible when the user selects one in the
  // Stock Options Money Flow card's dropdown.
  HDFCBANK: number;
  ICICIBANK: number;
  RELIANCE: number;
  BHARTIARTL: number;
  LT: number;
  SBIN: number;
  INFY: number;
  AXISBANK: number;
  KOTAKBANK: number;
  'M&M': number;
  BAJFINANCE: number;
  ITC: number;
  TCS: number;
  ETERNAL: number;
  TITAN: number;
}

export interface HighestBetResponse {
  /** Tight union — trend-store gates flow math on this (never accumulate demo data). */
  mode: 'live' | 'demo' | 'error';
  timestamp: string;
  symbols: SymbolSnapshot[];
}

export const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'] as const;

// 15 F&O stocks tracked by the engine. Order matches STOCK_SPECS in kite-api.ts
// (by NIFTY weight). Single source of truth — used by trend-store (initial
// cumulative + per-stock delta accumulation) and trend-analysis-tab (the
// stock selector dropdown).
export const STOCK_SYMBOLS = [
  'HDFCBANK', 'ICICIBANK', 'RELIANCE', 'BHARTIARTL', 'LT',
  'SBIN', 'INFY', 'AXISBANK', 'KOTAKBANK', 'M&M',
  'BAJFINANCE', 'ITC', 'TCS', 'ETERNAL', 'TITAN',
] as const;

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
 *   - Δ OI > 0  → new positions opened, valued at full delta
 *   - Δ OI < 0  → positions closed (short covering / unwinding), valued at 0.3× factor
 * (OI is unit-denominated — contracts × lot — so the valuation is lot-free;
 * see option-flow-classify.ts full-audit unit fix.)
 *
 * Direction = canonical OI×premium buildup table (see option-flow-classify.ts
 * for the full table + the Sep 17 2026 put-side fix). Classification lives in
 * the SHARED classifier — this wrapper and /api/kite/historical-flow must
 * never drift apart again (the put-side inversion the user caught lived
 * precisely in that drift).
 */
export function computeSymbolFlow(
  prev: StrikeData[],
  curr: StrikeData[],
): { bullish: number; bearish: number; net: number } {
  let bullish = 0;
  let bearish = 0;

  for (const currStrike of curr) {
    const prevStrike = prev.find((s) => s.strike === currStrike.strike);
    if (!prevStrike) continue;

    // FULL-AUDIT UNIT FIX: OI is Kite-unit denominated (contracts × lot).
    // classifyStrikeFlow no longer takes a lotSize — valuing unit-OI with
    // the lot again double-counted (NIFTY flows overstated 75×).
    const leg = classifyStrikeFlow(
      {
        ceOI: prevStrike.ceOI,
        peOI: prevStrike.peOI,
        ceLTP: prevStrike.ceLTP,
        peLTP: prevStrike.peLTP,
        ceDelta: currStrike.ceDelta,
        peDelta: currStrike.peDelta,
      },
      {
        ceOI: currStrike.ceOI,
        peOI: currStrike.peOI,
        ceLTP: currStrike.ceLTP,
        peLTP: currStrike.peLTP,
        ceDelta: currStrike.ceDelta,
        peDelta: currStrike.peDelta,
      },
    );
    bullish += leg.bullish;
    bearish += leg.bearish;
  }

  return { bullish, bearish, net: bullish - bearish };
}
