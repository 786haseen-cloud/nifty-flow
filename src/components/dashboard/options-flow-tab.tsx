'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, Activity, Layers, Zap, Crosshair,
  TrendingUp, TrendingDown, ShieldAlert, AlertTriangle,
  Wifi, WifiOff, Settings2, RefreshCw,
} from 'lucide-react';
import type { OptionsFlowBar, FuturesFlowBar, CompositeSignal } from '@/lib/types';
import { computeCompositeSignal } from '@/lib/demo-data';
import { useKiteSnapshot } from '@/hooks/use-kite-snapshot';
import type { SnapshotSymbol } from '@/hooks/use-kite-snapshot';

// Chart dimensions — compact for single-screen
const VISIBLE_BARS = 160;
const BAR_WIDTH = 2;
const CHART_H = 72;

// Color palette
const C = {
  callBuy: '#16a34a',      // dark green
  putWrite: '#4ade80',     // light green
  putBuy: '#dc2626',       // dark red
  callWrite: '#f87171',    // light red
  bullish: '#22c55e',
  bearish: '#ef4444',
  netBlue: '#3b82f6',
  futBuy: '#818cf8',       // indigo-400
  futSell: '#f472b6',      // pink-400
  score: '#fbbf24',        // amber-400
  priceUp: '#34d399',
  priceDn: '#f87171',
} as const;

const CROR = 10000000; // 1 Crore

// ═══════════════════════════════════════════════════════════
// 4-COLOR FLOW ENGINE — Computes real flow from snapshot diffs
// ═══════════════════════════════════════════════════════════

interface FourColorFlow {
  callBuy: number;
  callWrite: number;
  putBuy: number;
  putWrite: number;
}

function computeStrike4ColorFlow(
  prev: SnapshotSymbol | undefined,
  curr: SnapshotSymbol,
  strike: number,
): FourColorFlow {
  const currStrike = curr.strikes.find(s => s.strike === strike);
  const prevStrike = prev?.strikes.find(s => s.strike === strike);
  if (!currStrike) return { callBuy: 0, callWrite: 0, putBuy: 0, putWrite: 0 };

  const dceOI = currStrike.ceOI - (prevStrike?.ceOI ?? 0);
  const dceP = currStrike.ceLTP - (prevStrike?.ceLTP ?? 0);
  const dpeOI = currStrike.peOI - (prevStrike?.peOI ?? 0);
  const dpeP = currStrike.peLTP - (prevStrike?.peLTP ?? 0);

  const lotSize = curr.lotSize || curr.futLotSize || 25;
  const ceDelta = Math.abs(currStrike.ceDelta) || 0.5;
  const peDelta = Math.abs(currStrike.peDelta) || 0.5;

  // OI decrease = unwinding → 0.3 factor
  const ceFactor = dceOI > 0 ? 1.0 : 0.3;
  const peFactor = dpeOI > 0 ? 1.0 : 0.3;

  const result: FourColorFlow = { callBuy: 0, callWrite: 0, putBuy: 0, putWrite: 0 };

  // CE flow: (dOI * delta * lotSize) / 1Cr
  if (dceOI !== 0) {
    const ceValue = Math.abs(dceOI) * ceDelta * lotSize;
    if (dceP >= 0) {
      result.callBuy = ceValue * ceFactor;  // CE Buy: OI up + price up
    } else {
      result.callWrite = ceValue * ceFactor; // CE Write: OI up + price down
    }
  }

  // PE flow: (dOI * delta * lotSize) / 1Cr
  if (dpeOI !== 0) {
    const peValue = Math.abs(dpeOI) * peDelta * lotSize;
    if (dpeP <= 0) {
      result.putBuy = peValue * peFactor;   // PE Buy: OI up + price down
    } else {
      result.putWrite = peValue * peFactor;  // PE Write: OI up + price up
    }
  }

  return result;
}

// Aggregate 4-color flow across all strikes of a symbol
function aggregateSymbolFlow(
  prev: SnapshotSymbol | undefined,
  curr: SnapshotSymbol,
): FourColorFlow {
  let callBuy = 0, callWrite = 0, putBuy = 0, putWrite = 0;
  for (const s of curr.strikes) {
    const f = computeStrike4ColorFlow(prev, curr, s.strike);
    callBuy += f.callBuy;
    callWrite += f.callWrite;
    putBuy += f.putBuy;
    putWrite += f.putWrite;
  }
  return { callBuy, callWrite, putBuy, putWrite };
}

