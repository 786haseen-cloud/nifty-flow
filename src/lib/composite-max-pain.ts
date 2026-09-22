/**
 * Composite Max Pain magnet — aggregates (maxPain − spot) across all
 * 4 indices + 15 F&O stocks into a single OI-weighted pull number.
 * (FULL-AUDIT doc fix: the header previously said "(spot − maxPain)" while
 * the implementation — correctly — computes maxPain − spot as the UP pull;
 * a positive composite = magnet above spot = price pulled UP.)
 *
 * Concept (per user spec):
 *   For each symbol, if spot is ABOVE max pain → option writers (dealers)
 *   are in profit and the magnet pulls the spot DOWN toward max pain.
 *   If spot is BELOW max pain → the magnet pulls UP.
 *
 *   Aggregate the (maxPain − spot) weighted by each symbol's total OI to get
 *   the *real* rupee-weighted magnetic pull of the whole market.
 *
 * Output is consumed by the Composite Max Pain card on the OI Walls tab.
 *
 * The max-pain-scan route already returns everything we need per symbol:
 *   { symbol, type, spot, maxPain, dist, distPct, totalCEOI, totalPEOI }
 * No additional API calls are required — this module is pure computation
 * layered on top of that response.
 */
import { INDEX_SPECS, STOCK_SPECS } from './kite-api';

export interface MaxPainScanItem {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spot: number;
  maxPain: number;
  dist: number;      // spot − maxPain (positive = above)
  distPct: number;   // (spot − maxPain) / spot × 100
  totalCEOI: number;
  totalPEOI: number;
}

export interface CompositeMaxPainResult {
  /** OI-weighted % pull. Positive = market pulled UP, negative = DOWN. */
  oiWeightedPullPct: number;
  /** Equal-weighted % pull (sentiment — every symbol counts same). */
  equalWeightedPullPct: number;
  /** Sum of (maxPain − spot) × total_OI_notional across indices, in ₹ Cr. */
  indicesPullCr: number;
  /** Sum of (maxPain − spot) × total_OI_notional across stocks, in ₹ Cr. */
  stocksPullCr: number;
  /** Total magnet pull across all 19 symbols, in ₹ Cr. Sign = direction. */
  totalPullCr: number;
  /** # symbols with spot BELOW max pain → pull UP. */
  upCount: number;
  /** # symbols with spot ABOVE max pain → pull DOWN. */
  downCount: number;
  /** # symbols with spot ≈ max pain (within 0.05%). */
  flatCount: number;
  /** Total symbol count (should be 4 + 15 = 19). */
  totalCount: number;
  /** Direction verdict. */
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  /** Per-symbol contribution breakdown, sorted by |contributionCr| desc. */
  perSymbol: CompositeRow[];
}

export interface CompositeRow {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  exchange: 'NSE' | 'BSE';
  spot: number;
  maxPain: number;
  /** (maxPain − spot) in price units. Positive = UP pull, negative = DOWN. */
  diffPts: number;
  /** (maxPain − spot) / spot × 100. */
  diffPct: number;
  /** total OI (CE + PE) in raw share units. */
  totalOI: number;
  /** Notional ₹ Cr = totalOI × spot / 1e7. */
  notionalCr: number;
  /** (maxPain − spot) × totalOI / 1e7 — the symbol's contribution to totalPullCr. */
  contributionCr: number;
  /** Weight in the OI-weighted average. */
  oiWeight: number;
  /** Local direction tag for the per-symbol row. */
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
}

/**
 * Resolve which exchange a symbol trades on (NSE vs BSE).
 * Only SENSEX is BSE in our 4 + 15 basket. Everything else is NSE.
 * We could lift this from InstrumentSpec.exchange but we don't always
 * have the spec in client components, so a tiny lookup is safer.
 */
function exchangeOf(symbol: string): 'NSE' | 'BSE' {
  if (symbol === 'SENSEX') return 'BSE';
  return 'NSE';
}

/**
 * Compute the composite magnet across an array of per-symbol max pain readings.
 * Pure function — safe to call from server or client.
 */
