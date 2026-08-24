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

  // ─── Actions ───
  startPolling: () => void;
  stopPolling: () => void;
  pollOnce: () => Promise<void>;
  clearTrendData: () => void;
}

// ─── Constants ───

const POLL_INTERVAL_MS = 15000;
const MAX_TREND_POINTS = 600;       // 2.5 hours @ 15s — keeps memory bounded
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

        // Start interval
        const timer = setInterval(() => {
          get().pollOnce().catch((e) => console.error('[TrendStore] poll error:', e));
        }, POLL_INTERVAL_MS);
        set({ _pollTimer: timer });
      },

      /**
       * Stop polling. Should only be called on app unmount — never on tab
       * switch. In practice, this almost never fires for a single-page app.
       */
      stopPolling: () => {
        const state = get();
        if (state._pollTimer) {
          clearInterval(state._pollTimer);
        }
        set({ _pollTimer: null, _pollingStarted: false });
      },

      /**
       * Clear all accumulated trend data (called on date boundary or stale gap).
       * Keeps polling config but resets the trend arrays + cumulative counters.
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
          currentIdxFlows: { NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0 },
          currentStockFlow: 0,
          currentIntervalCashFlow: 0,
        });
      },

      /**
       * Single polling iteration. Fetches both the trends API (Nifty candles
       * + stock cash flow) and the highest-bet API (options OI snapshots),
       * computes deltas, and appends to the trend arrays.
       *
       * Safe to call even if a previous poll is still in-flight — Zustand
       * merges updates atomically.
       */
      pollOnce: async () => {
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
      name: 'trend-store-v1',  // localStorage key — bump version to invalidate
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
      // Don't persist runtime-only fields (timers, polling flag)
      partialize: (state) => ({
        istDate: state.istDate,
        lastPollAt: state.lastPollAt,
        cashFlowTrend: state.cashFlowTrend,
        flowTrend: state.flowTrend,
        prevSnapshots: state.prevSnapshots,
        cumulativeFlow: state.cumulativeFlow,
        prevStockTotals: state.prevStockTotals,
        niftyCandles: state.niftyCandles,
        stockCashFlow: state.stockCashFlow,
        trendMode: state.trendMode,
        currentIdxFlows: state.currentIdxFlows,
        currentStockFlow: state.currentStockFlow,
        currentIntervalCashFlow: state.currentIntervalCashFlow,
      }),
    }
  )
);
