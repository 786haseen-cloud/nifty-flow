export type OptionType = 'CE' | 'PE';
export type SignalType = 'CALL_BUY' | 'PUT_BUY' | 'SELL_BOTH' | 'WAIT';
export type SignalMode = 'aggressive' | 'conservative';
export type InstrumentType = 'index' | 'stock';
export type BuiltUpType = 'Call Writing' | 'Call Long Cvr.' | 'Put Writing' | 'Put Long Cvr.' | 'Put Short Cvr.' | 'None';
export type PlayerType = 'FII' | 'DII' | 'PROPDESK' | 'CLIENT';
export type ExpiryType = 'weekly' | 'monthly';

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

export interface NiftyDivergencePoint {
  date: string;
  niftyPrice: number;
  fiiNetFlow: number;
}

// Constants
export const INDICES = [
  { symbol: 'NIFTY', name: 'Nifty 50', lotSize: 25, strikes: 11, step: 50, expiryDay: 2, expiryType: 'weekly' as ExpiryType },
  { symbol: 'SENSEX', name: 'Sensex', lotSize: 10, strikes: 11, step: 100, expiryDay: 4, expiryType: 'weekly' as ExpiryType },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty', lotSize: 15, strikes: 11, step: 100, expiryDay: -1, expiryType: 'monthly' as ExpiryType },
  { symbol: 'FINNIFTY', name: 'Fin Nifty', lotSize: 25, strikes: 11, step: 50, expiryDay: -1, expiryType: 'monthly' as ExpiryType },
] as const;

export const TOP_STOCKS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', lotSize: 250, step: 10 },
  { symbol: 'TCS', name: 'Tata Consultancy', lotSize: 150, step: 5 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', lotSize: 550, step: 5 },
  { symbol: 'INFY', name: 'Infosys', lotSize: 300, step: 5 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', lotSize: 700, step: 5 },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', lotSize: 300, step: 5 },
  { symbol: 'SBIN', name: 'State Bank India', lotSize: 3750, step: 2.5 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', lotSize: 1100, step: 5 },
  { symbol: 'ITC', name: 'ITC Limited', lotSize: 1600, step: 2.5 },
  { symbol: 'KOTAKBANK', name: 'Kotak Bank', lotSize: 400, step: 5 },
  { symbol: 'LT', name: 'Larsen & Toubro', lotSize: 150, step: 10 },
  { symbol: 'AXISBANK', name: 'Axis Bank', lotSize: 900, step: 2.5 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', lotSize: 125, step: 10 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', lotSize: 50, step: 50 },
  { symbol: 'TITAN', name: 'Titan Company', lotSize: 250, step: 10 },
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

export const SIGNAL_WEIGHTS = {
  fiiFlow: 0.25,
  propdeskFlow: 0.20,
  clientContrarian: 0.15,
  threeDayOITrend: 0.15,
  cashFutAlign: 0.10,
  globalContext: 0.10,
  stockSentiment: 0.05,
} as const;
