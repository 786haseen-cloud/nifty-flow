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
 */

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';

// Session boundaries in minutes-since-midnight IST
const SESSION_OPEN_MIN = 9 * 60 + 15;   // 09:15 — cash + F&O open
const SESSION_CLOSE_MIN = 15 * 60 + 40; // 15:40 — F&O close (cash closes 15:30)

const IST_OFFSET_MIN = 330; // +5:30 in minutes

/** Convert a Date to minutes-since-midnight + weekday in IST. */
function istNow(now: Date = new Date()): { mins: number; day: number } {
  // Shift by IST offset relative to local timezone
  const ist = new Date(now.getTime() + (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000);
  return {
    mins: ist.getHours() * 60 + ist.getMinutes(),
    day: ist.getDay(), // 0 = Sun, 6 = Sat
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
 */
export function isTradingSessionActive(now: Date = new Date()): boolean {
  return getMarketPhase(now) === 'open';
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
