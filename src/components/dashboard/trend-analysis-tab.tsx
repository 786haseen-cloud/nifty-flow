'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { withCreds, hasKiteCreds } from '@/lib/kite-creds';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer, ComposedChart,
} from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Activity, Wallet } from 'lucide-react';

// ─── Types ───

interface NiftyCandle {
  time: string;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface StockCashFlow {
  symbol: string;
  name: string;
  nseLtp: number;
  nseOpen: number;
  nseChange: number;
  nseVolume: number;
  nseCashFlow: number;
  bseLtp: number;
  bseOpen: number;
  bseChange: number;
  bseVolume: number;
  bseCashFlow: number;
  combinedFlow: number;
  niftyWeight: number;
  weightedFlow: number;
}

interface StrikeData {
  strike: number;
  ceLTP: number;
  peLTP: number;
  ceOI: number;
  peOI: number;
  ceVol: number;
  peVol: number;
  ceDelta: number;
  peDelta: number;
}

interface SymbolSnapshot {
  symbol: string;
  name: string;
  type: 'index' | 'stock';
  spotPrice: number;
  lotSize: number;
  strikes: StrikeData[];
}

interface CashFlowTrendPoint {
  time: string;
  nse: number;          // cumulative NSE cash flow (Cr)
  bse: number;          // cumulative BSE cash flow (Cr)
  net: number;          // cumulative combined net (Cr)
  weighted: number;     // cumulative Nifty-weighted net (Cr)
  interval: number;     // this interval's net flow (Cr)
}

interface FlowTrendPoint {
  time: string;
  NIFTY: number;
  BANKNIFTY: number;
  FINNIFTY: number;
  SENSEX: number;
  stockAggregate: number;
}

interface HighestBetResponse {
  mode: string;
  timestamp: string;
  symbols: SymbolSnapshot[];
}

// ─── Index colors ───

const IDX_COLORS: Record<string, { stroke: string; fill: string; bg: string }> = {
  NIFTY:     { stroke: '#10b981', fill: '#10b98120', bg: 'bg-emerald-500/10' },
  BANKNIFTY: { stroke: '#3b82f6', fill: '#3b82f620', bg: 'bg-blue-500/10' },
  FINNIFTY:  { stroke: '#f59e0b', fill: '#f59e0b20', bg: 'bg-amber-500/10' },
  SENSEX:    { stroke: '#a855f7', fill: '#a855f720', bg: 'bg-purple-500/10' },
};

const IDX_NAMES: Record<string, string> = {
  NIFTY: 'Nifty 50',
  BANKNIFTY: 'Bank Nifty',
  FINNIFTY: 'Fin Nifty',
  SENSEX: 'Sensex',
};

// ─── 4-Color Flow Engine ───
// Computes net options flow from consecutive snapshots
// Delta-weighted: (deltaOI * delta * lotSize) / 1Cr
// OI decrease: multiply by 0.3 (short covering)

function computeSymbolFlow(
  prev: StrikeData[],
  curr: StrikeData[],
  lotSize: number
): { bullish: number; bearish: number; net: number } {
  let bullish = 0;
  let bearish = 0;

  const CR = 10000000; // 1 Crore

  for (const currStrike of curr) {
    const prevStrike = prev.find((s) => s.strike === currStrike.strike);
    if (!prevStrike) continue;

    const ceDeltaOI = currStrike.ceOI - prevStrike.ceOI;
    const peDeltaOI = currStrike.peOI - prevStrike.peOI;
    const ceDeltaPrice = currStrike.ceLTP - prevStrike.ceLTP;
    const peDeltaPrice = currStrike.peLTP - prevStrike.peLTP;

    // CE Flow
    if (ceDeltaOI > 0) {
      const val = (Math.abs(ceDeltaOI) * currStrike.ceDelta * lotSize) / CR;
      if (ceDeltaPrice > 0) {
        bullish += val; // CE Buy (bullish)
      } else {
        bearish += val; // CE Write (bearish)
      }
    } else if (ceDeltaOI < 0) {
      // Short covering: 0.3 factor
      const val = (Math.abs(ceDeltaOI) * 0.3 * currStrike.ceDelta * lotSize) / CR;
      if (ceDeltaPrice > 0) {
        bullish += val; // CE Buy (short cover)
      } else {
        bearish += val; // CE Write (short cover)
      }
    }

    // PE Flow
    if (peDeltaOI > 0) {
      const val = (Math.abs(peDeltaOI) * currStrike.peDelta * lotSize) / CR;
      if (peDeltaPrice > 0) {
        bullish += val; // PE Write (bullish)
      } else {
        bearish += val; // PE Buy (bearish)
      }
    } else if (peDeltaOI < 0) {
      const val = (Math.abs(peDeltaOI) * 0.3 * currStrike.peDelta * lotSize) / CR;
      if (peDeltaPrice > 0) {
        bullish += val; // PE Write (short cover)
      } else {
        bearish += val; // PE Buy (short cover)
      }
    }
  }

  return { bullish, bearish, net: bullish - bearish };
}

// ─── Custom Tooltip ───

function NiftyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      <div className="text-emerald-400 font-semibold">Close: {d?.close?.toLocaleString('en-IN')}</div>
      {d?.high && <div className="text-muted-foreground">H: {d.high.toLocaleString('en-IN')} L: {d.low.toLocaleString('en-IN')}</div>}
      {d?.volume && <div className="text-muted-foreground">Vol: {(d.volume / 1000000).toFixed(1)}M</div>}
    </div>
  );
}

function CashFlowTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      <div className="text-emerald-400">NSE Cum: {d?.nse?.toFixed(1)} Cr</div>
      <div className="text-sky-400">BSE Cum: {d?.bse?.toFixed(1)} Cr</div>
      <div className={d?.net >= 0 ? 'text-amber-400 font-semibold' : 'text-red-400 font-semibold'}>
        Net Cum: {d?.net?.toFixed(1)} Cr
      </div>
      <div className="text-muted-foreground mt-1">
        This 15s: <span className={d?.interval >= 0 ? 'text-emerald-300' : 'text-red-300'}>{d?.interval >= 0 ? '+' : ''}{d?.interval?.toFixed(1)} Cr</span>
      </div>
    </div>
  );
}

function FlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.dataKey}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value} Cr
        </div>
      ))}
    </div>
  );
}

function CashTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <div className="font-semibold text-foreground mb-1">{d.symbol}</div>
      <div className="text-muted-foreground">{d.name}</div>
      <div className="mt-1 text-emerald-400">NSE: {(d.nseCashFlow / 10000000).toFixed(1)} Cr</div>
      <div className="text-sky-400">BSE: {(d.bseCashFlow / 10000000).toFixed(1)} Cr</div>
      <div className={d.combinedFlow >= 0 ? 'text-emerald-300 font-semibold mt-1' : 'text-red-400 font-semibold mt-1'}>
        Net: {(d.combinedFlow / 10000000).toFixed(1)} Cr
      </div>
      <div className="text-muted-foreground">Wt: {d.niftyWeight}%</div>
    </div>
  );
}

// ─── Main Component ───

