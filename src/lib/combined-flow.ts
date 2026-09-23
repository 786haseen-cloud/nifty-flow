/**
 * Combined flow computation — shared between OptionFlowTV (single-symbol) and
 * CombinedFlowCard (4-index aggregate). Computes 4-quadrant ₹ Cr flow:
 *   CE Buy    — OI up + LTP up  (call buyers lifting offers)
 *   CE Write  — OI up + LTP dn  (call writers hitting bids)
 *   PE Buy    — OI up + LTP up  (put buyers lifting offers — bearish)
 *   PE Write  — OI up + LTP dn  (put writers hitting bids — bullish)
 * Formula: ΔOI × LTP × lotSize per strike, summed across strikes.
 *
 * Defensive: returns zeros if the symbol is missing from either snapshot
 * (e.g. one index hasn't landed yet — the combined view just sums the others).
 *
 * Pure function — safe for client bundle, no I/O.
 */

import type { KiteSnapshot } from '@/hooks/use-kite-snapshot';
import { INDEX_SPECS } from '@/lib/kite-api';

export interface FlowQuadrant {
  ceBuy: number;
  peWrite: number;
  peBuy: number;
  ceWrite: number;
}

export const CROR = 10000000;

export const FLOW_INDICES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'] as const;

/** Compute 4-quadrant flow (in ₹, NOT ₹ Cr — divide by CROR for display) for a
 *  single symbol between two consecutive snapshots. */
export function computeSymbolFlow(
  curr: KiteSnapshot,
  prev: KiteSnapshot,
  symbol: string,
): FlowQuadrant {
  const spec = INDEX_SPECS.find(s => s.symbol === symbol);
  const lotSize = spec?.lotSize || 1;
  const currFlow = (curr.symbols || []).find((s) => s.symbol === symbol);
  const prevFlow = (prev.symbols || []).find((s) => s.symbol === symbol);
  if (!currFlow || !prevFlow) {
    return { ceBuy: 0, peWrite: 0, peBuy: 0, ceWrite: 0 };
  }

  let ceBuy = 0, peWrite = 0, peBuy = 0, ceWrite = 0;
  for (const cs of currFlow.strikes || []) {
    const ps = (prevFlow.strikes || []).find((s) => s.strike === cs.strike);
    if (!ps) continue;

    const ceOiChg = (cs.ceOI || 0) - (ps.ceOI || 0);
    const peOiChg = (cs.peOI || 0) - (ps.peOI || 0);
    const ceLtpChg = (cs.ceLTP || 0) - (ps.ceLTP || 0);
    const peLtpChg = (cs.peLTP || 0) - (ps.peLTP || 0);

    // CE Buy: OI increased + LTP up (writers paying up = buyers aggressive)
    if (ceOiChg > 0 && ceLtpChg >= 0) ceBuy += ceOiChg * (cs.ceLTP || 0) * lotSize;
    // CE Write: OI increased + LTP down (writers adding at lower prices = selling)
    else if (ceOiChg > 0 && ceLtpChg < 0) ceWrite += ceOiChg * (cs.ceLTP || 0) * lotSize;

    // PE Buy: OI increased + LTP up (put buyers lifting offers — bearish)
    if (peOiChg > 0 && peLtpChg > 0) peBuy += peOiChg * (cs.peLTP || 0) * lotSize;
    // PE Write: OI increased + LTP down (writers hitting bids — bullish)
    else if (peOiChg > 0 && peLtpChg <= 0) peWrite += peOiChg * (cs.peLTP || 0) * lotSize;
  }
  return { ceBuy, peWrite, peBuy, ceWrite };
}

/** Sum 4-quadrant flow across the 4 indices (the 'ALL' combined view). */
export function computeCombinedFlow(
  curr: KiteSnapshot,
  prev: KiteSnapshot,
): FlowQuadrant {
  let ceBuy = 0, peWrite = 0, peBuy = 0, ceWrite = 0;
  for (const sym of FLOW_INDICES) {
    const f = computeSymbolFlow(curr, prev, sym);
    ceBuy += f.ceBuy; peWrite += f.peWrite; peBuy += f.peBuy; ceWrite += f.ceWrite;
  }
  return { ceBuy, peWrite, peBuy, ceWrite };
}