export function computeCompositeMaxPain(items: MaxPainScanItem[]): CompositeMaxPainResult {
  const rows: CompositeRow[] = items.map(item => {
    const diffPts = item.maxPain - item.spot; // positive = UP pull
    const diffPct = item.spot > 0 ? (diffPts / item.spot) * 100 : 0;
    const totalOI = item.totalCEOI + item.totalPEOI;
    const notionalCr = (totalOI * item.spot) / 1e7;
    const contributionCr = (diffPts * totalOI) / 1e7;
    const direction: CompositeRow['direction'] =
      Math.abs(diffPct) < 0.05 ? 'NEUTRAL' : diffPts > 0 ? 'UP' : 'DOWN';
    return {
      symbol: item.symbol,
      name: item.name,
      type: item.type,
      exchange: exchangeOf(item.symbol),
      spot: item.spot,
      maxPain: item.maxPain,
      diffPts,
      diffPct,
      totalOI,
      notionalCr,
      contributionCr,
      oiWeight: 0, // filled in after we know the total
      direction,
    };
  });

  // Total OI for weighting
  const totalOIAll = rows.reduce((s, r) => s + r.totalOI, 0);
  for (const r of rows) {
    r.oiWeight = totalOIAll > 0 ? r.totalOI / totalOIAll : 0;
  }

  // OI-weighted % pull = Σ diffPct × oiWeight
  const oiWeightedPullPct = rows.reduce((s, r) => s + r.diffPct * r.oiWeight, 0);
  // Equal-weighted % pull = simple average of diffPct
  const equalWeightedPullPct = rows.length > 0
    ? rows.reduce((s, r) => s + r.diffPct, 0) / rows.length
    : 0;

  // ₹ Cr pull split by type
  const indicesPullCr = rows
    .filter(r => r.type === 'index')
    .reduce((s, r) => s + r.contributionCr, 0);
  const stocksPullCr = rows
    .filter(r => r.type === 'stock')
    .reduce((s, r) => s + r.contributionCr, 0);
  const totalPullCr = indicesPullCr + stocksPullCr;

  // Direction counts
  let upCount = 0, downCount = 0, flatCount = 0;
  for (const r of rows) {
    if (r.direction === 'UP') upCount++;
    else if (r.direction === 'DOWN') downCount++;
    else flatCount++;
  }

  // Composite direction verdict — uses OI-weighted magnitude
  let direction: CompositeMaxPainResult['direction'] = 'NEUTRAL';
  if (Math.abs(oiWeightedPullPct) >= 0.1) {
    direction = oiWeightedPullPct > 0 ? 'UP' : 'DOWN';
  }

  // Sort per-symbol rows by absolute contribution descending
  rows.sort((a, b) => Math.abs(b.contributionCr) - Math.abs(a.contributionCr));

  return {
    oiWeightedPullPct,
    equalWeightedPullPct,
    indicesPullCr,
    stocksPullCr,
    totalPullCr,
    upCount,
    downCount,
    flatCount,
    totalCount: rows.length,
    direction,
    perSymbol: rows,
  };
}

/**
 * Format ₹ Cr with sign for compact UI display.
 *   +1234.50 Cr → "+1,234 Cr"
 *   -75.2 Cr    → "−75 Cr"
 *   < 1 Cr      → "+0.42 Cr"
 */
export function formatPullCr(cr: number): string {
  const sign = cr > 0 ? '+' : cr < 0 ? '−' : '';
  const abs = Math.abs(cr);
  if (abs >= 1000) return `${sign}${(abs).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  if (abs >= 10) return `${sign}${abs.toFixed(0)} Cr`;
  return `${sign}${abs.toFixed(2)} Cr`;
}

/**
 * Format % pull with sign for compact UI display.
 *   +0.42  → "+0.42%"
 *   -0.18  → "−0.18%"
 */
export function formatPullPct(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/**
 * Static lookups (re-exported for the card) — handy when you need the full
 * symbol roster without importing INDEX_SPECS / STOCK_SPECS directly.
 */
export const ALL_SYMBOLS_COMPOSITE = [
  ...INDEX_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'index' as const })),
  ...STOCK_SPECS.map(s => ({ symbol: s.symbol, name: s.name, type: 'stock' as const })),
];