export default function TrendAnalysisTab() {
  const isLive = hasKiteCreds();

  // Trends API data (candles + cash flow)
  const [niftyCandles, setNiftyCandles] = useState<NiftyCandle[]>([]);
  const [stockCashFlow, setStockCashFlow] = useState<StockCashFlow[]>([]);
  const [trendMode, setTrendMode] = useState<string>('demo');

  // Highest-bet snapshots for options flow computation
  const prevSnapshot = useRef<Map<string, StrikeData[]>>(new Map());
  const [flowTrend, setFlowTrend] = useState<FlowTrendPoint[]>([]);
  const cumulativeFlow = useRef<Record<string, number>>({
    NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0, stockAggregate: 0,
  });

  // Cash flow trend accumulation
  const [cashFlowTrend, setCashFlowTrend] = useState<CashFlowTrendPoint[]>([]);
  const cumulativeCash = useRef({ nse: 0, bse: 0, net: 0, weighted: 0 });
  const prevStockCashFlow = useRef<StockCashFlow[]>([]);

  // Current flow values (for header cards)
  const [currentIdxFlows, setCurrentIdxFlows] = useState<Record<string, number>>({
    NIFTY: 0, BANKNIFTY: 0, FINNIFTY: 0, SENSEX: 0,
  });
  const [currentStockFlow, setCurrentStockFlow] = useState(0);
  const [currentIntervalCashFlow, setCurrentIntervalCashFlow] = useState(0);

  // ─── Fetch trends data (candles + cash) ───

  const fetchTrends = useCallback(async () => {
    try {
      let url = '/api/kite/trends';
      url = withCreds(url);
      const res = await fetch(url);
      const data = await res.json();

      setTrendMode(data.mode || 'demo');
      if (data.niftyCandles) setNiftyCandles(data.niftyCandles);

      // Build cash flow trend from consecutive snapshots
      if (data.stockCashFlow && data.stockCashFlow.length > 0) {
        setStockCashFlow(data.stockCashFlow);

        const time = new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });

        const nseTotal = data.stockCashFlow.reduce((s, v) => s + v.nseCashFlow, 0);
        const bseTotal = data.stockCashFlow.reduce((s, v) => s + v.bseCashFlow, 0);
        const netTotal = nseTotal + bseTotal;
        const weightedTotal = data.stockCashFlow.reduce((s, v) => s + v.weightedFlow, 0);

        // Compute interval delta (this poll minus previous poll)
        let intervalDelta = netTotal;
        if (prevStockCashFlow.current.length > 0) {
          const prevNse = prevStockCashFlow.current.reduce((s, v) => s + v.nseCashFlow, 0);
          const prevBse = prevStockCashFlow.current.reduce((s, v) => s + v.bseCashFlow, 0);
          intervalDelta = netTotal - (prevNse + prevBse);
        }
        prevStockCashFlow.current = data.stockCashFlow;
        setCurrentIntervalCashFlow(intervalDelta);

        // Accumulate
        cumulativeCash.current.nse += nseTotal;
        cumulativeCash.current.bse += bseTotal;
        cumulativeCash.current.net += netTotal;
        cumulativeCash.current.weighted += weightedTotal;

        const CR = 10000000;
        const point: CashFlowTrendPoint = {
          time,
          nse: Math.round((cumulativeCash.current.nse / CR) * 10) / 10,
          bse: Math.round((cumulativeCash.current.bse / CR) * 10) / 10,
          net: Math.round((cumulativeCash.current.net / CR) * 10) / 10,
          weighted: Math.round((cumulativeCash.current.weighted / CR) * 10) / 10,
          interval: Math.round((intervalDelta / CR) * 10) / 10,
        };

        setCashFlowTrend((prev) => {
          const next = [...prev, point];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
    } catch (err) {
      console.error('[TrendsTab] fetchTrends error:', err);
    }
  }, []);

  // ─── Fetch highest-bet for options flow ───

  const fetchOptionsFlow = useCallback(async () => {
    try {
      let url = '/api/kite/highest-bet';
      url = withCreds(url);
      const res = await fetch(url);
      const data: HighestBetResponse = await res.json();

      if (!data.symbols || data.symbols.length === 0) return;

      const time = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });

      // Compute per-symbol flow from consecutive snapshots
      const intervalFlows: Record<string, number> = {};
      const indexSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'];
      let stockAgg = 0;
      const newCurrentIdx: Record<string, number> = {};

      for (const sym of data.symbols) {
        if (sym.strikes.length === 0) continue;

        const prevStrikes = prevSnapshot.current.get(sym.symbol);
        if (!prevStrikes || prevStrikes.length === 0) {
          // First snapshot — store and skip
          prevSnapshot.current.set(sym.symbol, sym.strikes);
          continue;
        }

        const flow = computeSymbolFlow(prevStrikes, sym.strikes, sym.lotSize);
        intervalFlows[sym.symbol] = flow.net;

        if (sym.type === 'index' && indexSymbols.includes(sym.symbol)) {
          cumulativeFlow.current[sym.symbol] += flow.net;
          newCurrentIdx[sym.symbol] = flow.net;
        } else if (sym.type === 'stock') {
          stockAgg += flow.net;
        }

        // Update previous snapshot
        prevSnapshot.current.set(sym.symbol, sym.strikes);
      }

      cumulativeFlow.current.stockAggregate += stockAgg;
      setCurrentStockFlow(stockAgg);

      // Update current index flows
      for (const idx of indexSymbols) {
        newCurrentIdx[idx] = newCurrentIdx[idx] || 0;
      }
      setCurrentIdxFlows(newCurrentIdx);

      // Append to trend (keep last 200 points)
      const point: FlowTrendPoint = {
        time,
        NIFTY: Math.round(cumulativeFlow.current.NIFTY * 10) / 10,
        BANKNIFTY: Math.round(cumulativeFlow.current.BANKNIFTY * 10) / 10,
        FINNIFTY: Math.round(cumulativeFlow.current.FINNIFTY * 10) / 10,
        SENSEX: Math.round(cumulativeFlow.current.SENSEX * 10) / 10,
        stockAggregate: Math.round(cumulativeFlow.current.stockAggregate * 10) / 10,
      };

      setFlowTrend((prev) => {
        const next = [...prev, point];
        return next.length > 200 ? next.slice(-200) : next;
      });
    } catch (err) {
      console.error('[TrendsTab] fetchOptionsFlow error:', err);
    }
  }, []);

  // ─── Polling ───

  useEffect(() => {
    fetchTrends();
    fetchOptionsFlow();

    const trendsInterval = setInterval(fetchTrends, 15000);
    const flowInterval = setInterval(fetchOptionsFlow, 15000);

    return () => {
      clearInterval(trendsInterval);
      clearInterval(flowInterval);
    };
  }, [fetchTrends, fetchOptionsFlow]);

  // ─── Derived values ───

  const niftyCurrentPrice = niftyCandles.length > 0 ? niftyCandles[niftyCandles.length - 1].close : 0;
  const niftyOpenPrice = niftyCandles.length > 0 ? niftyCandles[0].close : 0;
  const niftyChange = niftyOpenPrice > 0 ? niftyCurrentPrice - niftyOpenPrice : 0;
  const niftyChangePct = niftyOpenPrice > 0 ? (niftyChange / niftyOpenPrice) * 100 : 0;

  const totalNseFlow = stockCashFlow.reduce((s, v) => s + v.nseCashFlow, 0);
  const totalBseFlow = stockCashFlow.reduce((s, v) => s + v.bseCashFlow, 0);
  const totalCombinedFlow = totalNseFlow + totalBseFlow;
  const totalWeightedFlow = stockCashFlow.reduce((s, v) => s + v.weightedFlow, 0);

  // ─── Format helpers ───

  const fmtCr = (v: number) => {
    const cr = v / 10000000;
    if (Math.abs(cr) >= 100) return `${cr.toFixed(0)}`;
    if (Math.abs(cr) >= 1) return `${cr.toFixed(1)}`;
    return `${cr.toFixed(2)}`;
  };

  // ─── Render ───

  return (
    <div className="space-y-4">
      {/* Header with mode badge + summary cards */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={trendMode === 'live' ? 'border-emerald-500/40 text-emerald-300' : 'border-orange-500/40 text-orange-300'}>
            {trendMode === 'live' ? 'LIVE' : 'Demo'}
          </Badge>
          <span className="text-xs text-muted-foreground">Trend Analysis — Price + Cash + Options Flow</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Auto-refresh: 15s</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Flow pts: {flowTrend.length}</span>
        </div>
      </div>

      {/* Section 1: Nifty 50 Spot Price + Cash Flow Trend (stacked) */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Nifty 50 — Intraday Price Trend</h3>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {niftyCurrentPrice > 0 && (
              <>
                <span className="font-mono font-semibold text-emerald-400">
                  {niftyCurrentPrice.toLocaleString('en-IN')}
                </span>
                <span className={`flex items-center gap-0.5 font-mono ${niftyChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {niftyChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {niftyChange >= 0 ? '+' : ''}{niftyChange.toFixed(1)} ({niftyChangePct >= 0 ? '+' : ''}{niftyChangePct.toFixed(2)}%)
                </span>
              </>
            )}
          </div>
        </div>
        <div className="h-[200px]">
          {niftyCandles.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={niftyCandles} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="niftyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  interval={Math.max(0, Math.floor(niftyCandles.length / 8) - 1)}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  tickFormatter={(v: number) => (v / 1000).toFixed(1) + 'K'}
                  width={55}
                />
                <Tooltip content={<NiftyTooltip />} />
                {niftyOpenPrice > 0 && (
                  <ReferenceLine y={niftyOpenPrice} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />
                )}
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#niftyGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Waiting for candle data...
            </div>
          )}
        </div>

        {/* Net Cash Flow Trend — directly below Nifty price */}
        <div className="mt-1 pt-3 border-t border-border/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-sky-400" />
              <h4 className="text-xs font-semibold">Net Cash Flow — 15 Stocks (NSE + BSE, Cumulative)</h4>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">NSE: {fmtCr(cumulativeCash.current.nse)} Cr</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-muted-foreground">BSE: {fmtCr(cumulativeCash.current.bse)} Cr</span>
              </div>
              <div className={`font-mono font-semibold ${cumulativeCash.current.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                Net: {fmtCr(cumulativeCash.current.net)} Cr
              </div>
              <span className={`font-mono ${currentIntervalCashFlow >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                15s: {currentIntervalCashFlow >= 0 ? '+' : ''}{fmtCr(currentIntervalCashFlow)} Cr
              </span>
            </div>
          </div>
          <div className="h-[130px]">
            {cashFlowTrend.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashFlowTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cashNetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cumulativeCash.current.net >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={cumulativeCash.current.net >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    interval={Math.max(0, Math.floor(cashFlowTrend.length / 8) - 1)}
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={40}
                  />
                  <Tooltip content={<CashFlowTrendTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  {/* NSE cumulative line */}
                  <Line type="monotone" dataKey="nse" stroke="#22c55e" strokeWidth={1.2} dot={false} strokeOpacity={0.7} />
                  {/* BSE cumulative line */}
                  <Line type="monotone" dataKey="bse" stroke="#0ea5e9" strokeWidth={1.2} dot={false} strokeOpacity={0.7} />
                  {/* Net combined area */}
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#cashNetGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating cash flow trend... (need 2+ polls)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Index Options Flow + Current Flow Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Index Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              <h3 className="text-sm font-semibold">Index Options Money Flow</h3>
            </div>
            <span className="text-[10px] text-muted-foreground">Cumulative Net Flow (Cr)</span>
          </div>
          {/* Current interval cards */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'].map((idx) => {
              const flow = currentIdxFlows[idx] || 0;
              const cum = cumulativeFlow.current[idx] || 0;
              const c = IDX_COLORS[idx];
              return (
                <div key={idx} className={`${c.bg} rounded-lg p-1.5 text-center`}>
                  <div className="text-[9px] text-muted-foreground">{IDX_NAMES[idx]}</div>
                  <div className={`text-xs font-mono font-semibold ${flow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {flow >= 0 ? '+' : ''}{fmtCr(flow)}
                  </div>
                  <div className="text-[9px] text-muted-foreground font-mono">
                    cum: {fmtCr(cum)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-[200px]">
            {flowTrend.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={flowTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    interval={Math.max(0, Math.floor(flowTrend.length / 6) - 1)}
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={45}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'].map((idx) => (
                    <Line
                      key={idx}
                      type="monotone"
                      dataKey={idx}
                      stroke={IDX_COLORS[idx].stroke}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>

        {/* Stock Options Money Flow Trend */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Stock Options Money Flow (15 F&O Stocks)</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-semibold ${currentStockFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                Interval: {currentStockFlow >= 0 ? '+' : ''}{fmtCr(currentStockFlow)} Cr
              </span>
              <span className="text-[10px] text-muted-foreground">
                Cum: {fmtCr(cumulativeFlow.current.stockAggregate)} Cr
              </span>
            </div>
          </div>
          <div className="h-[230px]">
            {flowTrend.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stockFlowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#a1a1aa', fontSize: 9 }}
                    interval={Math.max(0, Math.floor(flowTrend.length / 6) - 1)}
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={45}
                  />
                  <Tooltip content={<FlowTooltip />} />
                  <ReferenceLine y={0} stroke="#ffffff30" />
                  <Area
                    type="monotone"
                    dataKey="stockAggregate"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#stockFlowGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Accumulating stock options flow data... (need 2+ snapshots)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Dual Exchange Cash Flow */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold">Dual Exchange Cash Flow — 15 F&O Stocks (NSE + BSE)</h3>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">NSE: {fmtCr(totalNseFlow)} Cr</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
              <span className="text-muted-foreground">BSE: {fmtCr(totalBseFlow)} Cr</span>
            </div>
            <div className={`font-mono font-semibold ${totalCombinedFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Net: {fmtCr(totalCombinedFlow)} Cr
            </div>
            <div className="text-muted-foreground">
              Weighted: {fmtCr(totalWeightedFlow)} Cr
            </div>
          </div>
        </div>
        <div className="h-[280px]">
          {stockCashFlow.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stockCashFlow}
                margin={{ top: 5, right: 10, left: 10, bottom: 60 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  tickFormatter={(v: number) => `${(v / 10000000).toFixed(0)}Cr`}
                />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  width={85}
                />
                <Tooltip content={<CashTooltip />} />
                <ReferenceLine x={0} stroke="#ffffff30" />
                <Bar dataKey="nseCashFlow" fill="#22c55e" radius={[0, 3, 3, 0]} maxBarSize={12} />
                <Bar dataKey="bseCashFlow" fill="#0ea5e9" radius={[0, 3, 3, 0]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Waiting for stock cash flow data...
            </div>
          )}
        </div>
        {/* Cash flow summary table */}
        {stockCashFlow.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-left py-1 pr-2">Symbol</th>
                  <th className="text-right py-1 px-1">Wt%</th>
                  <th className="text-right py-1 px-1">NSE LTP</th>
                  <th className="text-right py-1 px-1">NSE Chg%</th>
                  <th className="text-right py-1 px-1">NSE Flow</th>
                  <th className="text-right py-1 px-1">BSE LTP</th>
                  <th className="text-right py-1 px-1">BSE Chg%</th>
                  <th className="text-right py-1 px-1">BSE Flow</th>
                  <th className="text-right py-1 px-1">Combined</th>
                  <th className="text-right py-1 pl-1">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {stockCashFlow.map((s) => (
                  <tr key={s.symbol} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="py-1 pr-2 font-medium">{s.symbol}</td>
                    <td className="text-right py-1 px-1 text-muted-foreground">{s.niftyWeight}%</td>
                    <td className="text-right py-1 px-1 font-mono">{s.nseLtp.toLocaleString('en-IN')}</td>
                    <td className={`text-right py-1 px-1 font-mono ${s.nseChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.nseChange >= 0 ? '+' : ''}{s.nseChange}%
                    </td>
                    <td className={`text-right py-1 px-1 font-mono ${s.nseCashFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtCr(s.nseCashFlow)}
                    </td>
                    <td className="text-right py-1 px-1 font-mono">{s.bseLtp > 0 ? s.bseLtp.toLocaleString('en-IN') : '-'}</td>
                    <td className={`text-right py-1 px-1 font-mono ${s.bseChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.bseLtp > 0 ? `${s.bseChange >= 0 ? '+' : ''}${s.bseChange}%` : '-'}
                    </td>
                    <td className={`text-right py-1 px-1 font-mono ${s.bseCashFlow >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
                      {s.bseLtp > 0 ? fmtCr(s.bseCashFlow) : '-'}
                    </td>
                    <td className={`text-right py-1 px-1 font-mono font-semibold ${s.combinedFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                      {fmtCr(s.combinedFlow)}
                    </td>
                    <td className={`text-right py-1 pl-1 font-mono ${s.weightedFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                      {fmtCr(s.weightedFlow)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