// Compute index options flow bar from snapshot diffs
function computeOptionsFlowBar(
  prevSnapshot: SnapshotSymbol[] | undefined,
  currSnapshot: SnapshotSymbol[],
  timestamp: string,
): OptionsFlowBar {
  const prevMap = new Map((prevSnapshot ?? []).map(s => [s.symbol, s]));

  let idxCallBuy = 0, idxPutWrite = 0, idxPutBuy = 0, idxCallWrite = 0;
  let stkCallBuy = 0, stkPutWrite = 0, stkPutBuy = 0, stkCallWrite = 0;

  for (const sym of currSnapshot) {
    const prev = prevMap.get(sym.symbol);
    const flow = aggregateSymbolFlow(prev, sym);

    if (sym.type === 'index') {
      idxCallBuy += flow.callBuy;
      idxPutWrite += flow.putWrite;
      idxPutBuy += flow.putBuy;
      idxCallWrite += flow.callWrite;
    } else {
      stkCallBuy += flow.callBuy;
      stkPutWrite += flow.putWrite;
      stkPutBuy += flow.putBuy;
      stkCallWrite += flow.callWrite;
    }
  }

  return {
    timestamp,
    indexFlows: [],
    indexTotalCallBuy: idxCallBuy,
    indexTotalPutWrite: idxPutWrite,
    indexTotalPutBuy: idxPutBuy,
    indexTotalCallWrite: idxCallWrite,
    indexBullishFlow: idxCallBuy + idxPutWrite,
    indexBearishFlow: idxPutBuy + idxCallWrite,
    indexNetFlow: (idxCallBuy + idxPutWrite) - (idxPutBuy + idxCallWrite),
    stockFlows: [],
    stockTotalCallBuy: stkCallBuy,
    stockTotalPutWrite: stkPutWrite,
    stockTotalPutBuy: stkPutBuy,
    stockTotalCallWrite: stkCallWrite,
    stockBullishFlow: stkCallBuy + stkPutWrite,
    stockBearishFlow: stkPutBuy + stkCallWrite,
    stockNetFlow: (stkCallBuy + stkPutWrite) - (stkPutBuy + stkCallWrite),
  };
}

