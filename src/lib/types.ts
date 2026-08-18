export type OptionType = 'CE' | 'PE';
export type SignalType = 'CALL_BUY' | 'PUT_BUY' | 'SELL_BOTH' | 'WAIT';
export type SignalMode = 'aggressive' | 'conservative';
export type InstrumentType = 'index' | 'stock';
export type BuiltUpType = 'Call Writing' | 'Call Long Cvr.' | 'Put Writing' | 'Put Long Cvr.' | 'Put Short Cvr.' | 'None';
export type PlayerType = 'FII' | 'DII' | 'PROPDESK' | 'CLIENT';
export type ExpiryType = 'weekly' | 'monthly';
export type NSESessionType =
  | 'pre_open'        // 9:00 - 9:15 AM
  | 'continuous'      // 9:15 - 3:15 PM (CAS stocks) / 9:15 - 3:30 PM (non-CAS)
  | 'cas_transition'  // 3:15 - 3:20 PM (ref price calc)
  | 'cas_order_entry' // 3:20 - 3:30 PM (order entry, random close 3:28-3:30)
  | 'cas_matching'    // 3:30 - 3:35 PM (order matching)
  | 'cas_transition_post' // 3:35 - 3:50 PM
  | 'post_close'      // 3:50 - 4:00 PM
  | 'derivatives'     // 9:15 - 3:40 PM (equity derivatives segment)
  | 'closed';         // After 4:00 PM or before 9:00 AM

export interface NSESessionInfo {
  currentSession: NSESessionType;
  currentTimeIST: string;
  isMarketOpen: boolean;
  isCashActive: boolean;        // Cash trading active? FALSE during CAS (3:15-3:35)
  isDerivativesOpen: boolean;   // F&O continues during CAS! Till 3:40 PM
  isCASActive: boolean;         // Is Closing Auction Session active?
  isRandomCloseWindow: boolean; // 3:28-3:30 PM random closure possible
  nextSessionStart: string;     // When next session starts
  sessionLabel: string;         // Human-readable label
  casApplicable: boolean;       // CAS applies to derivative stocks
}

// NSE Session Timings (as per new rules)
export const NSE_SESSIONS = {
  PRE_OPEN_START: '09:00',
  PRE_OPEN_END: '09:15',
  CTS_START: '09:15',
  CTS_END_CAS: '15:15',        // Continuous Trading ends for CAS stocks
  CTS_END_NON_CAS: '15:30',   // Non-CAS stocks trade till 3:30 PM
  CAS_TRANSITION_START: '15:15',
  CAS_TRANSITION_END: '15:20',
  CAS_ORDER_ENTRY_START: '15:20',
  CAS_ORDER_ENTRY_END: '15:30', // Random close 3:28-3:30
  CAS_RANDOM_CLOSE_START: '15:28',
  CAS_MATCHING_START: '15:30',
  CAS_MATCHING_END: '15:35',
  CAS_POST_TRANSITION_END: '15:50',
  POST_CLOSE_START: '15:50',
  POST_CLOSE_END: '16:00',
  DERIVATIVES_END: '15:40',    // Equity derivatives till 3:40 PM
} as const;

export interface OptionStrike {
  strike: number;
  callLTP: number;
  callOI: number;
  callOIChg: number;
  callVolume: number;
  callIV: number;
  callDelta: number;
  callGamma: number;
  callTheta: number;
  callVega: number;
  callChg: number;
  putLTP: number;
  putOI: number;
  putOIChg: number;
  putVolume: number;
  putIV: number;
  putDelta: number;
  putGamma: number;
  putTheta: number;
  putVega: number;
  putChg: number;
  isATM: boolean;
  builtUp: BuiltUpType;
  callITM: boolean;
  putITM: boolean;
}

