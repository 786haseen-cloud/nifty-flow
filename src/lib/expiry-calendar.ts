/**
 * Indian market expiry calendar (NSE Tuesday / BSE Thursday).
 *
 * As of 2025-2026 expiry regime:
 *   NSE (Tue)   — NIFTY 50 weekly + monthly;
 *                 BANKNIFTY / FINNIFTY / MIDCAPNIFTY / all 15 F&O stocks monthly only.
 *   BSE (Thu)   — SENSEX weekly + monthly.
 *
 * Last Tuesday of month → "super monthly" because the entire NSE basket
 * (NIFTY + BANKNIFTY + FINNIFTY + 15 stocks) settles simultaneously.
 *
 * Last Thursday of month → SENSEX monthly only (narrower OI scope).
 *
 * Used by the Composite Max Pain card to attach a reliability tier to the
 * aggregated magnet reading — the same composite number is *much* more
 * meaningful on a monthly-expiry day than on a mid-week drift day.
 *
 * NOTE: Holiday-shifted expiries are not yet handled (rare; affects ~3-4
 * days a year). For v1 we treat the last Tuesday/Thursday of the month
 * as the expiry day regardless. A TODO is left for future hardening.
 */
import { istNow } from './ist';

export type ExpiryType = 'MONTHLY' | 'WEEKLY' | 'NONE';
export type MagnetStrength = 'STRONGEST' | 'STRONG' | 'BUILDING' | 'WEAK';

export interface ExpiryContext {
  /** Today's day-of-week in IST (0=Sun … 4=Thu) */
  istDow: number;
  /** 'MONTHLY' if today is the last Tuesday of month (NSE super-basket expiry), 'WEEKLY' if any other Tuesday, else 'NONE' */
  nseExpiryType: ExpiryType;
  /** 'MONTHLY' if today is the last Thursday of month (BSE SENSEX expiry), 'WEEKLY' if any other Thursday, else 'NONE' */
  bseExpiryType: ExpiryType;
  /** Calendar days until next NSE Tuesday expiry (0 = today, 1 = tomorrow, ...) */
  daysToNSEExpiry: number;
  /** Calendar days until next BSE Thursday expiry (0 = today, 1 = tomorrow, ...) */
  daysToBSEExpiry: number;
  /** Composite reliability tier 1 (strongest) → 4 (weakest, drift) */
  tier: 1 | 2 | 3 | 4;
  /** Short label like "TIER 1 — Super Monthly (NSE)" */
  tierLabel: string;
  /** One-sentence description of why this tier */
  tierDescription: string;
  /** Verbal strength bucket used by the magnet-strength badge */
  magnetStrength: MagnetStrength;
}

const DOW_TUE = 2;
const DOW_THU = 4;

/**
 * Is the given (IST-shifted) date the last occurrence of `targetDow` in its month?
 * Strategy: if today is the target day-of-week AND (today + 7 days) crosses
 * into a different month, then today is the last occurrence.
 *
 * Operates on UTC getters because callers pass an istNow()-style Date
 * (whose UTC fields hold IST values).
 */