// Compute futures flow bar from snapshot diffs
function computeFuturesFlowBar(
  prevSnapshot: SnapshotSymbol[] | undefined,
  currSnapshot: SnapshotSymbol[],
  timestamp: string,
): FuturesFlowBar {
  const prevMap = new Map((prevSnapshot ?? []).map(s => [s.symbol, s]));

  let idxFutBuy = 0, idxFutSell = 0, idxFutOI = 0;
  let stkFutBuy = 0, stkFutSell = 0, stkFutOI = 0;
  let idxBasis = 0, idxCount = 0;
  let stkBasis = 0, stkCount = 0;

  const indexBreakdown: FuturesFlowBar['indexBreakdown'] = [];

  for (const sym of currSnapshot) {
    const prev = prevMap.get(sym.symbol);
    const dFutOI = sym.futOI - (prev?.futOI ?? 0);
    const basis = sym.futPrice - sym.spotPrice;
    const flowValue = Math.abs(dFutOI) * sym.futPrice;

    if (sym.type === 'index') {
      if (dFutOI > 0) idxFutBuy += flowValue;
      else idxFutSell += flowValue;
      idxFutOI += dFutOI;
      idxBasis += basis;
      idxCount++;
      indexBreakdown.push({
        symbol: sym.symbol,
        futBuy: dFutOI > 0 ? flowValue : 0,
        futSell: dFutOI < 0 ? flowValue : 0,
        futNet: dFutOI > 0 ? flowValue : -flowValue,
        basis,
        oiChg: dFutOI,
      });
    } else {
      if (dFutOI > 0) stkFutBuy += flowValue;
      else stkFutSell += flowValue;
      stkFutOI += dFutOI;
      stkBasis += basis;
      stkCount++;
    }
  }

  return {
    timestamp,
    indexFutBuy,
    indexFutSell,
    indexFutNet: idxFutBuy - idxFutSell,
    indexFutOI,
    indexFutBasis: idxCount > 0 ? idxBasis / idxCount : 0,
    stockFutBuy,
    stockFutSell,
    stockFutNet: stkFutBuy - stkFutSell,
    stockFutOI,
    stockFutBasis: stkCount > 0 ? stkBasis / stkCount : 0,
    indexBreakdown,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function OptionsFlowTab() {
  const { curr, prev, pollCount } = useKiteSnapshot(15000);

  // Bar histories accumulated from real diffs
  const optionsBarsRef = useRef<OptionsFlowBar[]>([]);
  const futBarsRef = useRef<FuturesFlowBar[]>([]);
  const priceHistoryRef = useRef<number[]>([]);
  const scoreHistoryRef = useRef<number[]>([]);
  const openPriceRef = useRef<number>(0);
  const prevPollRef = useRef<number>(0);

  // Visible data state (triggers re-render)
  const [optionsBars, setOptionsBars] = useState<OptionsFlowBar[]>([]);
  const [futBars, setFutBars] = useState<FuturesFlowBar[]>([]);
  const [niftyPrices, setNiftyPrices] = useState<number[]>([]);
  const [niftyPrice, setNiftyPrice] = useState(0);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);
  const [signal, setSignal] = useState<CompositeSignal | null>(null);
  const [mode, setMode] = useState<'live' | 'demo' | 'error' | 'loading'>('loading');

  // Chart settings
  const [chartSettings, setChartSettings] = useState({
    priceHeight: 140,
    barHeight: 72,
    visibleBars: 160,
    updateInterval: 15000,
    priceLineWidth: 1.2,
    scoreLineWidth: 1,
    priceColor: '#34d399',
    scoreColor: '#fbbf24',
  });
  const [showSettings, setShowSettings] = useState(false);

  // Get Nifty spot price from snapshot
  const niftySymbol = curr?.symbols.find(s => s.symbol === 'NIFTY');
  const currentSpotPrice = niftySymbol?.spotPrice ?? 0;

  // Core data computation — runs when pollCount changes (new snapshot)
  useEffect(() => {
    if (!curr || pollCount === prevPollRef.current) return;
    prevPollRef.current = pollCount;

    // Update mode
    setMode(curr.mode === 'demo' ? 'demo' : curr.mode);

    // Get Nifty symbol
    const nifty = curr.symbols.find(s => s.symbol === 'NIFTY');
    if (!nifty) return;

    // Set open price on first poll
    if (openPriceRef.current === 0) {
      openPriceRef.current = nifty.spotPrice;
    }
    const spotPrice = nifty.spotPrice;

    // Accumulate price history
    priceHistoryRef.current.push(spotPrice);
    if (priceHistoryRef.current.length > 500) {
      priceHistoryRef.current = priceHistoryRef.current.slice(-500);
    }
    setNiftyPrice(spotPrice);
    setNiftyPrices([...priceHistoryRef.current]);

    const ts = curr.timestamp || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

    // Only compute flow bars when we have a previous snapshot to diff against
    if (prev && prev.symbols.length > 0) {
      // Compute options flow from real OI diffs
      const optBar = computeOptionsFlowBar(prev.symbols, curr.symbols, ts);
      optionsBarsRef.current.push(optBar);
      if (optionsBarsRef.current.length > 500) {
        optionsBarsRef.current = optionsBarsRef.current.slice(-500);
      }
      setOptionsBars([...optionsBarsRef.current]);

      // Compute futures flow from real OI diffs
      const futBar = computeFuturesFlowBar(prev.symbols, curr.symbols, ts);
      futBarsRef.current.push(futBar);
      if (futBarsRef.current.length > 500) {
        futBarsRef.current = futBarsRef.current.slice(-500);
      }
      setFutBars([...futBarsRef.current]);

      // Compute composite signal (cashNet = 0 since Kite doesn't provide per-stock cash flow)
      const priceTrend = spotPrice - openPriceRef.current;
      const sig = computeCompositeSignal(
        0,                    // cashNet — not available from Kite
        optBar.indexNetFlow,  // idxOptNet
        optBar.stockNetFlow,  // stkOptNet
        futBar.indexFutNet,   // idxFutNet
        futBar.stockFutNet,   // stkFutNet
        priceTrend,           // priceTrend
      );
      setSignal(sig);
      scoreHistoryRef.current.push(sig.score);
      if (scoreHistoryRef.current.length > 500) {
        scoreHistoryRef.current = scoreHistoryRef.current.slice(-500);
      }
      setScoreHistory([...scoreHistoryRef.current]);
    }
  }, [curr, prev, pollCount]);

  // Visible slices
  const visBars = chartSettings.visibleBars;
  const visOpt = optionsBars.slice(-visBars);
  const visFut = futBars.slice(-visBars);
  const visPrices = niftyPrices.slice(-visBars);
  const visScores = scoreHistory.slice(-visBars);
  const latestOpt = visOpt[visOpt.length - 1];
  const latestFut = visFut[visFut.length - 1];

  // Scale calculations
  const idxOptMax = Math.max(1, ...visOpt.map(b => Math.max(b.indexBullishFlow, b.indexBearishFlow)));
  const stkOptMax = Math.max(1, ...visOpt.map(b => Math.max(b.stockBullishFlow, b.stockBearishFlow)));
  const idxFutMax = Math.max(1, ...visFut.map(b => Math.max(Math.abs(b.indexFutBuy), Math.abs(b.indexFutSell))));
  const stkFutMax = Math.max(1, ...visFut.map(b => Math.max(Math.abs(b.stockFutBuy), Math.abs(b.stockFutSell))));

  const priceMin = visPrices.length > 0 ? Math.min(...visPrices) : 0;
  const priceMax = visPrices.length > 0 ? Math.max(...visPrices) : 1;
  const priceRange = Math.max(1, priceMax - priceMin);

  // Summary totals
  const totalIdxOptNet = visOpt.reduce((s, b) => s + b.indexNetFlow, 0);
  const totalStkOptNet = visOpt.reduce((s, b) => s + b.stockNetFlow, 0);
  const totalIdxFutNet = visFut.reduce((s, b) => s + b.indexFutNet, 0);
  const totalStkFutNet = visFut.reduce((s, b) => s + b.stockFutNet, 0);

  // Score line scale
  const scoreMin = visScores.length > 0 ? Math.min(-50, ...visScores) : -50;
  const scoreMax = visScores.length > 0 ? Math.max(50, ...visScores) : 50;
  const scoreRange = Math.max(1, scoreMax - scoreMin);

  // Open price for change display
  const openPrice = openPriceRef.current || currentSpotPrice;

  return (
    <div className="space-y-2">
      {/* ═══════════════════════════════════════════════════════════
          ROW 0: STATUS BAR + SETTINGS TOGGLE
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {mode === 'live' ? (
            <Badge className="text-[8px] bg-emerald-500/20 text-emerald-300 border-emerald-500/40 px-1.5 py-0">
              <Wifi className="h-2.5 w-2.5 mr-0.5" /> Kite LIVE
            </Badge>
          ) : mode === 'demo' ? (
            <Badge className="text-[8px] bg-amber-500/20 text-amber-300 border-amber-500/40 px-1.5 py-0">
              <WifiOff className="h-2.5 w-2.5 mr-0.5" /> DEMO
            </Badge>
          ) : mode === 'error' ? (
            <Badge className="text-[8px] bg-red-500/20 text-red-300 border-red-500/40 px-1.5 py-0">
              <WifiOff className="h-2.5 w-2.5 mr-0.5" /> ERROR
            </Badge>
          ) : (
            <Badge className="text-[8px] bg-muted/20 text-muted-foreground border-muted/40 px-1.5 py-0">
              <RefreshCw className="h-2.5 w-2.5 mr-0.5 animate-spin" /> Connecting...
            </Badge>
          )}
          <span className="text-[8px] text-muted-foreground">
            {mode === 'demo' && 'Using Kite demo data — set KITE_API_KEY + KITE_ACCESS_TOKEN in .env for live'}
            {mode === 'live' && `Real Kite data — ${curr?.symbols.length ?? 0} symbols`}
            {mode === 'loading' && 'Waiting for first snapshot...'}
            {mode === 'error' && 'Snapshot error — check Kite credentials'}
          </span>
          <span className="text-[8px] text-muted-foreground font-mono">
            ({optionsBars.length} bars)
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1 text-[8px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings2 className="h-3 w-3" /> Chart Settings
        </button>
      </div>

      {/* ═══ CHART SETTINGS PANEL ═══ */}
      {showSettings && (
        <Card className="border-border/40 bg-card/90 backdrop-blur-sm">
          <CardHeader className="pb-1 pt-2">
            <CardTitle className="flex items-center gap-1.5 text-xs">
              <Settings2 className="h-3.5 w-3.5 text-purple-400" />
              Price & Score Chart Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-[9px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Price Chart Height (px)</span>
                <input type="range" min="80" max="250" step="10"
                  value={chartSettings.priceHeight}
                  onChange={e => setChartSettings(s => ({ ...s, priceHeight: +e.target.value }))}
                  className="h-1 accent-emerald-500"
                />
                <span className="font-mono">{chartSettings.priceHeight}px</span>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Price Line Width</span>
                <input type="range" min="0.5" max="3" step="0.1"
                  value={chartSettings.priceLineWidth}
                  onChange={e => setChartSettings(s => ({ ...s, priceLineWidth: +e.target.value }))}
                  className="h-1 accent-emerald-500"
                />
                <span className="font-mono">{chartSettings.priceLineWidth}px</span>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Score Line Width</span>
                <input type="range" min="0.5" max="3" step="0.1"
                  value={chartSettings.scoreLineWidth}
                  onChange={e => setChartSettings(s => ({ ...s, scoreLineWidth: +e.target.value }))}
                  className="h-1 accent-amber-500"
                />
                <span className="font-mono">{chartSettings.scoreLineWidth}px</span>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Visible Bars</span>
                <input type="range" min="60" max="300" step="20"
                  value={chartSettings.visibleBars}
                  onChange={e => setChartSettings(s => ({ ...s, visibleBars: +e.target.value }))}
                  className="h-1 accent-purple-500"
                />
                <span className="font-mono">{chartSettings.visibleBars}</span>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Bar Row Height (px)</span>
                <input type="range" min="40" max="120" step="8"
                  value={chartSettings.barHeight}
                  onChange={e => setChartSettings(s => ({ ...s, barHeight: +e.target.value }))}
                  className="h-1 accent-blue-500"
                />
                <span className="font-mono">{chartSettings.barHeight}px</span>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Price Line Color</span>
                <input type="color"
                  value={chartSettings.priceColor}
                  onChange={e => setChartSettings(s => ({ ...s, priceColor: e.target.value }))}
                  className="h-5 w-12 cursor-pointer"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Score Line Color</span>
                <input type="color"
                  value={chartSettings.scoreColor}
                  onChange={e => setChartSettings(s => ({ ...s, scoreColor: e.target.value }))}
                  className="h-5 w-12 cursor-pointer"
                />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ROW 1: COMPOSITE SIGNAL CARD
          ═══════════════════════════════════════════════════════════ */}
      {signal && (
        <Card className={`border-2 ${
          signal.action === 'BUY_CALL' ? 'border-emerald-500/60 bg-emerald-500/5' :
          signal.action === 'BUY_PUT' ? 'border-red-500/60 bg-red-500/5' :
          'border-amber-500/40 bg-amber-500/5'
        } backdrop-blur-sm`}>
          <CardContent className="p-2">
            <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <Crosshair className={`h-5 w-5 ${
                  signal.action === 'BUY_CALL' ? 'text-emerald-400' :
                  signal.action === 'BUY_PUT' ? 'text-red-400' : 'text-amber-400'
                }`} />
                <span className="text-lg font-bold font-mono">
                  {signal.action === 'BUY_CALL' ? 'BUY CALL' :
                   signal.action === 'BUY_PUT' ? 'BUY PUT' :
                   signal.action === 'EXIT' ? 'EXIT' : 'WAIT'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Nifty {signal.suggestedStrike.toLocaleString()} @ ₹{signal.suggestedPremium.toFixed(0)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Score</span>
                <div className="w-32 h-3 rounded-full bg-muted overflow-hidden relative">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border z-10" />
                  <div
                    className={`absolute inset-y-0 rounded-full transition-all duration-300 ${
                      signal.score > 0 ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                    style={{
                      left: signal.score > 0 ? '50%' : `${50 + (signal.score / 100) * 50}%`,
                      width: `${Math.abs(signal.score / 100) * 50}%`,
                    }}
                  />
                </div>
                <span className={`text-sm font-mono font-bold ${signal.score > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {signal.score > 0 ? '+' : ''}{signal.score.toFixed(0)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Conf</span>
                <span className={`text-sm font-mono font-bold ${signal.confidence > 60 ? 'text-emerald-400' : signal.confidence > 30 ? 'text-amber-400' : 'text-red-400'}`}>
                  {signal.confidence.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span>SL: ₹{signal.stopLoss.toFixed(0)}</span>
                <span className="text-emerald-400">T1: ₹{signal.target1.toFixed(0)}</span>
                <span className="text-emerald-300">T2: ₹{signal.target2.toFixed(0)}</span>
                <span>RR: {signal.riskReward.toFixed(1)}:1</span>
              </div>
              <div className="flex items-center gap-1">
                {signal.cashOptDivergence && (
                  <Badge variant="outline" className="text-[8px] border-amber-500/40 text-amber-300 px-1 py-0">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Opt Div
                  </Badge>
                )}
                {signal.futCashDivergence && (
                  <Badge variant="outline" className="text-[8px] border-orange-500/40 text-orange-300 px-1 py-0">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Fut Div
                  </Badge>
                )}
              </div>
              <div className="text-[9px] text-muted-foreground max-w-xs truncate">
                {signal.reasoning}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ROW 2a: NIFTY50 PRICE + SCORE LINE
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-2 border-emerald-500/30 bg-card/90 backdrop-blur-sm shadow-lg shadow-emerald-500/5">
        <CardHeader className="pb-1 pt-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Nifty 50 Price + Score
            <span className="text-[9px] text-muted-foreground font-normal">│ real-time from Kite │ OI diff flow</span>
            {niftyPrice > 0 && (
              <>
                <span className={`font-mono font-bold ${niftyPrice >= openPrice ? 'text-emerald-400' : 'text-red-400'}`}>
                  {niftyPrice.toFixed(0)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Chg: {(niftyPrice - openPrice).toFixed(0)} ({((niftyPrice - openPrice) / openPrice * 100).toFixed(2)}%)
                </span>
              </>
            )}
            {signal && (
              <span className={`ml-1 font-bold px-1.5 py-0 rounded text-[9px] ${
                signal.action === 'BUY_CALL' ? 'bg-emerald-500/20 text-emerald-300' :
                signal.action === 'BUY_PUT' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {signal.action === 'BUY_CALL' ? '▲ BUY CALL' : signal.action === 'BUY_PUT' ? '▼ BUY PUT' : '— WAIT'}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: niftyPrice >= openPrice ? chartSettings.priceColor : C.priceDn }} />Price</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: chartSettings.scoreColor }} />Score</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C.callBuy }} />Call</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C.putBuy }} />Put</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <div className="relative border-2 border-border/60 rounded-md bg-[#0c0f1a]/90" style={{ height: chartSettings.priceHeight }}>
            {/* Left Y-axis: Price scale */}
            <div className="absolute left-0 top-0 bottom-0 w-14 border-r border-border/30 z-10 flex flex-col justify-between py-1 px-1">
              <span className="text-[9px] font-mono text-emerald-400/80">{priceMax.toFixed(0)}</span>
              <span className="text-[9px] font-mono text-muted-foreground">{(priceMax - priceRange * 0.25).toFixed(0)}</span>
              <span className="text-[9px] font-mono text-muted-foreground">{((priceMax + priceMin) / 2).toFixed(0)}</span>
              <span className="text-[9px] font-mono text-muted-foreground">{(priceMin + priceRange * 0.25).toFixed(0)}</span>
              <span className="text-[9px] font-mono text-red-400/80">{priceMin.toFixed(0)}</span>
            </div>

            {/* Right Y-axis: Score scale */}
            <div className="absolute right-0 top-0 bottom-0 w-12 border-l border-border/30 z-10 flex flex-col justify-between py-1 px-1 text-right">
              <span className="text-[9px] font-mono text-amber-400/70">+{scoreMax.toFixed(0)}</span>
              <span className="text-[9px] font-mono text-amber-400/40">+{(scoreMax * 0.5).toFixed(0)}</span>
              <span className="text-[9px] font-mono text-muted-foreground">0</span>
              <span className="text-[9px] font-mono text-amber-400/40">{(scoreMin * 0.5).toFixed(0)}</span>
              <span className="text-[9px] font-mono text-amber-400/70">{scoreMin.toFixed(0)}</span>
            </div>

            {/* SVG chart area */}
            <svg
              className="absolute left-14 right-12 top-0 bottom-0"
              viewBox={`0 0 ${Math.max(1, visPrices.length) * BAR_WIDTH} ${chartSettings.priceHeight}`}
              preserveAspectRatio="none"
            >
              {/* Horizontal grid lines */}
              {[0.2, 0.4, 0.5, 0.6, 0.8].map(frac => (
                <line key={frac}
                  x1="0" y1={chartSettings.priceHeight * frac}
                  x2={Math.max(1, visPrices.length) * BAR_WIDTH} y2={chartSettings.priceHeight * frac}
                  stroke={frac === 0.5 ? '#1e293b' : '#111827'} strokeWidth={frac === 0.5 ? '0.5' : '0.3'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {/* Score zero line */}
              <line
                x1="0" y1={chartSettings.priceHeight * (1 - (0 - scoreMin) / scoreRange)}
                x2={Math.max(1, visPrices.length) * BAR_WIDTH} y2={chartSettings.priceHeight * (1 - (0 - scoreMin) / scoreRange)}
                stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3"
                vectorEffect="non-scaling-stroke"
              />

              {/* Score area fill */}
              {visScores.length > 1 && (
                <path
                  d={visScores.map((s, i) => {
                    const x = i * BAR_WIDTH;
                    const y = chartSettings.priceHeight * (1 - (s - scoreMin) / scoreRange);
                    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
                  }).join(' ') + ` L${(visScores.length - 1) * BAR_WIDTH},${chartSettings.priceHeight * (1 - (0 - scoreMin) / scoreRange)} L0,${chartSettings.priceHeight * (1 - (0 - scoreMin) / scoreRange)} Z`}
                  fill={signal && signal.score > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'}
                />
              )}

              {/* Score line */}
              {visScores.length > 1 && (
                <polyline
                  fill="none"
                  stroke={chartSettings.scoreColor}
                  strokeWidth={chartSettings.scoreLineWidth}
                  strokeOpacity="0.65"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  points={visScores.map((s, i) => {
                    const x = i * BAR_WIDTH;
                    const y = chartSettings.priceHeight * (1 - (s - scoreMin) / scoreRange);
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {/* Nifty price line */}
              {visPrices.length > 1 && (
                <polyline
                  fill="none"
                  stroke={niftyPrice >= openPrice ? chartSettings.priceColor : C.priceDn}
                  strokeWidth={chartSettings.priceLineWidth}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  points={visPrices.map((p, i) => {
                    const x = i * BAR_WIDTH;
                    const y = chartSettings.priceHeight * (1 - (p - priceMin) / priceRange);
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {/* Signal markers */}
              {visScores.map((s, i) => {
                if (Math.abs(s) < 35) return null;
                if (i >= visPrices.length) return null;
                const x = i * BAR_WIDTH;
                const y = chartSettings.priceHeight * (1 - (visPrices[i] - priceMin) / priceRange);
                if (s > 35) return <circle key={i} cx={x} cy={y - 3} r={1.2} fill={C.callBuy} vectorEffect="non-scaling-stroke" />;
                if (s < -35) return <circle key={i} cx={x} cy={y + 3} r={1.2} fill={C.putBuy} vectorEffect="non-scaling-stroke" />;
                return null;
              })}
            </svg>

            {/* Mode indicator */}
            <div className="absolute top-1.5 right-14 z-20">
              <Badge className={`text-[7px] px-1 py-0 ${mode === 'live' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>
                {mode === 'live' ? 'LIVE' : mode.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Time axis */}
          <div className="flex justify-between px-14 mt-1 text-[8px] font-mono text-muted-foreground">
            {visOpt.length > 0 ? (
              <>
                <span>{visOpt[0]?.timestamp || ''}</span>
                <span>{visOpt[Math.floor(visOpt.length / 4)]?.timestamp || ''}</span>
                <span>{visOpt[Math.floor(visOpt.length / 2)]?.timestamp || ''}</span>
                <span>{visOpt[Math.floor(visOpt.length * 3 / 4)]?.timestamp || ''}</span>
                <span>{visOpt[visOpt.length - 1]?.timestamp || ''}</span>
              </>
            ) : (
              <span className="mx-auto">Waiting for data... (need 2 snapshots to compute flow)</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════
          ROW 2b: FLOW CHARTS — Options | Futures
          (Cash flow removed — Kite doesn't provide per-stock money in/out)
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-1 pt-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Layers className="h-3.5 w-3.5 text-purple-400" />
            OI Flow Bars — Options | Futures
            <span className="text-muted-foreground font-normal">| Real OI diffs | {visBars} bars</span>
            <div className="ml-auto flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.callBuy }} />CB</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.putWrite }} />PW</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.putBuy }} />PB</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.callWrite }} />CW</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.futBuy }} />FutBuy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.futSell }} />FutSell</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5 px-2 pb-2">
          {visOpt.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-[10px] text-muted-foreground">
              <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
              Waiting for 2 consecutive Kite snapshots to compute OI flow...
            </div>
          ) : (
            <>
              {/* ── IDX OPTIONS FLOW (4-color) ── */}
              <FlowChartRow
                label="IDX OPT"
                labelColor="text-amber-400"
                subtitle="Nifty+Sensex+BN+FN — 4-color OI flow"
                maxAbs={idxOptMax}
                unit="L"
                unitDivisor={100000}
              >
                {visOpt.map((bar, i) => (
                  <FourColorBar key={i}
                    buy1={bar.indexTotalCallBuy} buy2={bar.indexTotalPutWrite}
                    sell1={bar.indexTotalPutBuy} sell2={bar.indexTotalCallWrite}
                    maxAbs={idxOptMax} height={chartSettings.barHeight}
                  />
                ))}
              </FlowChartRow>

              {/* ── STOCK OPTIONS FLOW (4-color) ── */}
              <FlowChartRow
                label="STK OPT"
                labelColor="text-cyan-400"
                subtitle="15 F&O stocks — 4-color OI flow"
                maxAbs={stkOptMax}
                unit="L"
                unitDivisor={100000}
              >
                {visOpt.map((bar, i) => (
                  <FourColorBar key={i}
                    buy1={bar.stockTotalCallBuy} buy2={bar.stockTotalPutWrite}
                    sell1={bar.stockTotalPutBuy} sell2={bar.stockTotalCallWrite}
                    maxAbs={stkOptMax} height={chartSettings.barHeight}
                  />
                ))}
              </FlowChartRow>

              {/* ── INDEX FUTURES FLOW ── */}
              <FlowChartRow
                label="IDX FUT"
                labelColor="text-indigo-400"
                subtitle="Nifty+Sensex+BN+FN futures OI flow"
                maxAbs={idxFutMax}
                unit="Cr"
                unitDivisor={CROR}
              >
                {visFut.map((bar, i) => {
                  const buyH = Math.max(0.5, (bar.indexFutBuy / idxFutMax) * (CHART_H * 0.4));
                  const sellH = Math.max(0.5, (bar.indexFutSell / idxFutMax) * (CHART_H * 0.4));
                  return (
                    <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                      <div className="w-full flex-1 flex items-end">
                        <div className="w-full" style={{ height: buyH, background: C.futBuy }}
                          title={`Idx Fut Buy: ₹${(bar.indexFutBuy / CROR).toFixed(1)} Cr`}
                        />
                      </div>
                      <div className="w-full flex-1">
                        <div className="w-full" style={{ height: sellH, background: C.futSell }}
                          title={`Idx Fut Sell: ₹${(bar.indexFutSell / CROR).toFixed(1)} Cr`}
                        />
                      </div>
                    </div>
                  );
                })}
              </FlowChartRow>

              {/* ── STOCK FUTURES FLOW ── */}
              <FlowChartRow
                label="STK FUT"
                labelColor="text-pink-400"
                subtitle="15 F&O stock futures OI flow"
                maxAbs={stkFutMax}
                unit="Cr"
                unitDivisor={CROR}
              >
                {visFut.map((bar, i) => {
                  const buyH = Math.max(0.5, (bar.stockFutBuy / stkFutMax) * (CHART_H * 0.4));
                  const sellH = Math.max(0.5, (bar.stockFutSell / stkFutMax) * (CHART_H * 0.4));
                  return (
                    <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                      <div className="w-full flex-1 flex items-end">
                        <div className="w-full" style={{ height: buyH, background: C.futBuy }}
                          title={`Stk Fut Buy: ₹${(bar.stockFutBuy / CROR).toFixed(1)} Cr`}
                        />
                      </div>
                      <div className="w-full flex-1">
                        <div className="w-full" style={{ height: sellH, background: C.futSell }}
                          title={`Stk Fut Sell: ₹${(bar.stockFutSell / CROR).toFixed(1)} Cr`}
                        />
                      </div>
                    </div>
                  );
                })}
              </FlowChartRow>

              {/* Timestamp + summary */}
              {latestOpt && (
                <div className="flex items-center justify-between text-[8px] font-mono text-muted-foreground mt-0.5">
                  <span>{latestOpt.timestamp} | {optionsBars.length} bars</span>
                  <span>
                    Idx Opt: {totalIdxOptNet >= 0 ? '+' : ''}{(totalIdxOptNet / 100000).toFixed(1)}L |
                    Stk Opt: {totalStkOptNet >= 0 ? '+' : ''}{(totalStkOptNet / 100000).toFixed(1)}L |
                    Idx Fut: {totalIdxFutNet >= 0 ? '+' : ''}{(totalIdxFutNet / CROR).toFixed(1)}Cr |
                    Stk Fut: {totalStkFutNet >= 0 ? '+' : ''}{(totalStkFutNet / CROR).toFixed(1)}Cr
                  </span>
                  <span>Score: {signal?.score.toFixed(0) || '...'} | {signal?.action || '...'}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════
          ROW 3: COMPONENT SCORE BREAKDOWN + FUTURES BREAKDOWN
          ═══════════════════════════════════════════════════════════ */}
      {signal && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Score Breakdown */}
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="pb-1 pt-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Crosshair className="h-3.5 w-3.5 text-amber-400" />
                Signal Component Scores
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              <div className="space-y-1.5">
                <ScoreBar label="Price Trend" score={signal.priceTrendScore} />
                <ScoreBar label="Cash Flow" score={signal.cashFlowScore} />
                <ScoreBar label="Idx Options" score={signal.idxOptScore} />
                <ScoreBar label="Stk Options" score={signal.stkOptScore} />
                <ScoreBar label="Idx Futures" score={signal.idxFutScore} />
                <ScoreBar label="Stk Futures" score={signal.stkFutScore} />
                <div className="border-t border-border/30 pt-1">
                  <ScoreBar label="COMPOSITE" score={signal.score} bold />
                </div>
                <div className="text-[7px] text-muted-foreground mt-1">
                  Cash Flow score = 0 (Kite API doesn't provide per-stock money in/out data)
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Futures Breakdown */}
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="pb-1 pt-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5 text-indigo-400" />
                Futures OI Flow (Latest)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {latestFut ? (
                <div className="space-y-1">
                  <div className="text-[9px] font-medium text-indigo-400">Index Futures</div>
                  {latestFut.indexBreakdown.map(idx => (
                    <div key={idx.symbol} className="flex items-center justify-between text-[10px] font-mono">
                      <span className="w-20">{idx.symbol}</span>
                      <span className={`flex-1 text-right ${idx.futNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {idx.futNet > 0 ? '+' : ''}{(idx.futNet / CROR).toFixed(1)} Cr
                      </span>
                      <span className={`w-16 text-right ${idx.basis > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        B:{idx.basis > 0 ? '+' : ''}{idx.basis.toFixed(1)}
                      </span>
                      <span className={`w-16 text-right ${idx.oiChg > 0 ? 'text-blue-400/70' : 'text-orange-400/70'}`}>
                        OI:{idx.oiChg > 0 ? '+' : ''}{(idx.oiChg / 1000).toFixed(0)}K
                      </span>
                    </div>
                  ))}
                  <div className="text-[9px] font-medium text-pink-400 mt-1">Stock Futures (15 stocks)</div>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="w-20">Combined</span>
                    <span className={`flex-1 text-right ${latestFut.stockFutNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {latestFut.stockFutNet > 0 ? '+' : ''}{(latestFut.stockFutNet / CROR).toFixed(1)} Cr
                    </span>
                    <span className={`w-16 text-right ${latestFut.stockFutBasis > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                      B:{latestFut.stockFutBasis > 0 ? '+' : ''}{latestFut.stockFutBasis.toFixed(1)}
                    </span>
                    <span className={`w-16 text-right ${latestFut.stockFutOI > 0 ? 'text-blue-400/70' : 'text-orange-400/70'}`}>
                      OI:{latestFut.stockFutOI > 0 ? '+' : ''}{(latestFut.stockFutOI / 1000).toFixed(0)}K
                    </span>
                  </div>
                  <div className="text-[8px] text-muted-foreground mt-1">
                    Basis = Future - Spot | OI Chg = Open Interest change (build-up vs unwinding)
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">Waiting for futures data...</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ROW 4: TRADING TIPS
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-border/30 bg-card/50">
        <CardContent className="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            OI Flow Trading Framework
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-[9px] text-muted-foreground">
            <div>
              <span className="text-emerald-400 font-medium">1. 4-Color OI Engine:</span> Each bar = diff of 2 Kite snapshots (15s). CE Buy (dOI up + dP &ge; 0) and PE Write (dOI up + dP &gt; 0) are bullish. PE Buy and CE Write are bearish. OI decrease uses 0.3x factor (unwinding).
            </div>
            <div>
              <span className="text-red-400 font-medium">2. Divergence = Trap:</span> If Options showing Call Buy + Put Write (bullish) but price falling, smart money is writing options against the trend. The divergence badge catches this automatically.
            </div>
            <div>
              <span className="text-amber-400 font-medium">3. Futures Confirmation:</span> Futures are leveraged — institutions don&apos;t take futures positions casually. If Index Futures net LONG + Options bullish = high probability trade.
            </div>
            <div>
              <span className="text-blue-400 font-medium">4. Basis Signal:</span> Contango (positive basis) = bullish sentiment. Backwardation (negative basis) = bearish urgency. If basis flips while options still bullish &rarr; smart money is exiting.
            </div>
            <div>
              <span className="text-cyan-400 font-medium">5. OI Build-Up:</span> Rising OI + rising price = long build-up (bullish). Rising OI + falling price = short build-up (bearish). Falling OI = unwinding — move is ending.
            </div>
            <div>
              <span className="text-purple-400 font-medium">6. Data Source:</span> All data from Zerodha Kite API (real or demo). Cash flow not available from Kite — signal uses Price + Options OI + Futures OI only.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS (unchanged visual rendering)
// ═══════════════════════════════════════════════════════════

// Reusable flow chart row with label
function FlowChartRow({
  label, labelColor, subtitle, maxAbs, unit, unitDivisor, children,
}: {
  label: string;
  labelColor: string;
  subtitle: string;
  maxAbs: number;
  unit: string;
  unitDivisor: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[8px] mb-0.5">
        <span className={`font-bold ${labelColor}`}>{label}</span>
        <span className="text-muted-foreground">{subtitle}</span>
        <span className="ml-auto text-muted-foreground">±{(maxAbs / unitDivisor).toFixed(1)} {unit}</span>
      </div>
      <div className="relative border border-border/15 rounded bg-black/20" style={{ height: CHART_H }}>
        <div className="absolute left-0 top-0 bottom-0 w-8 border-r border-border/10 z-10 flex flex-col justify-between py-0.5 px-0.5">
          <span className="text-[6px] font-mono text-emerald-400/70">+</span>
          <span className="text-[6px] font-mono text-muted-foreground">0</span>
          <span className="text-[6px] font-mono text-red-400/70">−</span>
        </div>
        <div className="absolute left-8 right-0 flex items-end gap-px overflow-hidden" style={{ top: 0, bottom: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// 4-color options bar (Call Buy + Put Write up, Put Buy + Call Write down)
function FourColorBar({
  buy1, buy2, sell1, sell2, maxAbs, height,
}: {
  buy1: number; buy2: number; sell1: number; sell2: number;
  maxAbs: number; height: number;
}) {
  const b1H = Math.max(0.5, (buy1 / maxAbs) * (height * 0.25));
  const b2H = Math.max(0.5, (buy2 / maxAbs) * (height * 0.25));
  const s1H = Math.max(0.5, (sell1 / maxAbs) * (height * 0.25));
  const s2H = Math.max(0.5, (sell2 / maxAbs) * (height * 0.25));

  return (
    <div className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
      {/* Bullish (up) */}
      <div className="w-full flex-1 flex flex-col items-end justify-end">
        <div className="w-full rounded-t-sm" style={{ height: b1H, background: C.callBuy }} />
        <div className="w-full" style={{ height: b2H, background: C.putWrite }} />
      </div>
      {/* Bearish (down) */}
      <div className="w-full flex-1 flex flex-col items-start">
        <div className="w-full" style={{ height: s1H, background: C.putBuy }} />
        <div className="w-full rounded-b-sm" style={{ height: s2H, background: C.callWrite }} />
      </div>
    </div>
  );
}

// Score bar component
function ScoreBar({ label, score, bold = false }: { label: string; score: number; bold?: boolean }) {
  const isPos = score > 0;
  const pct = Math.abs(score) / 100 * 50;

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-16 text-right text-[9px] ${bold ? 'font-bold' : ''}`}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden relative">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border z-10" />
        <div
          className={`absolute inset-y-0 rounded-full ${isPos ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{
            left: isPos ? '50%' : `${50 - pct}%`,
            width: `${pct}%`,
          }}
        />
      </div>
      <span className={`w-8 text-[9px] font-mono ${isPos ? 'text-emerald-400' : 'text-red-400'} ${bold ? 'font-bold' : ''}`}>
        {isPos ? '+' : ''}{score.toFixed(0)}
      </span>
    </div>
  );
}
