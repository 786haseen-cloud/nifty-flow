import { create } from 'zustand';
import type {
  InstrumentData,
  VIXData,
  Signal,
  SignalMode,
  DayComparison,
  BigTradeEntry,
  NiftyDivergencePoint,
  GlobalIndex,
  GIFTNifty,
  NextMonthFutures,
  ExpiryInfo,
  NewsEvent,
} from './types';

interface KiteConfigData {
  apiKey: string;
  accessToken: string;
  isConnected: boolean;
}

interface DashboardStore {
  // Connection & Mode
  isLive: boolean;
  setIsLive: (v: boolean) => void;
  lastRefresh: Date;
  setLastRefresh: (d: Date) => void;
  refreshInterval: number;
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
  setSignals: (s: Signal[]) => void;
  signalMode: SignalMode;
  setSignalMode: (m: SignalMode) => void;

  // 3-Day Comparison
  dayComparison: DayComparison[];
  setDayComparison: (d: DayComparison[]) => void;

  // Big Trades
  bigTrades: BigTradeEntry[];
  setBigTrades: (t: BigTradeEntry[]) => void;

  // Nifty Divergence
  niftyDivergence: NiftyDivergencePoint[];
  setNiftyDivergence: (d: NiftyDivergencePoint[]) => void;

  // Global Indices
  globalIndices: GlobalIndex[];
  setGlobalIndices: (g: GlobalIndex[]) => void;

  // GIFT Nifty
  giftNifty: GIFTNifty | null;
  setGiftNifty: (g: GIFTNifty) => void;

  // Next Month Futures
  nextMonthFutures: NextMonthFutures | null;
  setNextMonthFutures: (f: NextMonthFutures) => void;

  // Expiry Info
  expiryInfo: ExpiryInfo[];
  setExpiryInfo: (e: ExpiryInfo[]) => void;

  // News
  news: NewsEvent[];
  setNews: (n: NewsEvent[]) => void;

  // Kite Config
  kiteConfig: KiteConfigData;
  setKiteConfig: (c: KiteConfigData) => void;

  // Active Tab
  activeTab: string;
  setActiveTab: (t: string) => void;

  // Loading
  isLoading: boolean;
  setIsLoading: (b: boolean) => void;

  // Theta info
  callMelting: number;
  putMelting: number;
  setMeltingSpeed: (call: number, put: number) => void;
}

export const useStore = create<DashboardStore>((set) => ({
  isLive: false,
  setIsLive: (v) => set({ isLive: v }),
  lastRefresh: new Date(),
  setLastRefresh: (d) => set({ lastRefresh: d }),
  refreshInterval: 15,
  setRefreshInterval: (n) => set({ refreshInterval: n }),

  selectedInstrument: 'NIFTY',
  setSelectedInstrument: (s) => set({ selectedInstrument: s }),

  vix: null,
  setVix: (v) => set({ vix: v }),

  instruments: [],
  setInstruments: (arr) => set({ instruments: arr }),

  signals: [],
  setSignals: (s) => set({ signals: s }),
  signalMode: 'aggressive',
  setSignalMode: (m) => set({ signalMode: m }),

  dayComparison: [],
  setDayComparison: (d) => set({ dayComparison: d }),

  bigTrades: [],
  setBigTrades: (t) => set({ bigTrades: t }),

  niftyDivergence: [],
  setNiftyDivergence: (d) => set({ niftyDivergence: d }),

  globalIndices: [],
  setGlobalIndices: (g) => set({ globalIndices: g }),

  giftNifty: null,
  setGiftNifty: (g) => set({ giftNifty: g }),

  nextMonthFutures: null,
  setNextMonthFutures: (f) => set({ nextMonthFutures: f }),

  expiryInfo: [],
  setExpiryInfo: (e) => set({ expiryInfo: e }),

  news: [],
  setNews: (n) => set({ news: n }),

  kiteConfig: { apiKey: '', accessToken: '', isConnected: false },
  setKiteConfig: (c) => set({ kiteConfig: c }),

  activeTab: 'birds-eye',
  setActiveTab: (t) => set({ activeTab: t }),

  isLoading: false,
  setIsLoading: (b) => set({ isLoading: b }),

  callMelting: 0,
  putMelting: 0,
  setMeltingSpeed: (call, put) => set({ callMelting: call, putMelting: put }),
}));