function isLastWeekdayOfMonth(istDate: Date, targetDow: number): boolean {
  if (istDate.getUTCDay() !== targetDow) return false;
  const next = new Date(istDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return next.getUTCMonth() !== istDate.getUTCMonth();
}

/**
 * Days until the next occurrence of `targetDow` (0 = today is that day).
 */
function daysUntilWeekday(istDate: Date, targetDow: number): number {
  const today = istDate.getUTCDay();
  let diff = (targetDow - today + 7) % 7;
  return diff;
}

/**
 * Compute the full expiry context for the given IST moment.
 * Defaults to "now" — call with no args for the live market session.
 */
export function getExpiryContext(now: Date = istNow()): ExpiryContext {
  const istDow = now.getUTCDay();

  // ─── NSE Tuesday ───
  let nseExpiryType: ExpiryType = 'NONE';
  if (istDow === DOW_TUE) {
    nseExpiryType = isLastWeekdayOfMonth(now, DOW_TUE) ? 'MONTHLY' : 'WEEKLY';
  }
  const daysToNSEExpiry = daysUntilWeekday(now, DOW_TUE);

  // ─── BSE Thursday ───
  let bseExpiryType: ExpiryType = 'NONE';
  if (istDow === DOW_THU) {
    bseExpiryType = isLastWeekdayOfMonth(now, DOW_THU) ? 'MONTHLY' : 'WEEKLY';
  }
  const daysToBSEExpiry = daysUntilWeekday(now, DOW_THU);

  // ─── Composite tier ───
  // TIER 1 — NSE monthly (super-basket) OR BSE monthly (SENSEX)
  // TIER 2 — NSE weekly (NIFTY) OR BSE weekly (SENSEX)
  // TIER 3 — 1 calendar day before any expiry (Mon before Tue / Wed before Thu)
  // TIER 4 — mid-week drift, no expiry within 1 day
  let tier: 1 | 2 | 3 | 4;
  let tierLabel: string;
  let tierDescription: string;
  let magnetStrength: MagnetStrength;

  const nseToday = nseExpiryType !== 'NONE';
  const bseToday = bseExpiryType !== 'NONE';
  const nseMonthlyToday = nseExpiryType === 'MONTHLY';
  const bseMonthlyToday = bseExpiryType === 'MONTHLY';

  if (nseMonthlyToday) {
    tier = 1;
    tierLabel = 'TIER 1 — Super Monthly (NSE)';
    tierDescription =
      'Last Tuesday of the month — NIFTY + BANKNIFTY + FINNIFTY + 15 stocks all settle today. Strongest composite magnet of the entire month.';
    magnetStrength = 'STRONGEST';
  } else if (bseMonthlyToday) {
    tier = 1;
    tierLabel = 'TIER 1 — SENSEX Monthly (BSE)';
    tierDescription =
      'Last Thursday of the month — SENSEX monthly settles. Strong but narrower OI scope than NSE super-Tuesday.';
    magnetStrength = 'STRONG';
  } else if (nseToday) {
    tier = 2;
    tierLabel = 'TIER 2 — NIFTY Weekly (NSE)';
    tierDescription =
      'Weekly NIFTY expiry today (Tuesday). Live magnet on NIFTY only; BANKNIFTY/FINNIFTY/stocks drift toward their own monthly anchors.';
    magnetStrength = 'STRONG';
  } else if (bseToday) {
    tier = 2;
    tierLabel = 'TIER 2 — SENSEX Weekly (BSE)';
    tierDescription =
      'Weekly SENSEX expiry today (Thursday). Live magnet on SENSEX; rest of market drifts.';
    magnetStrength = 'STRONG';
  } else if (daysToNSEExpiry === 1 || daysToBSEExpiry === 1) {
    tier = 3;
    tierLabel = 'TIER 3 — Building (T-1)';
    tierDescription =
      'One calendar day before an expiry. Magnet is building as dealers hedge into the close — useful early signal but not yet binding.';
    magnetStrength = 'BUILDING';
  } else {
    tier = 4;
    tierLabel = 'TIER 4 — Drift (no near expiry)';
    tierDescription =
      'No expiry today or tomorrow. Max pain magnet is weak — do not overweight this reading against intraday momentum or institutional flow.';
    magnetStrength = 'WEAK';
  }

  return {
    istDow,
    nseExpiryType,
    bseExpiryType,
    daysToNSEExpiry,
    daysToBSEExpiry,
    tier,
    tierLabel,
    tierDescription,
    magnetStrength,
  };
}

/**
 * Convenience: short emoji-free marker string suitable for compact UI badges.
 * Example: "NSE MONTHLY • BSE none" or "NSE weekly • BSE none".
 */
export function shortExpirySummary(ctx: ExpiryContext): string {
  const nse = ctx.nseExpiryType === 'NONE' ? '—' : ctx.nseExpiryType.toLowerCase();
  const bse = ctx.bseExpiryType === 'NONE' ? '—' : ctx.bseExpiryType.toLowerCase();
  return `NSE ${nse} • BSE ${bse}`;
}
