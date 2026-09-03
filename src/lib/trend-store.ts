/**
 * Trend Store — global persistent state for the Trend Analysis tab.
 *
 * PROBLEM SOLVED
 * --------------
 * Previously, all trend state lived inside the <TrendAnalysisTab> component as
 * useState/useRef. The shadcn Tabs component unmounts inactive tab content, so
 * switching tabs destroyed all state — when the user came back, the chart was
 * empty and had to re-accumulate from zero.
 *
 * This store fixes that by:
 *   1. Holding all trend state outside any component, so tab switches don't
 *      destroy it.
 *   2. Persisting to localStorage via zustand/middleware/persist, so page
 *      reloads (and even browser restarts on the same day) restore the
 *      morning-to-now trend.
 *   3. Running polling as a singleton — started once at app boot, never
 *      stopped by tab changes. Only one poller instance runs regardless of
 *      how many components subscribe.
 *
 * DATE BOUNDARY
 * -------------
 * All accumulated trend data is keyed to the IST trading date. When a new
 * trading day starts, the store auto-clears stale data so the chart starts
 * fresh each morning.
 */

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { withCreds } from './kite-creds';
import { getMarketPhase } from './market-hours';
import {
  INDEX_SYMBOLS,
  computeSymbolFlow,
  type NiftyCandle,
  type StockCashFlow,
  type StrikeData,
  type SymbolSnapshot,
  type CashFlowTrendPoint,
  type FlowTrendPoint,
  type HighestBetResponse,
} from './trend-types';

