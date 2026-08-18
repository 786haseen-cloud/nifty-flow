// ============================================================
// Indian Options Trading Dashboard — Type Definitions
// ============================================================

export type OptionType = 'CE' | 'PE';
export type SignalType = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type SignalMode = 'aggressive' | 'conservative';
export type InstrumentType = 'INDEX' | 'STOCK';
export type BuiltUpType = 'Long Build-up' | 'Short Build-up' | 'Long Unwinding' | 'Short Covering' | 'None';

export const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'] as const;
export const TOP_STOCKS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI'
] as const;

export const RISK_FREE_RATE = 0.07; // India 10Y bond ~7%

export interface OptionStrike {
  strike: number;
  callLTP: number;
  callOI: number;
  callOIChange: number;
  callVolume: number;
  callIV: number;
  putLTP: number;
  putOI: number;
  putOIChange: number;
  putVolume: number;
  putIV: number;
  builtUpType: BuiltUpType;
}

export interface InstrumentData {
  symbol: string;
  name: string;
  type: InstrumentType;
  ltp: number;
  change: number;
  changePct: number;
  atmStrike: number;
  strikes: OptionStrike[];
  totalCallOI: number;
  totalPutOI: number;
  pcr: number; // Put-Call Ratio
  maxPain: number;
  ivSkew: number;
  spotPrice: number;
  futuresPremium: number;
  futuresOI: number;
  futuresOIChange: number;
}

export interface VIXData {
  value: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  open: number;
  prevClose: number;
  status: 'low' | 'normal' | 'elevated' | 'high' | 'extreme';
}

export interface GreeksData {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
}

export interface SignalReasoning {
  pcrSignal: string;
  oiSignal: string;
  vixSignal: string;
  ivSignal: string;
  builtUpSignal: string;
  trendSignal: string;
  // Holistic additions
  holistic: {
    ownWeight: number;
    sentimentWeight: number;
    crossIndexWeight: number;
    vixWeight: number;
    thetaWeight: number;
    ownScore: number;
    sentimentScore: number;
    crossIndexScore: number;
    vixScore: number;
    thetaScore: number;
    finalScore: number;
  };
}

export interface Signal {
  id: string;
  timestamp: Date;
  instrument: string;
  signalType: SignalType;
  mode: SignalMode;
  confidence: number; // 0-100
  strike: number;
  optionType: OptionType;
  premium: number;
  stopLoss: number;
  target: number;
  reasoning: SignalReasoning;
  vixValue: number;
  pcrValue: number;
}

export interface DailySummary {
  date: string;
  instrument: string;
  totalOI: number;
  totalVolume: number;
  callOI: number;
  putOI: number;
  pcr: number;
  vixOpen: number;
  vixHigh: number;
  vixLow: number;
  vixClose: number;
  signals: string;
  summary: string;
  fiiCashNet: number;
  diiCashNet: number;
  fiiFutNet: number;
  diiFutNet: number;
  fiiOptNet: number;
  diiOptNet: number;
}

// ============================================================
// Institutional Flow & Big Money Types
// ============================================================

export interface InstitutionalFlow {
  date: string;
  fii: {
    cashBuy: number; cashSell: number; cashNet: number;
    futBuy: number; futSell: number; futNet: number;
    optCallBuy: number; optCallSell: number; optCallNet: number;
    optPutBuy: number; optPutSell: number; optPutNet: number;
    totalNet: number;
  };
  dii: {
    cashBuy: number; cashSell: number; cashNet: number;
    futBuy: number; futSell: number; futNet: number;
    optCallBuy: number; optCallSell: number; optCallNet: number;
    optPutBuy: number; optPutSell: number; optPutNet: number;
    totalNet: number;
  };
  dominantPlayer: 'FII' | 'DII' | 'NONE';
  dominantSegment: 'cash' | 'futures' | 'options' | 'mixed';
  stance: 'bullish' | 'bearish' | 'neutral';
}

export interface BigTrade {
  timestamp: Date;
  instrument: string;
  tradeType: 'CASH' | 'FUTURE' | 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  quantity: number;
  value: number; // in Crores
  strike?: number;
  ltp?: number;
  impact: 'Heavy' | 'Moderate' | 'Light';
}

export interface DivergencePoint {
  time: string;
  priceDirection: 'up' | 'down' | 'flat';
  scoreDirection: 'up' | 'down' | 'flat';
  divergenceType: 'bullish' | 'bearish' | 'confirmed' | 'none';
  priceValue: number;
  scoreValue: number;
}

export interface TimeSeriesPoint {
  time: string;
  niftyPrice: number;
  signalScore: number;
  divergence?: 'bullish' | 'bearish' | 'confirmed';
}

export interface OIBuildupEvent {
  time: string;
  instrument: string;
  strike: number;
  optionType: 'CE' | 'PE';
  oiChange: number;
  builtUpType: string;
  significance: 'high' | 'medium' | 'low';
}

// Holistic Signal Context
export interface HolisticContext {
  ownDataScore: number;
  stockSentimentScore: number;
  crossIndexScore: number;
  vixScore: number;
  thetaScore: number;
  // Weights
  ownWeight: number;
  sentimentWeight: number;
  crossIndexWeight: number;
  vixWeight: number;
  thetaWeight: number;
  // Final
  finalScore: number;
  confidence: number;
  signalType: SignalType;
}

// Kite config for settings
export interface KiteConfigData {
  apiKey: string;
  accessToken: string;
  isConnected: boolean;
}
