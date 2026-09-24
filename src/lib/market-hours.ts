/**
 * Market Hours Helper — simple trading-session phase detector.
 *
 * Used to gate polling so we DON'T hit the Kite API (or burn Vercel function
 * invocations) outside the trading session.
 *
 * Phases (IST, Mon–Fri):
 *   'pre'   — before 09:15           (no useful live data; skip polling)
 *   'open'  — 09:15 through 15:40    (cash till 15:30, F&O till 15:40 → poll live)
 *   'post'  — after 15:40, same day  (session over; allow ONE snapshot poll
 *                                     so charts aren't empty, then stop)
 *   'closed'— weekend                (skip polling entirely)
 *
 * Note: NSE holidays are NOT detected (would need a holiday calendar).
 * On holidays the poller will run during 9:15–15:40 but APIs simply return
 * flat/stale data — same behavior as before, no extra harm.
 *
 * The existing CAS-aware session calculator lives in nse-sessions.ts; this
 * module is intentionally simpler because polling decisions only need
 * coarse open/closed boundaries.
 *
 * ─── EXCHANGE TIME GATE ─────────────────────────────────────────────────
 * All time-related gating in the app uses these helpers — they're the single
 * source of truth for "is the exchange open right now?". Two windows:
 *   - Polling gate:  09:15 → 15:40 IST (strict session — no useful data
 *                    during 09:00–09:15 auction window)
 *   - Chart window: 09:00 → 15:40 IST (wider — includes pre-market auction
 *                    in the visible time axis, but doesn't poll for live
 *                    data until 09:15)
 * Both windows exclude weekends (Sat/Sun IST). NSE holidays are NOT detected
 * (would need a calendar) — on holidays the polls run but the API returns
 * flat/stale data, harmless.
 *
 * All helpers use the IST-shifted epoch + UTC getters pattern (DST-immune):
 *   const ist = new Date(now.getTime() + IST_OFFSET_MS);
 *   const hours = ist.getUTCHours();  // ← IST hours
 *   const mins  = ist.getUTCMinutes(); // ← IST minutes
 *   const day   = ist.getUTCDay();    // ← IST weekday
 * Never use local getters (getHours, getMinutes, getDay, getDate) — those
 * silently use the BROWSER's timezone, producing wrong results for any
 * user not in IST (e.g. the user is in Jeddah AST UTC+3).
 */

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';

// Session boundaries in minutes-since-midnight IST
const SESSION_OPEN_MIN = 9 * 60 + 15;   // 09:15 — cash + F&O open
const SESSION_CLOSE_MIN = 15 * 60 + 40; // 15:40 — F&O close (cash closes 15:30)
// Chart visible window includes the pre-market auction (09:00 IST onward).
// Pollers still wait for 09:15 — no useful live data during 09:00–09:15.
const CHART_SESSION_OPEN_MIN = 9 * 60;  // 09:00 — pre-market auction starts

const IST_OFFSET_MIN = 330; // +5:30 in minutes

/** Convert a Date to minutes-since-midnight + weekday in IST.
 *  FULL-AUDIT FIX (DST): the old shift used LOCAL getters on the shifted
 *  date — if a DST transition occurs inside the 5.5h shift window (US/EU
 *  browsers, twice a year) the result drifts ±60 min and 09:15 IST gets
 *  misclassified. UTC getters on the shifted epoch are DST-immune (same
 *  pattern as ist.ts).
 */
function istNow(now: Date = new Date()): { mins: number; day: number } {
  // Shift the epoch to IST, then read via UTC getters (no local TZ input)
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    mins: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    day: ist.getUTCDay(), // 0 = Sun, 6 = Sat
  };
}

/**
 * Current market phase.
 */
export function getMarketPhase(now: Date = new Date()): MarketPhase {
  const { mins, day } = istNow(now);
  if (day === 0 || day === 6) return 'closed';
  if (mins < SESSION_OPEN_MIN) return 'pre';
  if (mins <= SESSION_CLOSE_MIN) return 'open';
  return 'post';
}

/**
 * True when live polling should RUN (session is active).
 * This is the EXCHANGE TIME GATE used by all pollers in the app:
 *   useKiteSnapshot.pollOnce    → getMarketPhase() === 'open'
 *   useMagnetScan.fetchOnce     → getMarketPhase() === 'open' (with post one-shot)
 *   trendStore.pollOnce         → getMarketPhase() === 'open' (with post one-shot)
 * Window: 09:15 → 15:40 IST, Monday–Friday.
 */
export function isTradingSessionActive(now: Date = new Date()): boolean {
  return getMarketPhase(now) === 'open';
}

/**
 * True when the chart should be in its "live session" mode (LIVE badge).
 * Wider than isTradingSessionActive — includes the 09:00–09:15 pre-market
 * auction window so the chart shows the auction period in its visible
 * time axis. Used by the OptFlow TV + Combined Flow chart components to
 * decide when to stop appending new bars (the "card moving on left side"
 * bug fix). Pollers still wait for 09:15 (isTradingSessionActive).
 * Window: 09:00 → 15:40 IST, Monday–Friday.
 */
export function isChartSessionActive(now: Date = new Date()): boolean {
  const { mins, day } = istNow(now);
  if (day === 0 || day === 6) return false;
  return mins >= CHART_SESSION_OPEN_MIN && mins <= SESSION_CLOSE_MIN;
}

/**
 * Today's IST market session as UTC epoch seconds — used by the chart
 * components to pin the visible time axis to 09:00 → 15:40 IST. Returns
 * { from: 09:00 IST, to: 15:40 IST } in UTC epoch seconds (what
 * lightweight-charts expects).
 *
 * Use this instead of inline `Date.UTC(y, m, d, 9, 0, 0) - IST_OFFSET_MS`
 * — keeps the session-window math in one place.
 */
export function getMarketSessionRange(now: Date = new Date()): { from: number; to: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  // Build IST epoch milliseconds, then subtract IST_OFFSET to get UTC epoch.
  const fromMs = Date.UTC(y, m, d, 9, 0, 0) - IST_OFFSET_MIN * 60_000;
  const toMs = Date.UTC(y, m, d, 15, 40, 0) - IST_OFFSET_MIN * 60_000;
  return { from: Math.floor(fromMs / 1000), to: Math.floor(toMs / 1000) };
}

/**
 * Human-readable label for UI display (e.g. "Market Closed — polling paused").
 */
export function getMarketPhaseLabel(phase: MarketPhase): string {
  switch (phase) {
    case 'pre': return 'Pre-Market — polling paused';
    case 'open': return 'Market Open — live';
    case 'post': return 'Market Closed (post 15:40) — polling paused';
    case 'closed': return 'Weekend — polling paused';
  }
}

