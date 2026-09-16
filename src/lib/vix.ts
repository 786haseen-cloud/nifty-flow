/**
 * India VIX — real quote helpers shared by /api/kite/vix and /api/vix.
 *
 * WHY THIS EXISTS: generateDemoVIX() returns a RANDOM number in the 12–22
 * band and was feeding the Greeks & Decay "Panic Meter" card directly from
 * the client — the dashboard showed a made-up VIX (user caught it: real
 * India VIX was 13.17 while the card showed ~19) even though the signal
 * engine itself always read the REAL NSE:INDIA VIX quote from Kite
 * (magnet-scan batch + factor 13 VIX momentum). This module gives every
 * consumer the same engine-grade quote.
 */
import { getQuotes } from './kite-api';
import { generateDemoVIX } from './demo-data';
import type { VIXData } from './types';

export const INDIA_VIX_SYMBOL = 'NSE:INDIA VIX';

/** India-calibrated percentile — India VIX historically lives in a 9–25 band
 *  (see magnet-engine INDIA CALIBRATION note: typical 10–15). Linear map,
 *  approximate by design; NSE publishes no official daily percentile. */
function indiaVixPercentile(v: number): number {
  return Math.max(0, Math.min(100, ((v - 9) / 16) * 100));
}

function panicLevelFor(v: number): VIXData['panicLevel'] {
  if (v < 12) return 'calm';
  if (v < 16) return 'normal';
  if (v < 20) return 'elevated';
  return 'panic';
}

/** Build the VIXData display shape from a Kite quote (INDIA VIX index). */
export function buildVixData(q: {
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  netChange: number;
}): VIXData {
  const value = q.lastPrice;
  const change = typeof q.netChange === 'number' && q.netChange !== 0
    ? q.netChange
    : value - q.close;
  const changePercent = q.close ? (change / q.close) * 100 : 0;
  const trend: VIXData['trend'] =
    change > 0.3 ? 'rising' : change < -0.3 ? 'falling' : 'stable';
  return {
    value,
    change,
    changePercent,
    dayHigh: q.high,
    dayLow: q.low,
    dayOpen: q.open,
    trend,
    percentile: Math.round(indiaVixPercentile(value) * 10) / 10,
    panicLevel: panicLevelFor(value),
  };
}

export type VixResult = {
  mode: 'live' | 'demo';
  vix: VIXData;
  error?: string;
};

/** Fetch the real India VIX quote. Falls back to a demo payload ONLY when
 *  Kite is not configured or the fetch fails — never silently: `mode`
 *  tells the caller which one it got, and the UI must badge it. */
export async function fetchIndiaVix(): Promise<VixResult> {
  try {
    const quotes = await getQuotes([INDIA_VIX_SYMBOL]);
    if ('_error' in quotes) {
      return { mode: 'demo', vix: generateDemoVIX(), error: String(quotes._error) };
    }
    const q = quotes[INDIA_VIX_SYMBOL];
    if (!q || !q.lastPrice || q.lastPrice <= 0) {
      return { mode: 'demo', vix: generateDemoVIX(), error: 'India VIX quote unavailable' };
    }
    return { mode: 'live', vix: buildVixData(q) };
  } catch (err) {
    return {
      mode: 'demo',
      vix: generateDemoVIX(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