// ─── IST date helper ───

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTDate(): string {
  // Format YYYY-MM-DD in IST
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getISTTime(): string {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// ─── Store interface ───

interface TrendState {
  // ─── Persisted (survives reload) ───
  istDate: string;                              // YYYY-MM-DD IST — date boundary check
  lastPollAt: number;                           // epoch ms of last successful poll
  cashFlowTrend: CashFlowTrendPoint[];          // appended each poll (max 600 pts = 2.5h @ 15s)
  flowTrend: FlowTrendPoint[];                  // appended each poll (max 600 pts)
  prevSnapshots: Record<string, StrikeData[]>;  // last OI snapshot per symbol (for delta computation)
  cumulativeFlow: Record<string, number>;       // running totals per index + stockAggregate
  prevStockTotals: { nse: number; bse: number; weighted: number }; // for computing 15s interval delta

  // ─── Latest snapshot (always fresh, also persisted for snappy reload) ───
  niftyCandles: NiftyCandle[];
  stockCashFlow: StockCashFlow[];
  trendMode: 'live' | 'demo' | 'error';

  // ─── Current interval display values ───
  currentIdxFlows: Record<string, number>;
  currentStockFlow: number;
  currentIntervalCashFlow: number;

  // ─── Polling control (NOT persisted — runtime only) ───
  _pollingStarted: boolean;
  _pollTimer: ReturnType<typeof setInterval> | null;
  _historicalBackfillDone: boolean;  // true after first successful backfill today

  // ─── Actions ───
  startPolling: () => void;
  stopPolling: () => void;
  pollOnce: () => Promise<void>;
  clearTrendData: () => void;
  backfillHistoricalFlow: () => Promise<void>;
}

// ─── Constants ───

const POLL_INTERVAL_MS = 15000;
// 9:15 → 15:40 IST = 6h25m = 385min = 1540 × 15s polls. Round up to 1600 for headroom.
// Previously 600 (2.5h) was too small — the chart would lose its morning data
// once the user kept the page open past ~11:45. Now it holds the full session.
const MAX_TREND_POINTS = 1600;
const STALE_GAP_MS = 4 * 60 * 60 * 1000;  // 4h gap = treat as new session

const INITIAL_FLOW: Record<string, number> = {
  NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0, stockAggregate: 0,
};

// ─── Store implementation ───

export const useTrendStore = create<TrendState>()(
  persist(
    (set, get) => ({
      // ─── Initial state ───
      istDate: getISTDate(),
      lastPollAt: 0,
      cashFlowTrend: [],
      flowTrend: [],
      prevSnapshots: {},
      cumulativeFlow: { ...INITIAL_FLOW },
      prevStockTotals: { nse: 0, bse: 0, weighted: 0 },

      niftyCandles: [],
      stockCashFlow: [],
      trendMode: 'demo',

      currentIdxFlows: { NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0 },
      currentStockFlow: 0,
      currentIntervalCashFlow: 0,

      _pollingStarted: false,
      _pollTimer: null,
      _historicalBackfillDone: false,

      // ─── Actions ───

      /**
       * Start the singleton poller. Idempotent — safe to call from any
       * component's useEffect. The first caller starts the interval;
       * subsequent calls are no-ops.
       *
       * Also runs an immediate poll so data shows up right away on first
       * app boot (instead of waiting up to 15s).
       */
      startPolling: () => {
        const state = get();
        if (state._pollingStarted) return;

        // Date boundary check — clear stale trend data if the trading day changed
        const today = getISTDate();
        if (state.istDate !== today) {
          console.log(`[TrendStore] New trading day (${state.istDate} → ${today}), clearing accumulated data`);
          get().clearTrendData();
        }

        // Stale gap check — if last poll was >4h ago, also clear (likely a fresh session next morning)
        if (state.lastPollAt > 0 && (Date.now() - state.lastPollAt) > STALE_GAP_MS) {
          console.log('[TrendStore] Long gap since last poll (>4h), clearing accumulated data');
          get().clearTrendData();
        }

        set({ _pollingStarted: true });
        console.log('[TrendStore] Starting singleton poller');

        // Immediate first poll
        get().pollOnce().catch((e) => console.error('[TrendStore] initial poll error:', e));

        // Trigger historical backfill in background (only once per day)
        // This fetches today's OI history from Kite and reconstructs the
        // morning-to-now options flow trend.
        // Market-hours gate: only backfill when session is open or just
        // finished ('post') — pre-market/weekend backfill returns nothing
        // and would retry in a loop.
        const backfillPhase = getMarketPhase();
        if ((backfillPhase === 'open' || backfillPhase === 'post') &&
            !get()._historicalBackfillDone && get().flowTrend.length === 0) {
          // Wait a few seconds for the first poll to complete and set trendMode
          setTimeout(() => {
            const state = get();
            if (state.trendMode === 'live' && !state._historicalBackfillDone) {
              console.log('[TrendStore] Triggering historical flow backfill...');
              get().backfillHistoricalFlow().catch((e) =>
                console.error('[TrendStore] backfill error:', e)
              );
            }
          }, 3000);
        }

        // Start interval
        const timer = setInterval(() => {
          try {
            get().pollOnce().catch((e) => console.error('[TrendStore] poll error:', e));
          } catch (e) {
            console.error('[TrendStore] poll sync error:', e);
          }
        }, POLL_INTERVAL_MS);

        // Self-healing watchdog: if lastPollAt becomes stale (> 90s),
        // the main poller likely died (browser throttled background tab,
        // unhandled edge case, etc.). Detect and restart.
        // Market-hours gate: never restart outside the session — after close
        // lastPollAt naturally goes stale and the watchdog would spin forever.
        const watchdog = setInterval(() => {
          const s = get();
          const gap = Date.now() - s.lastPollAt;
          if (s.lastPollAt > 0 && gap > 90_000 && s.trendMode === 'live' && getMarketPhase() === 'open') {
            console.warn(`[TrendStore] Watchdog: no poll for ${Math.round(gap / 1000)}s, restarting`);
            if (s._pollTimer) clearInterval(s._pollTimer);
            const newTimer = setInterval(() => {
              try {
                get().pollOnce().catch((e) => console.error('[TrendStore] poll error:', e));
              } catch (e) {
                console.error('[TrendStore] poll sync error:', e);
              }
            }, POLL_INTERVAL_MS);
            set({ _pollTimer: newTimer });
            get().pollOnce().catch((e) => console.error('[TrendStore] watchdog poll error:', e));
          }
        }, 60_000);

        // Store timers — _pollTimer is in state (not persisted),
        // watchdog is stored off-band to avoid extending the interface.
        set({ _pollTimer: timer });
        (get() as any)._watchdogTimer = watchdog;
      },

      /**
       * Stop polling. Should only be called on app unmount — never on tab
       * switch. In practice, this almost never fires for a single-page app.
       */
      stopPolling: () => {
        const state = get();
        if (state._pollTimer) clearInterval(state._pollTimer);
        const wd = (get() as any)._watchdogTimer;
        if (wd) clearInterval(wd);
        set({ _pollTimer: null, _pollingStarted: false });
      },

      /**
       * Clear all accumulated trend data (called on date boundary or stale gap).
       * Keeps polling config but resets the trend arrays + cumulative counters.
       *
       * BUG FIX: Previously did not clear `niftyCandles` or `stockCashFlow`,
       * so stale demo data from a previous session could persist into the new
       * day and confuse the user (e.g. showing yesterday's fake 24350 price
       * instead of today's real market data).
       */
      clearTrendData: () => {
        set({
          istDate: getISTDate(),
          lastPollAt: 0,
          cashFlowTrend: [],
          flowTrend: [],
          prevSnapshots: {},
          cumulativeFlow: { ...INITIAL_FLOW },
          prevStockTotals: { nse: 0, bse: 0, weighted: 0 },
          niftyCandles: [],
          stockCashFlow: [],
          trendMode: 'demo',
          currentIdxFlows: { NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0 },
          currentStockFlow: 0,
          currentIntervalCashFlow: 0,
          _historicalBackfillDone: false,
        });
      },

      /**
       * Historical Flow Backfill
       * --------------------------
       * Called once per day (on first poll when flowTrend is empty and mode is live).
       * Fetches /api/kite/historical-flow which reconstructs morning-to-now
       * options flow from Kite's historical 5-min OI candles.
       *
       * When the backfill returns:
       * 1. Replaces flowTrend with the historical data
       * 2. Sets cumulativeFlow to the server-computed totals
       * 3. Stores prevSnapshots so the next live poll computes correct deltas
       *    from the last historical candle (no double-counting)
       *
       * The backfill takes ~2 minutes (rate-limited API calls), so it runs in
       * the background. Live polls continue appending 15s points. When the
       * backfill completes, it merges — keeping any live points that arrived
       * during the backfill, but replacing the cumulative totals to match.
       */
      backfillHistoricalFlow: async () => {
        try {
          const res = await fetch(withCreds('/api/kite/historical-flow'));
          const data = await res.json();

          if (data.mode !== 'live' || !data.flowTrend || data.flowTrend.length === 0) {
            console.log('[TrendStore] Backfill returned no data, will retry later if creds are refreshed');
            // Do NOT set _historicalBackfillDone = true here. This allows retry
            // when the user refreshes their Kite credentials in the Settings tab
            // mid-session. The backfill is rate-limited by the in-memory 60s
            // server-side cache anyway, so this won't hammer the API.
            // Instead, schedule a single retry after 5 minutes.
            setTimeout(() => {
              const s = get();
              if (!s._historicalBackfillDone && s.trendMode === 'live') {
                console.log('[TrendStore] Retrying historical flow backfill...');
                get().backfillHistoricalFlow().catch((e) =>
                  console.error('[TrendStore] backfill retry error:', e)
                );
              }
            }, 5 * 60 * 1000);
            return;
          }

          const state = get();
          const histFlow = data.flowTrend as FlowTrendPoint[];
          const histCumulative = data.cumulativeFlow as Record<string, number>;
          const histPrevSnapshots = data.prevSnapshots as Record<string, StrikeData[]>;

          // If live polls arrived during the backfill, we need to offset them.
          // The live polls accumulated from zero (or from a previous session).
          // We keep any live points that arrived AFTER the last historical point,
          // but adjust their cumulative values to continue from the historical totals.
          const liveFlowTrend = state.flowTrend;
          const liveCumulative = { ...state.cumulativeFlow };

          let mergedFlow: FlowTrendPoint[];
          let mergedCumulative: Record<string, number>;
          let mergedPrevSnapshots: Record<string, StrikeData[]>;

          if (liveFlowTrend.length === 0) {
            // Simple case: no live data arrived during backfill
            mergedFlow = histFlow;
            mergedCumulative = { ...INITIAL_FLOW, ...histCumulative };
            mergedPrevSnapshots = { ...histPrevSnapshots };
          } else {
            // Live data arrived during the ~2min backfill.
            // Keep historical data + append live data with adjusted cumulative values.
            // The offset = historical total - live total at the overlap point.
            mergedFlow = [...histFlow];
            mergedCumulative = { ...INITIAL_FLOW, ...histCumulative };

            // Compute offsets for each symbol
            const offsets: Record<string, number> = {};
            for (const sym of Object.keys(mergedCumulative)) {
              const histVal = mergedCumulative[sym] || 0;
              const liveVal = liveCumulative[sym] || 0;
              offsets[sym] = histVal - liveVal;
            }

            // Re-compute live points with offset applied
            // Only append live points that are newer than the last historical point
            const lastHistTime = histFlow[histFlow.length - 1]?.time || '';
            for (const pt of liveFlowTrend) {
              if (pt.time > lastHistTime) {
                mergedFlow.push({
                  time: pt.time,
                  NIFTY: Math.round(((pt.NIFTY || 0) + (offsets.NIFTY || 0)) * 10) / 10,
                  BANKNIFTY: Math.round(((pt.BANKNIFTY || 0) + (offsets.BANKNIFTY || 0)) * 10) / 10,
                  FINNIFTY: Math.round(((pt.FINNIFTY || 0) + (offsets.FINNIFTY || 0)) * 10) / 10,
                  SENSEX: Math.round(((pt.SENSEX || 0) + (offsets.SENSEX || 0)) * 10) / 10,
                  stockAggregate: Math.round(((pt.stockAggregate || 0) + (offsets.stockAggregate || 0)) * 10) / 10,
                });
              }
            }

            // Update cumulative to be the latest merged value
            if (mergedFlow.length > 0) {
              const last = mergedFlow[mergedFlow.length - 1];
              mergedCumulative.NIFTY = last.NIFTY;
              mergedCumulative.BANKNIFTY = last.BANKNIFTY;
              mergedCumulative.FINNIFTY = last.FINNIFTY;
              mergedCumulative.SENSEX = last.SENSEX;
              mergedCumulative.stockAggregate = last.stockAggregate;
            }

            // Keep the more recent prevSnapshots (live > historical)
            mergedPrevSnapshots = {
              ...histPrevSnapshots,
              ...state.prevSnapshots,
            };
          }

          // Trim to max points
          const trimmed = mergedFlow.length > MAX_TREND_POINTS
            ? mergedFlow.slice(mergedFlow.length - MAX_TREND_POINTS)
            : mergedFlow;

          set({
            flowTrend: trimmed,
            cumulativeFlow: mergedCumulative,
            prevSnapshots: mergedPrevSnapshots,
            _historicalBackfillDone: true,
          });

          console.log(
            `[TrendStore] Backfill complete: ${histFlow.length} historical + ${liveFlowTrend.length} live points, ` +
            `${Object.keys(mergedPrevSnapshots).length} symbols with snapshots`
          );
        } catch (err) {
          console.error('[TrendStore] backfillHistoricalFlow error:', err);
          // Don't set _historicalBackfillDone on error — allow retry.
          // Schedule a single retry in 5 minutes (same as empty-response case).
          setTimeout(() => {
            const s = get();
            if (!s._historicalBackfillDone && s.trendMode === 'live') {
              console.log('[TrendStore] Retrying historical flow backfill after error...');
              get().backfillHistoricalFlow().catch((e) =>
                console.error('[TrendStore] backfill retry error:', e)
              );
            }
          }, 5 * 60 * 1000);
        }
      },

      /**
       * Single polling iteration. Fetches both the trends API (Nifty candles
       * + stock cash flow) and the highest-bet API (options OI snapshots),
       * computes deltas, and appends to the trend arrays.
       *
       * Safe to call even if a previous poll is still in-flight — Zustand
       * merges updates atomically.
       *
       * DATE BOUNDARY (in-poll check): If the IST date has changed since the
       * last poll (e.g. user kept the page open overnight), clear all
       * accumulated data before appending the new poll. This guarantees the
       * chart always shows ONLY the current trading day's data — yesterday's
       * flow is wiped automatically the moment the new IST day begins.
       */
      pollOnce: async () => {
        // ─── MARKET HOURS GATE (API quota saver) ───
        // Outside the trading session we STOP live polling:
        //   'pre'/'closed' (weekend)  → skip always
        //   'post' (after 15:40 IST)  → allow ONE snapshot poll when the store
        //                                is empty (so users opening the app in
        //                                the evening still see today's chart +
        //                                the historical backfill runs once),
        //                                then skip all subsequent polls.
        // Without this gate the 15s poller would run 24/7, burning Kite API
        // quota and Vercel function invocations for flat after-hours data.
        const phase = getMarketPhase();
        if (phase !== 'open') {
          const s = get();
          const hasData = s.lastPollAt > 0 ||
                          s.cashFlowTrend.length > 0 ||
                          s.flowTrend.length > 0 ||
                          s.niftyCandles.length > 0;
          const allowSnapshot = phase === 'post' && !hasData;
          if (!allowSnapshot) {
            return; // skip this poll — no fetch, no API call
          }
        }

        // ─── In-poll date boundary check ───
        // If the IST date has changed since the last poll, clear the trend
        // data so the new day starts fresh. Without this, a user who leaves
        // the page open overnight would see yesterday's flow bleed into the
        // new day's chart.
        const prevDate = get().istDate;
        const todayDate = getISTDate();
        if (prevDate !== todayDate) {
          console.log(`[TrendStore] Date rollover detected during poll (${prevDate} → ${todayDate}), clearing accumulated data`);
          get().clearTrendData();
        }

        // Run both fetches in parallel
        const [trendsRes, betRes] = await Promise.allSettled([
          fetch(withCreds('/api/kite/trends')).then((r) => r.json()),
          fetch(withCreds('/api/kite/highest-bet')).then((r) => r.json()),
        ]);

        const now = Date.now();
        const time = getISTTime();
        const CR = 10000000;

        // ─── Process trends (Nifty candles + stock cash flow) ───

        if (trendsRes.status === 'fulfilled') {
          const data = trendsRes.value;
          const mode = (data.mode || 'demo') as 'live' | 'demo' | 'error';

          const niftyCandles: NiftyCandle[] = data.niftyCandles || [];
          const stockCashFlow: StockCashFlow[] = data.stockCashFlow || [];

          // DEMO → LIVE TRANSITION: If we were in demo mode (e.g. user had no
          // creds or expired creds) and now we're in live mode (user just
          // refreshed their token in Settings), clear all accumulated demo
          // data so the charts start fresh from real data. Otherwise the user
          // would see a confusing mix of fake + real data points.
          const prevMode = get().trendMode;
          if (mode === 'live' && prevMode === 'demo' &&
              (get().cashFlowTrend.length > 0 || get().niftyCandles.length > 0)) {
            console.log('[TrendStore] Demo → Live transition detected, clearing stale demo data');
            // Clear everything except istDate + _historicalBackfillDone
            set({
              lastPollAt: 0,
              cashFlowTrend: [],
              flowTrend: [],
              prevSnapshots: {},
              cumulativeFlow: { ...INITIAL_FLOW },
              prevStockTotals: { nse: 0, bse: 0, weighted: 0 },
              currentIdxFlows: { NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0 },
              currentStockFlow: 0,
              currentIntervalCashFlow: 0,
              _historicalBackfillDone: false,
            });
          }

          // Compute cumulative-since-market-open totals (these come directly
          // from the API — no client-side accumulation needed).
          if (stockCashFlow.length > 0) {
            const nseTotal = stockCashFlow.reduce((s, v) => s + v.nseCashFlow, 0);
            const bseTotal = stockCashFlow.reduce((s, v) => s + v.bseCashFlow, 0);
            const netTotal = nseTotal + bseTotal;
            const weightedTotal = stockCashFlow.reduce((s, v) => s + v.weightedFlow, 0);

            // 15s interval delta = current cumulative − previous cumulative
            const prev = get().prevStockTotals;
            const intervalDelta = (prev.nse === 0 && prev.bse === 0)
              ? 0  // first poll of the day — no delta to compute
              : netTotal - (prev.nse + prev.bse);

            const point: CashFlowTrendPoint = {
              time,
              nse: Math.round((nseTotal / CR) * 10) / 10,
              bse: Math.round((bseTotal / CR) * 10) / 10,
              net: Math.round((netTotal / CR) * 10) / 10,
              weighted: Math.round((weightedTotal / CR) * 10) / 10,
              interval: Math.round((intervalDelta / CR) * 10) / 10,
            };

            const prevTrend = get().cashFlowTrend;
            const newTrend = [...prevTrend, point];
            const trimmed = newTrend.length > MAX_TREND_POINTS
              ? newTrend.slice(newTrend.length - MAX_TREND_POINTS)
              : newTrend;

            set({
              niftyCandles,
              stockCashFlow,
              trendMode: mode,
              cashFlowTrend: trimmed,
              prevStockTotals: { nse: nseTotal, bse: weightedTotal, weighted: weightedTotal },
              currentIntervalCashFlow: intervalDelta,
              lastPollAt: now,
              istDate: getISTDate(),
            });
          } else {
            // No stock data — still update candles + mode
            set({ niftyCandles, trendMode: mode, lastPollAt: now, istDate: getISTDate() });
          }
        }

        // ─── Process highest-bet (options OI snapshots → delta-weighted flow) ───

        if (betRes.status === 'fulfilled') {
          const data = betRes.value as HighestBetResponse;
          if (data.symbols && data.symbols.length > 0) {
            const prevSnapshots = get().prevSnapshots;
            const cumulativeFlow = { ...get().cumulativeFlow };
            const newCurrentIdx: Record<string, number> = {
              NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0,
            };
            const newPrevSnapshots: Record<string, StrikeData[]> = { ...prevSnapshots };
            let stockAgg = 0;

            for (const sym of data.symbols) {
              if (sym.strikes.length === 0) continue;

              const prevStrikes = prevSnapshots[sym.symbol];
              if (!prevStrikes || prevStrikes.length === 0) {
                // First snapshot — store and skip delta computation
                newPrevSnapshots[sym.symbol] = sym.strikes;
                continue;
              }

              const flow = computeSymbolFlow(prevStrikes, sym.strikes, sym.lotSize);

              if (sym.type === 'index' && (INDEX_SYMBOLS as readonly string[]).includes(sym.symbol)) {
                cumulativeFlow[sym.symbol] = (cumulativeFlow[sym.symbol] || 0) + flow.net;
                newCurrentIdx[sym.symbol] = flow.net;
              } else if (sym.type === 'stock') {
                stockAgg += flow.net;
              }

              newPrevSnapshots[sym.symbol] = sym.strikes;
            }

            cumulativeFlow.stockAggregate = (cumulativeFlow.stockAggregate || 0) + stockAgg;

            const flowPoint: FlowTrendPoint = {
              time,
              NIFTY: Math.round((cumulativeFlow.NIFTY || 0) * 10) / 10,
              BANKNIFTY: Math.round((cumulativeFlow.BANKNIFTY || 0) * 10) / 10,
              FINNIFTY: Math.round((cumulativeFlow.FINNIFTY || 0) * 10) / 10,
              SENSEX: Math.round((cumulativeFlow.SENSEX || 0) * 10) / 10,
              stockAggregate: Math.round((cumulativeFlow.stockAggregate || 0) * 10) / 10,
            };

            const prevFlowTrend = get().flowTrend;
            const newFlowTrend = [...prevFlowTrend, flowPoint];
            const trimmedFlow = newFlowTrend.length > MAX_TREND_POINTS
              ? newFlowTrend.slice(newFlowTrend.length - MAX_TREND_POINTS)
              : newFlowTrend;

            set({
              flowTrend: trimmedFlow,
              prevSnapshots: newPrevSnapshots,
              cumulativeFlow,
              currentIdxFlows: newCurrentIdx,
              currentStockFlow: stockAgg,
              lastPollAt: now,
            });
          }
        }
      },
    }),
    {
      name: 'trend-store-v2',  // v2: added historical OI backfill
      storage: createJSONStorage(() => {
        // Guard for SSR — localStorage is only available in the browser
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      // Don't persist runtime-only fields (timers, polling flag).
      // CRITICAL: prevSnapshots MUST NOT be persisted — they contain raw OI values
      // from the last poll. On page reload, diffing stale OI against current OI
      // creates a massive fake spike in the cumulative flow chart.
      // Per-interval values (currentStockFlow, currentIdxFlows) also shouldn't
      // persist — they show the last interval's flow, meaningless after reload.
      partialize: (state) => ({
        istDate: state.istDate,
        lastPollAt: state.lastPollAt,
        cashFlowTrend: state.cashFlowTrend,
        flowTrend: state.flowTrend,
        // prevSnapshots: INTENTIONALLY NOT persisted (see comment above)
        cumulativeFlow: state.cumulativeFlow,
        prevStockTotals: state.prevStockTotals,
        niftyCandles: state.niftyCandles,
        stockCashFlow: state.stockCashFlow,
        trendMode: state.trendMode,
        // currentIdxFlows, currentStockFlow, currentIntervalCashFlow: NOT persisted
      }),
    }
  )
);
