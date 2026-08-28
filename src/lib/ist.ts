/**
 * Centralized IST (Indian Standard Time) utilities.
 *
 * ALL server-side code (Vercel runs in UTC) MUST use these helpers for any
 * date/time operations related to the Indian market. This prevents the
 * class of bugs where toLocaleTimeString / toDateString / getHours etc.
 * silently use UTC instead of IST, shifting all times by -5:30.
 *
 * Client-side code (browser) does NOT need this — the user's device
 * typically runs in IST already, and the trend-store handles its own
 * date boundary checks.
 */

// ─── Constants ───

/** IST offset from UTC in milliseconds (+5:30) */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─── Core helpers ───

/**
 * Get a Date object representing the current moment in IST.
 * The returned Date's UTC fields (getUTCHours, getUTCMinutes, etc.)
 * will contain IST values — so you can use getUTCHours()/getUTCDate()
 * to read IST time without timezone conversion.
 */
export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Convert any Date to an "IST-shifted" Date (same as istNow but for
 * an arbitrary moment). Useful for formatting in IST context.
 */
export function toIST(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * Get current IST date as 'YYYY-MM-DD'.
 * Safe on both UTC (Vercel) and IST-local servers.
 */
export function istDateStr(): string {
  const d = istNow();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Get current IST time as 'HH:MM:SS' (24-hour).
 */
export function istTimeStr(): string {
  const d = istNow();
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * Get current IST time as 'HH:MM' (24-hour, no seconds).
 */
export function istTimeShort(): string {
  const d = istNow();
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Format a Date for Kite historical API: 'YYYY-MM-DD HH:MM:SS'.
 * Converts the input Date to IST before formatting.
 */
export function istKiteDateFormat(d: Date): string {
  const ist = toIST(d);
  return `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())} ${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())}:${pad2(ist.getUTCSeconds())}`;
}

/**
 * Extract 'HH:MM' directly from a Kite timestamp string.
 * Kite always returns IST timestamps like '2026-08-28T09:15:00+0530'.
 * This is the safest way to get IST time — no Date parsing, no timezone.
 */
export function extractTimeFromKiteTS(ts: string | number): string {
  const s = String(ts);
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

/**
 * Extract 'HH:MM:SS' directly from a Kite timestamp string.
 */
export function extractTimeSecFromKiteTS(ts: string | number): string {
  const s = String(ts);
  const m = s.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/**
 * Get today's date as an ISO date string in IST for comparison purposes.
 * Returns 'YYYY-MM-DD' which can be compared directly with Kite expiry
 * strings (also 'YYYY-MM-DD').
 *
 * Usage:  expiry >= istTodayISO()  →  finds nearest future expiry
 */
export function istTodayISO(): string {
  return istDateStr();
}

/**
 * Get a human-readable date string in IST (e.g. '28 Aug 2026').
 * Replaces toLocaleDateString('en-IN') which uses system timezone.
 */
export function istDateReadable(): string {
  const d = istNow();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ─── Internal ───

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
