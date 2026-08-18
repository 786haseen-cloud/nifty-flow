'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, Activity, Layers, Zap, Crosshair,
  TrendingUp, TrendingDown, ShieldAlert, AlertTriangle,
} from 'lucide-react';
import type { WeightedCashFlowBar, CashFlowTrend, OptionsFlowBar, FuturesFlowBar, CompositeSignal } from '@/lib/types';
import {
  generateDemoWeightedBars, computeCashFlowTrend,
  generateDemoOptionsFlowBar, generateDemoOptionsFlowBars,
  generateDemoFuturesFlowBar, generateDemoFuturesFlowBars,
  computeCompositeSignal,
} from '@/lib/demo-data';

// Chart dimensions — compact for single-screen
const VISIBLE_BARS = 160;
const BAR_WIDTH = 2;
const CHART_H = 72;      // Each flow chart row height (compact)
const PRICE_H = 120;     // Price chart height — own dedicated frame

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

export default function OptionsFlowTab() {
  // Cash flow data
  const [cashBars, setCashBars] = useState<WeightedCashFlowBar[]>([]);
  const [cashTrend, setCashTrend] = useState<CashFlowTrend | null>(null);

  // Options flow data
  const [optionsBars, setOptionsBars] = useState<OptionsFlowBar[]>([]);

  // Futures flow data
  const [futBars, setFutBars] = useState<FuturesFlowBar[]>([]);

  // Nifty price simulation (random walk)
  const [niftyPrices, setNiftyPrices] = useState<number[]>([]);
  const [niftyPrice, setNiftyPrice] = useState(24350);

  // Score history for the score line
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);

  // Composite signal
  const [signal, setSignal] = useState<CompositeSignal | null>(null);

  // Initialize + refresh every 15 seconds
  useEffect(() => {
    const initCashBars = generateDemoWeightedBars(60);
    setCashBars(initCashBars);
    setCashTrend(computeCashFlowTrend(initCashBars));
    setOptionsBars(generateDemoOptionsFlowBars(60));
    setFutBars(generateDemoFuturesFlowBars(60));

    // Initialize price walk
    const initPrices: number[] = [];
    let p = 24350;
    for (let i = 0; i < 60; i++) {
      p += (Math.random() - 0.48) * 3;
      initPrices.push(p);
    }
    setNiftyPrices(initPrices);
    setNiftyPrice(initPrices[initPrices.length - 1]);

    // Initial score
    setScoreHistory(Array.from({ length: 60 }, () => (Math.random() - 0.45) * 60));

    const interval = setInterval(() => {
      // Cash
      setCashBars(prev => {
        const newBar = generateDemoWeightedBars(1)[0];
        const updated = [...prev, newBar];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Options
      setOptionsBars(prev => {
        const newBar = generateDemoOptionsFlowBar();
        const updated = [...prev, newBar];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Futures
      setFutBars(prev => {
        const newBar = generateDemoFuturesFlowBar();
        const updated = [...prev, newBar];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Price walk
      setNiftyPrice(prev => {
        const next = prev + (Math.random() - 0.48) * 3;
        setNiftyPrices(pp => {
          const updated = [...pp, next];
          return updated.length > 500 ? updated.slice(-500) : updated;
        });
        return next;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Recalculate cash trend and composite signal when data changes
  useEffect(() => {
    if (cashBars.length > 14) {
      setCashTrend(computeCashFlowTrend(cashBars));
    }
  }, [cashBars]);

  // Compute composite signal from latest data
  useEffect(() => {
    const latestCash = cashBars[cashBars.length - 1];
    const latestOpt = optionsBars[optionsBars.length - 1];
    const latestFut = futBars[futBars.length - 1];

    if (latestCash && latestOpt && latestFut) {
      const priceTrend = niftyPrice - 24350; // Simple: distance from open
      const sig = computeCompositeSignal(
        latestCash.netFlow,
        latestOpt.indexNetFlow,
        latestOpt.stockNetFlow,
        latestFut.indexFutNet,
        latestFut.stockFutNet,
        priceTrend,
      );
      setSignal(sig);
      setScoreHistory(prev => {
        const updated = [...prev, sig.score];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
    }
  }, [cashBars, optionsBars, futBars, niftyPrice]);

  // Visible slices
  const visCash = cashBars.slice(-VISIBLE_BARS);
  const visOpt = optionsBars.slice(-VISIBLE_BARS);
  const visFut = futBars.slice(-VISIBLE_BARS);
  const visPrices = niftyPrices.slice(-VISIBLE_BARS);
  const visScores = scoreHistory.slice(-VISIBLE_BARS);
  const latestOpt = visOpt[visOpt.length - 1];
  const latestFut = visFut[visFut.length - 1];

  // Scale calculations
  const cashMaxAbs = Math.max(1, ...visCash.map(b => Math.max(Math.abs(b.totalMoneyIn), Math.abs(b.totalMoneyOut), Math.abs(b.netFlow))));
  const idxOptMax = Math.max(1, ...visOpt.map(b => Math.max(b.indexBullishFlow, b.indexBearishFlow)));
  const stkOptMax = Math.max(1, ...visOpt.map(b => Math.max(b.stockBullishFlow, b.stockBearishFlow)));
  const idxFutMax = Math.max(1, ...visFut.map(b => Math.max(Math.abs(b.indexFutBuy), Math.abs(b.indexFutSell))));
  const stkFutMax = Math.max(1, ...visFut.map(b => Math.max(Math.abs(b.stockFutBuy), Math.abs(b.stockFutSell))));

  const priceMin = Math.min(...visPrices);
  const priceMax = Math.max(...visPrices);
  const priceRange = Math.max(1, priceMax - priceMin);

  // Summary totals
  const totalCashNet = visCash.reduce((s, b) => s + b.netFlow, 0);
  const totalIdxOptNet = visOpt.reduce((s, b) => s + b.indexNetFlow, 0);
  const totalStkOptNet = visOpt.reduce((s, b) => s + b.stockNetFlow, 0);
  const totalIdxFutNet = visFut.reduce((s, b) => s + b.indexFutNet, 0);
  const totalStkFutNet = visFut.reduce((s, b) => s + b.stockFutNet, 0);

  // Score line SVG path
  const scoreMin = Math.min(-50, ...visScores);
  const scoreMax = Math.max(50, ...visScores);
  const scoreRange = Math.max(1, scoreMax - scoreMin);

  return (
    <div className="space-y-2">
      {/* ═══════════════════════════════════════════════════════════
          ROW 1: COMPOSITE SIGNAL CARD — The actionable trade signal
          ═══════════════════════════════════════════════════════════ */}
      {signal && (
        <Card className={`border-2 ${
          signal.action === 'BUY_CALL' ? 'border-emerald-500/60 bg-emerald-500/5' :
          signal.action === 'BUY_PUT' ? 'border-red-500/60 bg-red-500/5' :
          'border-amber-500/40 bg-amber-500/5'
        } backdrop-blur-sm`}>
          <CardContent className="p-2">
            <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
              {/* Action badge */}
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

              {/* Score */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Score</span>
                <div className="w-32 h-3 rounded-full bg-muted overflow-hidden relative">
                  {/* Center line */}
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

              {/* Confidence */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Conf</span>
                <span className={`text-sm font-mono font-bold ${signal.confidence > 60 ? 'text-emerald-400' : signal.confidence > 30 ? 'text-amber-400' : 'text-red-400'}`}>
                  {signal.confidence.toFixed(0)}%
                </span>
              </div>

              {/* Trade details */}
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span>SL: ₹{signal.stopLoss.toFixed(0)}</span>
                <span className="text-emerald-400">T1: ₹{signal.target1.toFixed(0)}</span>
                <span className="text-emerald-300">T2: ₹{signal.target2.toFixed(0)}</span>
                <span>RR: {signal.riskReward.toFixed(1)}:1</span>
              </div>

              {/* Divergence alerts */}
              <div className="flex items-center gap-1">
                {signal.cashOptDivergence && (
                  <Badge variant="outline" className="text-[8px] border-amber-500/40 text-amber-300 px-1 py-0">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Cash-Opt Div
                  </Badge>
                )}
                {signal.futCashDivergence && (
                  <Badge variant="outline" className="text-[8px] border-orange-500/40 text-orange-300 px-1 py-0">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Fut-Cash Div
                  </Badge>
                )}
              </div>

              {/* Reasoning */}
              <div className="text-[9px] text-muted-foreground max-w-xs truncate">
                {signal.reasoning}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ROW 2a: NIFTY50 PRICE + SCORE LINE — OWN DEDICATED FRAME
          Time axis + Price axis + Signal markers
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-1 pt-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Nifty 50 Price + Composite Score
            <span className={`font-mono font-bold ${niftyPrice >= 24350 ? 'text-emerald-400' : 'text-red-400'}`}>
              {niftyPrice.toFixed(0)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Chg: {(niftyPrice - 24350).toFixed(0)} ({((niftyPrice - 24350) / 24350 * 100).toFixed(2)}%)
            </span>
            {signal && (
              <span className={`ml-1 font-bold px-1.5 py-0 rounded text-[9px] ${
                signal.action === 'BUY_CALL' ? 'bg-emerald-500/20 text-emerald-300' :
                signal.action === 'BUY_PUT' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {signal.action === 'BUY_CALL' ? '▲ BUY CALL' : signal.action === 'BUY_PUT' ? '▼ BUY PUT' : '— WAIT'}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: niftyPrice >= 24350 ? C.priceUp : C.priceDn }} />Price</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: C.score }} />Score</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C.callBuy }} />Call</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C.putBuy }} />Put</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <div className="relative border border-border/30 rounded bg-black/30" style={{ height: PRICE_H }}>
            {/* Left Y-axis: Price scale */}
            <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-border/20 z-10 flex flex-col justify-between py-1 px-0.5">
              <span className="text-[8px] font-mono text-muted-foreground">{priceMax.toFixed(0)}</span>
              <span className="text-[8px] font-mono text-muted-foreground">{((priceMax + priceMin) / 2).toFixed(0)}</span>
              <span className="text-[8px] font-mono text-muted-foreground">{priceMin.toFixed(0)}</span>
            </div>

            {/* Right Y-axis: Score scale */}
            <div className="absolute right-0 top-0 bottom-0 w-10 border-l border-border/20 z-10 flex flex-col justify-between py-1 px-0.5">
              <span className="text-[8px] font-mono text-amber-400/60">+{scoreMax.toFixed(0)}</span>
              <span className="text-[8px] font-mono text-muted-foreground">0</span>
              <span className="text-[8px] font-mono text-amber-400/60">{scoreMin.toFixed(0)}</span>
            </div>

            {/* SVG chart area */}
            <svg
              className="absolute left-12 right-10 top-0 bottom-0"
              viewBox={`0 0 ${visPrices.length * BAR_WIDTH} ${PRICE_H}`}
              preserveAspectRatio="none"
            >
              {/* Horizontal grid lines */}
              {[0.25, 0.5, 0.75].map(frac => (
                <line key={frac}
                  x1="0" y1={PRICE_H * frac}
                  x2={visPrices.length * BAR_WIDTH} y2={PRICE_H * frac}
                  stroke="#1e293b" strokeWidth="0.3"
                />
              ))}

              {/* Score zero line (center) */}
              <line
                x1="0" y1={PRICE_H * (1 - (0 - scoreMin) / scoreRange)}
                x2={visPrices.length * BAR_WIDTH} y2={PRICE_H * (1 - (0 - scoreMin) / scoreRange)}
                stroke="#334155" strokeWidth="0.3" strokeDasharray="2,2"
              />

              {/* Score area (subtle fill) */}
              {visScores.length > 1 && (
                <path
                  d={visScores.map((s, i) => {
                    const x = i * BAR_WIDTH;
                    const y = PRICE_H * (1 - (s - scoreMin) / scoreRange);
                    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
                  }).join(' ') + ` L${(visScores.length - 1) * BAR_WIDTH},${PRICE_H * (1 - (0 - scoreMin) / scoreRange)} L0,${PRICE_H * (1 - (0 - scoreMin) / scoreRange)} Z`}
                  fill={signal && signal.score > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'}
                />
              )}

              {/* Score line (thin amber) */}
              {visScores.length > 1 && (
                <polyline
                  fill="none"
                  stroke={C.score}
                  strokeWidth="0.6"
                  strokeOpacity="0.7"
                  points={visScores.map((s, i) => {
                    const x = i * BAR_WIDTH;
                    const y = PRICE_H * (1 - (s - scoreMin) / scoreRange);
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {/* Nifty price line (thin, crisp) */}
              {visPrices.length > 1 && (
                <polyline
                  fill="none"
                  stroke={niftyPrice >= 24350 ? C.priceUp : C.priceDn}
                  strokeWidth="0.8"
                  strokeLinejoin="round"
                  points={visPrices.map((p, i) => {
                    const x = i * BAR_WIDTH;
                    const y = PRICE_H * (1 - (p - priceMin) / priceRange);
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {/* Signal markers — small dots, not big triangles */}
              {visScores.map((s, i) => {
                if (Math.abs(s) < 35) return null;
                const x = i * BAR_WIDTH;
                const y = PRICE_H * (1 - (visPrices[i] - priceMin) / priceRange);
                const r = Math.abs(s) > 60 ? 2 : 1.5;
                if (s > 35) return <circle key={i} cx={x} cy={y - 4} r={r} fill={C.callBuy} />;
                if (s < -35) return <circle key={i} cx={x} cy={y + 4} r={r} fill={C.putBuy} />;
                return null;
              })}
            </svg>

            {/* Live indicator */}
            <div className="absolute top-1 right-12 z-20">
              <Badge className="text-[7px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30 px-1 py-0 animate-pulse">LIVE</Badge>
            </div>
          </div>

          {/* Time axis below price chart */}
          <div className="flex justify-between px-12 mt-0.5 text-[7px] font-mono text-muted-foreground">
            {visCash.length > 0 && <>
              <span>{visCash[0]?.timestamp || ''}</span>
              <span>{visCash[Math.floor(visCash.length / 4)]?.timestamp || ''}</span>
              <span>{visCash[Math.floor(visCash.length / 2)]?.timestamp || ''}</span>
              <span>{visCash[Math.floor(visCash.length * 3 / 4)]?.timestamp || ''}</span>
              <span>{visCash[visCash.length - 1]?.timestamp || ''}</span>
            </>}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════
          ROW 2b: FLOW CHARTS — Cash | Options | Futures
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-1 pt-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Layers className="h-3.5 w-3.5 text-purple-400" />
            Money Flow Bars — Cash | Options | Futures
            <span className="text-muted-foreground font-normal">| Every 15s | {VISIBLE_BARS} bars visible</span>
            {/* Mini legend */}
            <div className="ml-auto flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm bg-emerald-500/50" />Buy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm bg-red-500/50" />Sell</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm bg-blue-500" />Net</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.callBuy }} />CB</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.putWrite }} />PW</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.putBuy }} />PB</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.callWrite }} />CW</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.futBuy }} />FutBuy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: C.futSell }} />FutSell</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-0.5" style={{ background: C.score }} />Score</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5 px-2 pb-2">

          {/* ── LAYER 2: CASH FLOW BARS (Green=Buy, Red=Sell, Blue=Net) ── */}
          <FlowChartRow
            label="CASH"
            labelColor="text-emerald-400"
            subtitle="Green=Buy | Red=Sell | Blue=Net | NSE+BSE"
            maxAbs={cashMaxAbs}
            unit="Cr"
            unitDivisor={10000000}
          >
            {visCash.map((bar, i) => {
              const inH = Math.max(0.5, (bar.totalMoneyIn / cashMaxAbs) * (CHART_H * 0.3));
              const outH = Math.max(0.5, (bar.totalMoneyOut / cashMaxAbs) * (CHART_H * 0.3));
              const netH = Math.max(0.5, (Math.abs(bar.netFlow) / cashMaxAbs) * (CHART_H * 0.45));
              const netPos = bar.netFlow >= 0;
              return (
                <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                  {/* Buy pressure (green) — above center */}
                  <div className="w-full flex-1 flex flex-col items-end justify-end">
                    <div className="w-full bg-emerald-500/50" style={{ height: inH }}
                      title={`Buy: +${(bar.totalMoneyIn / 10000000).toFixed(2)} Cr`}
                    />
                  </div>
                  {/* Net flow (blue) — dominant bar showing direction */}
                  <div className="w-full flex justify-center" style={{ height: CHART_H * 0.08 }}>
                    <div
                      className={`w-full rounded-sm ${netPos ? 'bg-blue-500' : 'bg-blue-600'}`}
                      style={{ height: Math.min(netH, CHART_H * 0.45) }}
                      title={`Net: ${netPos ? '+' : ''}${(bar.netFlow / 10000000).toFixed(2)} Cr | Buy: +${(bar.totalMoneyIn / 10000000).toFixed(2)} Cr | Sell: -${(bar.totalMoneyOut / 10000000).toFixed(2)} Cr`}
                    />
                  </div>
                  {/* Sell pressure (red) — below center */}
                  <div className="w-full flex-1 flex flex-col items-start">
                    <div className="w-full bg-red-500/50" style={{ height: outH }}
                      title={`Sell: -${(bar.totalMoneyOut / 10000000).toFixed(2)} Cr`}
                    />
                  </div>
                </div>
              );
            })}
          </FlowChartRow>

          {/* ── LAYER 3: INDEX OPTIONS FLOW (4-color) ── */}
          <FlowChartRow
            label="IDX OPT"
            labelColor="text-amber-400"
            subtitle="4 indexes × 11 strikes"
            maxAbs={idxOptMax}
            unit="L"
            unitDivisor={100000}
          >
            {visOpt.map((bar, i) => (
              <FourColorBar key={i}
                buy1={bar.indexTotalCallBuy} buy2={bar.indexTotalPutWrite}
                sell1={bar.indexTotalPutBuy} sell2={bar.indexTotalCallWrite}
                maxAbs={idxOptMax} height={CHART_H}
              />
            ))}
          </FlowChartRow>

          {/* ── LAYER 4: STOCK OPTIONS FLOW (4-color) ── */}
          <FlowChartRow
            label="STK OPT"
            labelColor="text-cyan-400"
            subtitle="15 stocks × 9 strikes (NSE)"
            maxAbs={stkOptMax}
            unit="L"
            unitDivisor={100000}
          >
            {visOpt.map((bar, i) => (
              <FourColorBar key={i}
                buy1={bar.stockTotalCallBuy} buy2={bar.stockTotalPutWrite}
                sell1={bar.stockTotalPutBuy} sell2={bar.stockTotalCallWrite}
                maxAbs={stkOptMax} height={CHART_H}
              />
            ))}
          </FlowChartRow>

          {/* ── LAYER 5: INDEX FUTURES FLOW ── */}
          <FlowChartRow
            label="IDX FUT"
            labelColor="text-indigo-400"
            subtitle="Nifty+Sensex+BN+FN futures"
            maxAbs={idxFutMax}
            unit="Cr"
            unitDivisor={10000000}
          >
            {visFut.map((bar, i) => {
              const buyH = Math.max(0.5, (bar.indexFutBuy / idxFutMax) * (CHART_H * 0.4));
              const sellH = Math.max(0.5, (bar.indexFutSell / idxFutMax) * (CHART_H * 0.4));
              return (
                <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                  <div className="w-full flex-1 flex items-end">
                    <div className="w-full" style={{ height: buyH, background: C.futBuy }}
                      title={`Idx Fut Buy: ${(bar.indexFutBuy / 10000000).toFixed(1)} Cr`}
                    />
                  </div>
                  <div className="w-full flex-1">
                    <div className="w-full" style={{ height: sellH, background: C.futSell }}
                      title={`Idx Fut Sell: ${(bar.indexFutSell / 10000000).toFixed(1)} Cr`}
                    />
                  </div>
                </div>
              );
            })}
          </FlowChartRow>

          {/* ── LAYER 6: STOCK FUTURES FLOW ── */}
          <FlowChartRow
            label="STK FUT"
            labelColor="text-pink-400"
            subtitle="15 NSE F&O stock futures"
            maxAbs={stkFutMax}
            unit="Cr"
            unitDivisor={10000000}
          >
            {visFut.map((bar, i) => {
              const buyH = Math.max(0.5, (bar.stockFutBuy / stkFutMax) * (CHART_H * 0.4));
              const sellH = Math.max(0.5, (bar.stockFutSell / stkFutMax) * (CHART_H * 0.4));
              return (
                <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                  <div className="w-full flex-1 flex items-end">
                    <div className="w-full" style={{ height: buyH, background: C.futBuy }}
                      title={`Stk Fut Buy: ${(bar.stockFutBuy / 10000000).toFixed(1)} Cr`}
                    />
                  </div>
                  <div className="w-full flex-1">
                    <div className="w-full" style={{ height: sellH, background: C.futSell }}
                      title={`Stk Fut Sell: ${(bar.stockFutSell / 10000000).toFixed(1)} Cr`}
                    />
                  </div>
                </div>
              );
            })}
          </FlowChartRow>

          {/* Timestamp */}
          {latestOpt && (
            <div className="text-right text-[8px] font-mono text-muted-foreground mt-0.5">
              {latestOpt.timestamp} | Score: {signal?.score.toFixed(0) || '...'} | {signal?.action || '...'}
            </div>
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
              </div>
            </CardContent>
          </Card>

          {/* Futures Breakdown */}
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="pb-1 pt-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5 text-indigo-400" />
                Futures Money Flow (Latest)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {latestFut && (
                <div className="space-y-1">
                  {/* Index futures breakdown */}
                  <div className="text-[9px] font-medium text-indigo-400">Index Futures</div>
                  {latestFut.indexBreakdown.map(idx => (
                    <div key={idx.symbol} className="flex items-center justify-between text-[10px] font-mono">
                      <span className="w-20">{idx.symbol}</span>
                      <span className={`flex-1 text-right ${idx.futNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {idx.futNet > 0 ? '+' : ''}{(idx.futNet / 10000000).toFixed(1)} Cr
                      </span>
                      <span className={`w-16 text-right ${idx.basis > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        B:{idx.basis > 0 ? '+' : ''}{idx.basis.toFixed(1)}
                      </span>
                      <span className={`w-16 text-right ${idx.oiChg > 0 ? 'text-blue-400/70' : 'text-orange-400/70'}`}>
                        OI:{idx.oiChg > 0 ? '+' : ''}{(idx.oiChg / 1000).toFixed(0)}K
                      </span>
                    </div>
                  ))}
                  {/* Stock futures aggregate */}
                  <div className="text-[9px] font-medium text-pink-400 mt-1">Stock Futures (NSE, 15 stocks)</div>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="w-20">Combined</span>
                    <span className={`flex-1 text-right ${latestFut.stockFutNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {latestFut.stockFutNet > 0 ? '+' : ''}{(latestFut.stockFutNet / 10000000).toFixed(1)} Cr
                    </span>
                    <span className={`w-16 text-right ${latestFut.stockFutBasis > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                      B:{latestFut.stockFutBasis > 0 ? '+' : ''}{latestFut.stockFutBasis.toFixed(1)}
                    </span>
                    <span className={`w-16 text-right ${latestFut.stockFutOI > 0 ? 'text-blue-400/70' : 'text-orange-400/70'}`}>
                      OI:{latestFut.stockFutOI > 0 ? '+' : ''}{(latestFut.stockFutOI / 1000).toFixed(0)}K
                    </span>
                  </div>
                  <div className="text-[8px] text-muted-foreground mt-1">
                    Basis = Future - Spot (positive = contango, negative = backwardation) |
                    OI Chg = Open Interest change (build-up vs unwinding)
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ROW 4: TRADING TIPS — Practical suggestions for perfect trades
          ═══════════════════════════════════════════════════════════ */}
      <Card className="border-border/30 bg-card/50">
        <CardContent className="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            Perfect Trade Framework — How to Use This Screen
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-[9px] text-muted-foreground">
            <div>
              <span className="text-emerald-400 font-medium">1. Confluence Entry:</span> Only BUY CALL when Price ↑ + Cash In + Idx Opt Bullish + Futures Buy ALL align. No divergence = high confidence. The score line crossing above +35 with &gt;40% confidence is your trigger.
            </div>
            <div>
              <span className="text-red-400 font-medium">2. Divergence = Trap:</span> If Cash flowing OUT but Options showing Call Buy + Put Write (bullish), that&apos;s short covering, NOT fresh buying. Wait. The ⚠️ Cash-Opt Div badge catches this automatically.
            </div>
            <div>
              <span className="text-amber-400 font-medium">3. Futures Confirmation:</span> Futures are leveraged — institutions don&apos;t take futures positions casually. If Index Futures are net LONG + Options bullish + Cash inflow = triple confirmation. This is your highest probability trade.
            </div>
            <div>
              <span className="text-blue-400 font-medium">4. Basis Signal:</span> Contango (positive basis) = bullish sentiment. Backwardation (negative basis) = bearish urgency. If basis flips from + to − while options still bullish → smart money is exiting.
            </div>
            <div>
              <span className="text-cyan-400 font-medium">5. OI Build-Up:</span> Rising OI + rising price = long build-up (bullish). Rising OI + falling price = short build-up (bearish). Falling OI = unwinding — the move is ending, don&apos;t enter.
            </div>
            <div>
              <span className="text-purple-400 font-medium">6. CAS Window (3:15-3:35):</span> Cash is PAUSED but F&O continues. During CAS, only Options + Futures flow matter. Cash data freezes. Adjust your signal reading — ignore cash during CAS.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS
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
  const pct = Math.abs(score) / 100 * 50; // max 50% from center

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
