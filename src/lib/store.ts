// ============================================================
// Zustand Store — Global State
// ============================================================

import { create } from 'zustand';
import type {
  InstrumentData,
  VIXData,
  Signal,
  SignalMode,
  InstitutionalFlow,
  BigTrade,
  TimeSeriesPoint,
  OIBuildupEvent,
  DailySummary,
  KiteConfigData,
} from './types';

interface DashboardStore {
  // Connection & Mode
  isLive: boolean;
  setIsLive: (v: boolean) => void;
  lastRefresh: Date;
  setLastRefresh: (d: Date) => void;
  refreshInterval: number; // seconds
  setRefreshInterval: (n: number) => void;

  // Selected Instrument
  selectedInstrument: string;
  setSelectedInstrument: (s: string) => void;

  // VIX
  vix: VIXData | null;
  setVix: (v: VIXData) => void;

  // Instruments
  instruments: InstrumentData[];
  setInstruments: (arr: InstrumentData[]) => void;

  // Signals
  signals: Signal[];
  addSignal: (s: Signal) => void;
  clearSignals: () => void;
  signalMode: SignalMode;
  setSignalMode: (m: SignalMode) => void;

  // Institutional Flow
  institutionalFlow: InstitutionalFlow | null;
  setInstitutionalFlow: (f: InstitutionalFlow) => void;

  // Big Trades
  bigTrades: BigTrade[];
  setBigTrades: (t: BigTrade[]) => void;

  // Time Series (for divergence chart)
  timeSeries: TimeSeriesPoint[];
  setTimeSeries: (t: TimeSeriesPoint[]) => void;

  // OI Buildup Events
  oiBuildupEvents: OIBuildupEvent[];
  setOiBuildupEvents: (e: OIBuildupEvent[]) => void;

  // Daily Summaries
  dailySummaries: DailySummary[];
  setDailySummaries: (s: DailySummary[]) => void;

  // Kite Config
  kiteConfig: KiteConfigData;
  setKiteConfig: (c: KiteConfigData) => void;

  // Active Tab
  activeTab: string;
  setActiveTab: (t: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (b: boolean) => void;
}

export const useStore = create<DashboardStore>((set) => ({
  // Connection & Mode
  isLive: false,
  setIsLive: (v) => set({ isLive: v }),
  lastRefresh: new Date(),
  setLastRefresh: (d) => set({ lastRefresh: d }),
  refreshInterval: 15,
  setRefreshInterval: (n) => set({ refreshInterval: n }),

  // Selected Instrument
  selectedInstrument: 'NIFTY',
  setSelectedInstrument: (s) => set({ selectedInstrument: s }),

  // VIX
  vix: null,
  setVix: (v) => set({ vix: v }),

  // Instruments
  instruments: [],
  setInstruments: (arr) => set({ instruments: arr }),

  // Signals
  signals: [],
  addSignal: (s) => set((state) => ({ signals: [s, ...state.signals].slice(0, 50) })),
  clearSignals: () => set({ signals: [] }),
  signalMode: 'aggressive',
  setSignalMode: (m) => set({ signalMode: m }),

  // Institutional Flow
  institutionalFlow: null,
  setInstitutionalFlow: (f) => set({ institutionalFlow: f }),

  // Big Trades
  bigTrades: [],
  setBigTrades: (t) => set({ bigTrades: t }),

  // Time Series
  timeSeries: [],
  setTimeSeries: (t) => set({ timeSeries: t }),

  // OI Buildup Events
  oiBuildupEvents: [],
  setOiBuildupEvents: (e) => set({ oiBuildupEvents: e }),

  // Daily Summaries
  dailySummaries: [],
  setDailySummaries: (s) => set({ dailySummaries: s }),

  // Kite Config
  kiteConfig: { apiKey: '', accessToken: '', isConnected: false },
  setKiteConfig: (c) => set({ kiteConfig: c }),

  // Active Tab
  activeTab: 'live',
  setActiveTab: (t) => set({ activeTab: t }),

  // Loading
  isLoading: false,
  setIsLoading: (b) => set({ isLoading: b }),
}));