export interface InstrumentData {
  symbol: string;
  name: string;
  type: InstrumentType;
  cashLTP: number;
  cashChange: number;
  cashChangePercent: number;
  futureLTP: number;
  futureBasis: number;
  nextMonthFutLTP?: number;
  nextMonthFutBasis?: number;
  atmStrike: number;
  strikes: OptionStrike[];
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  chgOiPCR: number;
  volumePCR: number;
  maxPainStrike: number;
}

export interface VIXData {
  value: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  dayOpen: number;
  trend: 'rising' | 'falling' | 'stable';
  percentile: number;
  panicLevel: 'calm' | 'normal' | 'elevated' | 'panic';
}

export interface GlobalIndex {
  name: string;
  country: string;
  value: number;
  change: number;
  changePercent: number;
  status: 'open' | 'closed' | 'pre-market';
  impactOnNifty: 'positive' | 'negative' | 'mixed' | 'mild_positive' | 'mild_negative';
}

export interface NewsEvent {
  time: string;
  category: 'geopolitical' | 'government_data' | 'policy' | 'corporate' | 'global';
  headline: string;
  impact: 'high' | 'medium' | 'low';
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface ExpiryInfo {
  symbol: string;
  name: string;
  nextExpiryDate: string;
  daysToExpiry: number;
  expiryType: ExpiryType;
  isSmartMoneyWindow: boolean;
}

export interface GIFTNifty {
  value: number;
  change: number;
  indicativeOpen: number;
}

export interface NextMonthFutures {
  symbol: string;
  ltp: number;
  basis: number;
  oi: number;
  premiumDiscount: 'premium' | 'discount';
}

export interface PlayerFlow {
  player: PlayerType;
  cashNet: number;
  futNet: number;
  optCallNet: number;
  optPutNet: number;
  totalNet: number;
}

export interface DayComparison {
  date: string;
  label: string;
  fii: PlayerFlow;
  propdesk: PlayerFlow;
  client: PlayerFlow;
  dii: PlayerFlow;
}

export interface Signal {
  instrument: string;
  signalType: SignalType;
  mode: SignalMode;
  confidence: number;
  suggestedStrike: number;
  optionType: OptionType;
  premium: number;
  stopLoss: number;
  target: number;
  reasoning: SignalReasoning;
  timestamp: Date;
}

export interface SignalReasoning {
  fiiFlowScore: number;
  propdeskFlowScore: number;
  clientContrarianScore: number;
  threeDayOITrendScore: number;
  cashFutAlignScore: number;
  globalContextScore: number;
  stockSentimentScore: number;
  totalScore: number;
  details: string;
  thetaInfo?: {
    callMelting: number;
    putMelting: number;
    fasterSide: 'call' | 'put' | 'equal';
  };
  vixInfo?: {
    panicLevel: string;
    percentile: number;
  };
  smartMoneyWindow?: boolean;
}

export interface BigTradeEntry {
  timestamp: Date;
  instrument: string;
  tradeType: string;
  action: string;
  player: PlayerType;
  quantity: number;
  value: number;
  strike?: number;
}

// Net Money Flow for stocks: Money In - Money Out
// This is NOT just price change — it tracks actual capital flow
export interface NetMoneyFlow {
  symbol: string;
  moneyIn: number;       // Total buy value (price × quantity for all buys)
  moneyOut: number;      // Total sell value (price × quantity for all sells)
  netFlow: number;      // moneyIn - moneyOut: positive = inflow, negative = outflow
  netFlowCr: number;    // In Crores
  intensity: 'heavy_inflow' | 'inflow' | 'neutral' | 'outflow' | 'heavy_outflow';
}

// Dual exchange stock data — same stock, different buyers/sellers on NSE vs BSE
export interface ExchangeStockData {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  ltp: number;
  change: number;
  changePercent: number;
  volume: number;          // Total volume on this exchange
  buyVolume: number;       // Volume at bid (buyers)
  sellVolume: number;      // Volume at ask (sellers)
  moneyIn: number;        // Buy value on this exchange
  moneyOut: number;       // Sell value on this exchange
  netMoneyFlow: number;   // moneyIn - moneyOut on this exchange
  vwap: number;           // Volume Weighted Average Price
}

// Combined dual exchange stock view
export interface DualExchangeStock {
  symbol: string;
  name: string;
  nse: ExchangeStockData;  // NSE data
  bse: ExchangeStockData;  // BSE data
  combinedNetFlow: number; // NSE netFlow + BSE netFlow
  combinedNetFlowCr: number;
  nseBseDiff: number;      // Price difference between exchanges (arbitrage opportunity)
  dominantExchange: 'NSE' | 'BSE' | 'both'; // Which exchange has more volume/flow
  totalMoneyIn: number;    // NSE moneyIn + BSE moneyIn
  totalMoneyOut: number;   // NSE moneyOut + BSE moneyOut
}

export interface NiftyDivergencePoint {
  date: string;
  niftyPrice: number;
  fiiNetFlow: number;
}

// Weighted Cash Flow Bar — one bar every 15 seconds (4 bars per minute)
// Based on Pine Script logic: CashFlow = (Close-Open) × Volume × Weight%
export interface WeightedCashFlowBar {
  timestamp: string;          // Time label for the bar
  // Per-stock breakdown
  stockFlows: {
    symbol: string;
    cashFlow: number;         // (Close-Open) × Volume
    niftyWeighted: number;    // cashFlow × niftyWeight%
    sensexWeighted: number;   // cashFlow × sensexWeight%
    weight: number;           // Nifty weight %
    moneyIn: number;
    moneyOut: number;
  }[];
  // Combined
  niftyWeightedCF: number;    // Sum of all niftyWeighted
  sensexWeightedCF: number;   // Sum of all sensexWeighted
  totalMoneyIn: number;       // Green bar
  totalMoneyOut: number;      // Red bar
  netFlow: number;            // Blue bar (Money In - Money Out)
  isStrongInflow: boolean;
  isStrongOutflow: boolean;
}

// Cash Flow Trend with smoothing and bands (from Pine Script)
export interface CashFlowTrend {
  currentValue: number;
  smoothed: number;           // SMA(14)
  upperBand: number;          // smoothed + 0.5 × stdev
  lowerBand: number;          // smoothed - 0.5 × stdev
  isStrongInflow: boolean;
  isStrongOutflow: boolean;
  isUptrend: boolean;
  isDowntrend: boolean;
  momentum: number;
  signalStrength: number;     // -100 to +100
  bearishDivergence: boolean;
  bullishDivergence: boolean;
}

// =====================================================
// INSTITUTIONAL DATA ARCHITECTURE
// Live market: Only MONEY FLOW is visible — we don't know WHO is behind it
// After market: NSE releases participant-level data (FII, DII, PropDesk, Client)
// We CORRELATE after-market data with live money flow patterns
// 3-day rolling window for signals, but ALL historical data stored
// =====================================================

// After-market NSE participant data (released ~5:30 PM IST daily)
export interface InstitutionalDailyData {
  date: string;                    // YYYY-MM-DD
  // FII - Foreign Institutional Investors
  fiiCashBuy: number;             // FII cash market buys (₹ Cr)
  fiiCashSell: number;            // FII cash market sells (₹ Cr)
  fiiFutBuy: number;
  fiiFutSell: number;
  fiiOptCallBuy: number;
  fiiOptCallSell: number;
  fiiOptPutBuy: number;
  fiiOptPutSell: number;
  // DII - Domestic Institutional Investors
  diiCashBuy: number;
  diiCashSell: number;
  diiFutBuy: number;
  diiFutSell: number;
  // PropDesk - Proprietary Trading
  propdeskCashBuy: number;
  propdeskCashSell: number;
  propdeskFutBuy: number;
  propdeskFutSell: number;
  propdeskOptCallBuy: number;
  propdeskOptCallSell: number;
  propdeskOptPutBuy: number;
  propdeskOptPutSell: number;
  // Client (Retail + HNI)
  clientCashBuy: number;
  clientCashSell: number;
  clientFutBuy: number;
  clientFutSell: number;
  clientOptCallBuy: number;
  clientOptCallSell: number;
  clientOptPutBuy: number;
  clientOptPutSell: number;
}

// Computed net values from InstitutionalDailyData
export interface InstitutionalNetFlows {
  date: string;
  label: string;                   // 'Day-0', 'Day-1', 'Day-2', etc.
  fii: PlayerFlow;
  dii: PlayerFlow;
  propdesk: PlayerFlow;
  client: PlayerFlow;
}

// Live market inference — we can only see BIG money flow
// Retailers can't move the market in minutes — only institutions can
export interface LiveMoneyFlowInference {
  timestamp: string;
  // What we SEE during live market
  totalMoneyIn: number;            // Big buy pressure
  totalMoneyOut: number;           // Big sell pressure
  netFlow: number;                 // Net = In - Out
  // Inferred (not confirmed until after-market)
  likelyInstitutional: boolean;    // Flow too big for retail
  flowVelocity: number;            // Cr/minute — how fast money is moving
  // After correlation (null during live, filled after-market)
  correlatedFII?: number;          // What portion was likely FII
  correlatedPropDesk?: number;     // What portion was likely PropDesk
  correlatedDII?: number;
  correlatedClient?: number;
  correlationConfidence: number;   // 0-1, how confident in correlation
}

// 3-Day rolling window — signal engine uses only last 3 days
// But we STORE all days for backtesting & pattern discovery
export interface InstitutionalRollingWindow {
  days: InstitutionalNetFlows[];   // Sorted Day-0, Day-1, Day-2
  totalFIINet3D: number;           // Sum of FII net across 3 days
  totalPropDeskNet3D: number;
  totalClientNet3D: number;
  totalDIINet3D: number;
  // Trend detection
  fiiTrend: 'accumulating' | 'distributing' | 'neutral';  // 3-day FII trend
  propdeskTrend: 'accumulating' | 'distributing' | 'neutral';
  clientTrend: 'contrarian_bullish' | 'contrarian_bearish' | 'neutral';
  // Correlation quality
  dataCompleteness: number;        // 0-1, do we have all 3 days?
}

// Live vs After-Market awareness
export type DataAvailability = 'live_flow_only' | 'after_market_available';

export interface MarketDataContext {
  availability: DataAvailability;
  // During live: Only money flow inference available
  liveInference?: LiveMoneyFlowInference;
  // After market: Actual participant data from NSE
  rollingWindow?: InstitutionalRollingWindow;
  // When after-market data becomes available, we correlate
  correlationMessage?: string;     // e.g. "After-market data: FII was net buyer ₹2,400 Cr"
}

// Constants
export const INDICES = [
  { symbol: 'NIFTY', name: 'Nifty 50', lotSize: 25, strikes: 11, step: 50, expiryDay: 2, expiryType: 'weekly' as ExpiryType },
  { symbol: 'SENSEX', name: 'Sensex', lotSize: 10, strikes: 11, step: 100, expiryDay: 4, expiryType: 'weekly' as ExpiryType },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty', lotSize: 15, strikes: 11, step: 100, expiryDay: -1, expiryType: 'monthly' as ExpiryType },
  { symbol: 'FINNIFTY', name: 'Fin Nifty', lotSize: 25, strikes: 11, step: 50, expiryDay: -1, expiryType: 'monthly' as ExpiryType },
] as const;

// Top 15 Nifty50 Stocks with actual weightages for BOTH indices
// Stocks impact on indices calculated as per their weightage
// Sorted by Nifty50 weight (highest first)
export const TOP_STOCKS = [
  { symbol: 'HDFCBANK', name: 'HDFC Bank',           lotSize: 550,  step: 5,    niftyWeight: 9.97, sensexWeight: 12.03 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank',          lotSize: 700,  step: 5,    niftyWeight: 9.09, sensexWeight: 10.96 },
  { symbol: 'RELIANCE',  name: 'Reliance Industries',  lotSize: 250,  step: 10,   niftyWeight: 7.92, sensexWeight: 9.56 },
  { symbol: 'BHARTIARTL',name: 'Bharti Airtel',       lotSize: 1100, step: 5,    niftyWeight: 5.55, sensexWeight: 6.70 },
  { symbol: 'LT',        name: 'Larsen & Toubro',      lotSize: 150,  step: 10,   niftyWeight: 4.25, sensexWeight: 5.13 },
  { symbol: 'SBIN',      name: 'State Bank India',     lotSize: 3750, step: 2.5,  niftyWeight: 3.95, sensexWeight: 4.77 },
  { symbol: 'INFY',      name: 'Infosys',              lotSize: 300,  step: 5,    niftyWeight: 3.67, sensexWeight: 4.43 },
  { symbol: 'AXISBANK',  name: 'Axis Bank',            lotSize: 900,  step: 2.5,  niftyWeight: 3.13, sensexWeight: 3.78 },
  { symbol: 'M&M',       name: 'Mahindra & Mahindra',  lotSize: 600,  step: 2.5,  niftyWeight: 2.74, sensexWeight: 3.30 },
  { symbol: 'BAJFINANCE',name: 'Bajaj Finance',        lotSize: 125,  step: 10,   niftyWeight: 2.61, sensexWeight: 3.15 },
  { symbol: 'KOTAKBANK', name: 'Kotak Bank',           lotSize: 400,  step: 5,    niftyWeight: 2.58, sensexWeight: 3.11 },
  { symbol: 'ITC',       name: 'ITC Limited',          lotSize: 1600, step: 2.5,  niftyWeight: 2.40, sensexWeight: 2.90 },
  { symbol: 'TCS',       name: 'Tata Consultancy',     lotSize: 150,  step: 5,    niftyWeight: 2.16, sensexWeight: 2.60 },
  { symbol: 'ETERNAL',   name: 'Eternal Ltd',          lotSize: 750,  step: 2.5,  niftyWeight: 2.06, sensexWeight: 2.49 },
  { symbol: 'TITAN',     name: 'Titan Company',        lotSize: 250,  step: 10,   niftyWeight: 1.87, sensexWeight: 2.25 },
] as const;

export const RISK_FREE_RATE = 0.065;

export const GLOBAL_INDICES = [
  { name: 'Dow Jones', country: 'US', baseValue: 38750 },
  { name: 'S&P 500', country: 'US', baseValue: 5120 },
  { name: 'Nasdaq', country: 'US', baseValue: 16200 },
  { name: 'Nikkei 225', country: 'Japan', baseValue: 36400 },
  { name: 'Hang Seng', country: 'HK', baseValue: 17200 },
  { name: 'FTSE 100', country: 'UK', baseValue: 7650 },
  { name: 'DAX', country: 'Germany', baseValue: 17800 },
  { name: 'Shanghai', country: 'China', baseValue: 3050 },
  { name: 'KOSPI', country: 'Korea', baseValue: 2580 },
] as const;

// =====================================================
// OPTIONS FLOW ARCHITECTURE
// At each strike, 4 trade types happen simultaneously:
//   Call Buy (bullish) + Put Write (bullish) = BULLISH OPTIONS FLOW
//   Put Buy (bearish)  + Call Write (bearish) = BEARISH OPTIONS FLOW
// Indexes: 11 strikes around ATM (ATM ± 5 each side)
// Stocks (NSE only, 15 F&O stocks): 9 strikes around ATM (ATM ± 4 each side)
// BSE does NOT have stock options
// =====================================================

// Single strike's options flow for one 15-second interval
export interface StrikeOptionsFlow {
  strike: number;
  isATM: boolean;
  callBuy: number;     // ₹ value of call buying (dark green)
  putWrite: number;    // ₹ value of put writing/selling (light green)
  putBuy: number;      // ₹ value of put buying (dark red)
  callWrite: number;   // ₹ value of call writing/selling (light red)
  // Computed
  bullishFlow: number; // callBuy + putWrite
  bearishFlow: number; // putBuy + callWrite
  netFlow: number;     // bullishFlow - bearishFlow
}

// One instrument's options flow across all strikes for a 15s interval
export interface InstrumentOptionsFlow {
  symbol: string;
  name: string;
  type: InstrumentType;
  atmStrike: number;
  strikeStep: number;
  strikes: StrikeOptionsFlow[];
  // Aggregated across ALL strikes
  totalCallBuy: number;
  totalPutWrite: number;
  totalPutBuy: number;
  totalCallWrite: number;
  totalBullishFlow: number;
  totalBearishFlow: number;
  totalNetFlow: number;
}

// One 15-second bar of ALL options flow (indexes + stocks)
// This sits BELOW the cash flow bar in the stacked view
export interface OptionsFlowBar {
  timestamp: string;
  // Index options flow (all 4 indexes combined)
  indexFlows: InstrumentOptionsFlow[];
  indexTotalCallBuy: number;
  indexTotalPutWrite: number;
  indexTotalPutBuy: number;
  indexTotalCallWrite: number;
  indexBullishFlow: number;  // combined bullish
  indexBearishFlow: number;  // combined bearish
  indexNetFlow: number;      // net = bullish - bearish
  // Stock options flow (15 NSE F&O stocks combined — BSE has no stock options)
  stockFlows: InstrumentOptionsFlow[];
  stockTotalCallBuy: number;
  stockTotalPutWrite: number;
  stockTotalPutBuy: number;
  stockTotalCallWrite: number;
  stockBullishFlow: number;
  stockBearishFlow: number;
  stockNetFlow: number;
}

// =====================================================
// FUTURES MONEY FLOW
// Futures = leveraged directional bets by institutions
// Index futures: Nifty, Sensex, BankNifty, FinNifty
// Stock futures: 15 F&O stocks (NSE only — BSE F&O volume negligible)
// =====================================================

export interface FuturesFlowBar {
  timestamp: string;
  // Index futures
  indexFutBuy: number;     // Total buy value of index futures (₹)
  indexFutSell: number;    // Total sell value of index futures
  indexFutNet: number;     // Net = buy - sell
  indexFutOI: number;      // Open interest change
  indexFutBasis: number;   // Average basis (future price - spot)
  // Stock futures (NSE only)
  stockFutBuy: number;
  stockFutSell: number;
  stockFutNet: number;
  stockFutOI: number;
  stockFutBasis: number;
  // Per-index breakdown
  indexBreakdown: {
    symbol: string;
    futBuy: number;
    futSell: number;
    futNet: number;
    basis: number;
    oiChg: number;
  }[];
}

// =====================================================
// COMPOSITE TRADE SIGNAL
// Combines ALL layers: price trend + cash flow + options flow + futures flow
// This is the final signal the trader acts on
// =====================================================

export type TradeAction = 'BUY_CALL' | 'BUY_PUT' | 'WAIT' | 'EXIT';

export interface CompositeSignal {
  timestamp: string;
  action: TradeAction;
  confidence: number;        // 0-100
  score: number;             // -100 to +100 (negative = bearish, positive = bullish)
  // Component scores
  priceTrendScore: number;   // -100 to +100
  cashFlowScore: number;     // -100 to +100
  idxOptScore: number;       // -100 to +100
  stkOptScore: number;       // -100 to +100
  idxFutScore: number;       // -100 to +100
  stkFutScore: number;       // -100 to +100
  // Suggested trade details
  suggestedStrike: number;
  suggestedPremium: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  // Reasoning
  reasoning: string;
  // Divergence alerts
  cashOptDivergence: boolean;
  futCashDivergence: boolean;
}

export const SIGNAL_WEIGHTS = {
  fiiFlow: 0.25,
  propdeskFlow: 0.20,
  clientContrarian: 0.15,
  threeDayOITrend: 0.15,
  cashFutAlign: 0.10,
  globalContext: 0.10,
  stockSentiment: 0.05,
} as const;
