'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import {
  BarChart3, Activity, Layers, Zap,
} from 'lucide-react';
import type { WeightedCashFlowBar, CashFlowTrend, OptionsFlowBar } from '@/lib/types';
import {
  generateDemoWeightedBars, computeCashFlowTrend,
  generateDemoOptionsFlowBar, generateDemoOptionsFlowBars,
} from '@/lib/demo-data';

// Chart dimensions
const VISIBLE_BARS = 120;
const BAR_WIDTH = 3;
const CHART_HEIGHT = 100; // Each chart row height

// Color palette for options flow
// Call Buy = dark green, Put Write = light green, Put Buy = dark red, Call Write = light red
const COLORS = {
  callBuy: '#16a34a',      // dark green (green-600)
  putWrite: '#4ade80',     // light green (green-400)
  putBuy: '#dc2626',       // dark red (red-600)
  callWrite: '#f87171',    // light red (red-400)
  bullish: '#22c55e',      // combined bullish
  bearish: '#ef4444',      // combined bearish
  netFlow: '#3b82f6',      // blue for net
  cashIn: '#34d399',       // emerald-400
  cashOut: '#f87171',      // red-400
} as const;

export default function OptionsFlowTab() {
  // Cash flow data
  const [cashBars, setCashBars] = useState<WeightedCashFlowBar[]>([]);
  const [cashTrend, setCashTrend] = useState<CashFlowTrend | null>(null);
  const [niftyPrice, setNiftyPrice] = useState(24350);

  // Options flow data
  const [optionsBars, setOptionsBars] = useState<OptionsFlowBar[]>([]);

  // Selected instrument for drill-down
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);

  // Initialize + refresh every 15 seconds
  useEffect(() => {
    // Initial data
    const initCashBars = generateDemoWeightedBars(60);
    setCashBars(initCashBars);
    setCashTrend(computeCashFlowTrend(initCashBars));
    setNiftyPrice(24350 + Math.random() * 100 - 50);
    setOptionsBars(generateDemoOptionsFlowBars(60));

    // Live updates every 15 seconds
    const interval = setInterval(() => {
      setCashBars(prev => {
        const newBar = generateDemoWeightedBars(1)[0];
        const updated = [...prev, newBar];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
      setNiftyPrice(prev => prev + (Math.random() - 0.48) * 3);

      setOptionsBars(prev => {
        const newBar = generateDemoOptionsFlowBar();
        const updated = [...prev, newBar];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Recalculate cash trend when bars change
  useEffect(() => {
    if (cashBars.length > 14) {
      setCashTrend(computeCashFlowTrend(cashBars));
    }
  }, [cashBars]);

  // Visible slices
  const visibleCashBars = cashBars.slice(-VISIBLE_BARS);
  const visibleOptBars = optionsBars.slice(-VISIBLE_BARS);
  const latestOptBar = visibleOptBars[visibleOptBars.length - 1];

  // ── CASH FLOW CHART DATA ──
  const cashMaxAbs = Math.max(1, ...visibleCashBars.map(b =>
    Math.max(Math.abs(b.totalMoneyIn), Math.abs(b.totalMoneyOut), Math.abs(b.netFlow))
  ));

  // ── INDEX OPTIONS FLOW CHART DATA ──
  const idxOptMaxAbs = Math.max(1, ...visibleOptBars.map(b =>
    Math.max(b.indexBullishFlow, b.indexBearishFlow, Math.abs(b.indexNetFlow))
  ));

  // ── STOCK OPTIONS FLOW CHART DATA ──
  const stkOptMaxAbs = Math.max(1, ...visibleOptBars.map(b =>
    Math.max(b.stockBullishFlow, b.stockBearishFlow, Math.abs(b.stockNetFlow))
  ));

  // Aggregate totals for summary
  const totalCashIn = visibleCashBars.reduce((s, b) => s + b.totalMoneyIn, 0);
  const totalCashOut = visibleCashBars.reduce((s, b) => s + b.totalMoneyOut, 0);
  const totalCashNet = visibleCashBars.reduce((s, b) => s + b.netFlow, 0);

  const totalIdxCallBuy = visibleOptBars.reduce((s, b) => s + b.indexTotalCallBuy, 0);
  const totalIdxPutWrite = visibleOptBars.reduce((s, b) => s + b.indexTotalPutWrite, 0);
  const totalIdxPutBuy = visibleOptBars.reduce((s, b) => s + b.indexTotalPutBuy, 0);
  const totalIdxCallWrite = visibleOptBars.reduce((s, b) => s + b.indexTotalCallWrite, 0);
  const totalIdxBullish = totalIdxCallBuy + totalIdxPutWrite;
  const totalIdxBearish = totalIdxPutBuy + totalIdxCallWrite;

  const totalStkCallBuy = visibleOptBars.reduce((s, b) => s + b.stockTotalCallBuy, 0);
  const totalStkPutWrite = visibleOptBars.reduce((s, b) => s + b.stockTotalPutWrite, 0);
  const totalStkPutBuy = visibleOptBars.reduce((s, b) => s + b.stockTotalPutBuy, 0);
  const totalStkCallWrite = visibleOptBars.reduce((s, b) => s + b.stockTotalCallWrite, 0);
  const totalStkBullish = totalStkCallBuy + totalStkPutWrite;
  const totalStkBearish = totalStkPutBuy + totalStkCallWrite;

  // Correlation: Cash vs Options alignment
  const cashBullish = totalCashNet > 0;
  const idxOptBullish = totalIdxBullish > totalIdxBearish;
  const stkOptBullish = totalStkBullish > totalStkBearish;
  const allAligned = cashBullish === idxOptBullish && idxOptBullish === stkOptBullish;
  const cashOptDivergence = cashBullish !== idxOptBullish;

  // Drill-down instrument data
  const drillDownInstrument = latestOptBar
    ? [...latestOptBar.indexFlows, ...latestOptBar.stockFlows].find(f => f.symbol === selectedInstrument)
    : null;

  return (
    <div className="space-y-4">
      {/* ═══ ALIGNMENT SIGNAL ═══ */}
      <Card className={`border-2 ${allAligned ? (cashBullish ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-red-500/60 bg-red-500/5') : 'border-amber-500/60 bg-amber-500/5'} backdrop-blur-sm`}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className={`h-5 w-5 ${allAligned ? (cashBullish ? 'text-emerald-400' : 'text-red-400') : 'text-amber-400'}`} />
              <span className="font-bold text-sm">
                {allAligned
                  ? (cashBullish ? 'ALL FLOWS ALIGNED — STRONG BULLISH SIGNAL' : 'ALL FLOWS ALIGNED — STRONG BEARISH SIGNAL')
                  : cashOptDivergence
                    ? 'CASH vs OPTIONS DIVERGENCE — POTENTIAL TRAP / SHORT COVERING'
                    : 'MIXED SIGNALS — WAIT FOR CONFIRMATION'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className={`text-[9px] ${cashBullish ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
                Cash: {cashBullish ? 'BULLISH' : 'BEARISH'}
              </Badge>
              <Badge variant="outline" className={`text-[9px] ${idxOptBullish ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
                Idx Opt: {idxOptBullish ? 'BULLISH' : 'BEARISH'}
              </Badge>
              <Badge variant="outline" className={`text-[9px] ${stkOptBullish ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
                Stk Opt: {stkOptBullish ? 'BULLISH' : 'BEARISH'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ SUMMARY STATS ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {/* Cash Stats */}
        <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground">Cash Money In</div>
          <div className="text-sm font-mono font-bold text-emerald-400">
            +{(totalCashIn / 10000000).toFixed(1)} Cr
          </div>
        </div>
        <div className="p-2 rounded border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-muted-foreground">Cash Money Out</div>
          <div className="text-sm font-mono font-bold text-red-400">
            -{(totalCashOut / 10000000).toFixed(1)} Cr
          </div>
        </div>

        {/* Index Options Stats */}
        <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground">Idx Call Buy + Put Write</div>
          <div className="text-sm font-mono font-bold text-emerald-400">
            +{(totalIdxBullish / 100000).toFixed(1)} L
          </div>
        </div>
        <div className="p-2 rounded border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-muted-foreground">Idx Put Buy + Call Write</div>
          <div className="text-sm font-mono font-bold text-red-400">
            -{(totalIdxBearish / 100000).toFixed(1)} L
          </div>
        </div>

        {/* Stock Options Stats */}
        <div className="p-2 rounded border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground">Stk Call Buy + Put Write</div>
          <div className="text-sm font-mono font-bold text-emerald-400">
            +{(totalStkBullish / 100000).toFixed(1)} L
          </div>
        </div>
        <div className="p-2 rounded border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-muted-foreground">Stk Put Buy + Call Write</div>
          <div className="text-sm font-mono font-bold text-red-400">
            -{(totalStkBearish / 100000).toFixed(1)} L
          </div>
        </div>
      </div>

      {/* ═══ STACKED CHARTS: Cash → Index Options → Stock Options ═══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-amber-400" />
            Stacked Flow View — Cash | Index Options | Stock Options
            <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
              4 bars/min | 15s intervals
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {/* ── LAYER 1: CASH FLOW BARS ── */}
          <div>
            <div className="flex items-center gap-2 mb-1 text-[10px]">
              <span className="font-medium text-emerald-400">CASH FLOW</span>
              <span className="text-muted-foreground">(NSE + BSE weighted)</span>
              <Badge variant="outline" className="text-[8px] border-emerald-500/30 text-emerald-300">In</Badge>
              <Badge variant="outline" className="text-[8px] border-red-500/30 text-red-300">Out</Badge>
              <Badge variant="outline" className="text-[8px] border-blue-500/30 text-blue-300">Net</Badge>
            </div>
            <div className="relative border border-border/20 rounded bg-black/20" style={{ height: CHART_HEIGHT }}>
              <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-border/10 z-10 flex flex-col justify-between py-1 px-1">
                <span className="text-[8px] font-mono text-muted-foreground">+{(cashMaxAbs / 10000000).toFixed(1)}Cr</span>
                <span className="text-[8px] font-mono text-muted-foreground">0</span>
                <span className="text-[8px] font-mono text-muted-foreground">-{(cashMaxAbs / 10000000).toFixed(1)}Cr</span>
              </div>
              <div className="absolute left-12 right-0 flex items-end gap-px overflow-hidden" style={{ top: 0, bottom: 0 }}>
                {visibleCashBars.map((bar, i) => {
                  const inH = Math.max(0.5, (bar.totalMoneyIn / cashMaxAbs) * (CHART_HEIGHT * 0.4));
                  const outH = Math.max(0.5, (bar.totalMoneyOut / cashMaxAbs) * (CHART_HEIGHT * 0.4));
                  return (
                    <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                      {/* Money In bar (green, grows upward from center) */}
                      <div className="w-full flex-1 flex items-end">
                        <div className="w-full rounded-t-sm bg-emerald-500/70" style={{ height: inH }}
                          title={`In: ${(bar.totalMoneyIn / 10000000).toFixed(2)} Cr | ${bar.timestamp}`}
                        />
                      </div>
                      {/* Money Out bar (red, grows downward from center) */}
                      <div className="w-full flex-1">
                        <div className="w-full rounded-b-sm bg-red-500/60" style={{ height: outH }}
                          title={`Out: ${(bar.totalMoneyOut / 10000000).toFixed(2)} Cr | ${bar.timestamp}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── LAYER 2: INDEX OPTIONS FLOW BARS (4-color) ── */}
          <div>
            <div className="flex items-center gap-2 mb-1 text-[10px]">
              <span className="font-medium text-amber-400">INDEX OPTIONS</span>
              <span className="text-muted-foreground">(Nifty, Sensex, BankNifty, FinNifty — 11 strikes each)</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.callBuy }} /> Call Buy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.putWrite }} /> Put Write</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.putBuy }} /> Put Buy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.callWrite }} /> Call Write</span>
            </div>
            <div className="relative border border-border/20 rounded bg-black/20" style={{ height: CHART_HEIGHT }}>
              <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-border/10 z-10 flex flex-col justify-between py-1 px-1">
                <span className="text-[8px] font-mono text-muted-foreground">Bull</span>
                <span className="text-[8px] font-mono text-muted-foreground">0</span>
                <span className="text-[8px] font-mono text-muted-foreground">Bear</span>
              </div>
              <div className="absolute left-12 right-0 flex items-end gap-px overflow-hidden" style={{ top: 0, bottom: 0 }}>
                {visibleOptBars.map((bar, i) => {
                  const cbH = Math.max(0.5, (bar.indexTotalCallBuy / idxOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const pwH = Math.max(0.5, (bar.indexTotalPutWrite / idxOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const pbH = Math.max(0.5, (bar.indexTotalPutBuy / idxOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const cwH = Math.max(0.5, (bar.indexTotalCallWrite / idxOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  return (
                    <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                      {/* Bullish side: Call Buy + Put Write (grows upward) */}
                      <div className="w-full flex-1 flex flex-col items-end justify-end">
                        <div className="w-full rounded-t-sm" style={{ height: cbH, background: COLORS.callBuy }}
                          title={`Idx Call Buy: ${(bar.indexTotalCallBuy / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                        <div className="w-full" style={{ height: pwH, background: COLORS.putWrite }}
                          title={`Idx Put Write: ${(bar.indexTotalPutWrite / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                      </div>
                      {/* Bearish side: Put Buy + Call Write (grows downward) */}
                      <div className="w-full flex-1 flex flex-col items-start">
                        <div className="w-full" style={{ height: pbH, background: COLORS.putBuy }}
                          title={`Idx Put Buy: ${(bar.indexTotalPutBuy / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                        <div className="w-full rounded-b-sm" style={{ height: cwH, background: COLORS.callWrite }}
                          title={`Idx Call Write: ${(bar.indexTotalCallWrite / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Live indicator */}
              <div className="absolute top-1 right-2 z-20">
                <Badge className="text-[7px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30 px-1 py-0 animate-pulse">LIVE</Badge>
              </div>
            </div>
          </div>

          {/* ── LAYER 3: STOCK OPTIONS FLOW BARS (4-color) ── */}
          <div>
            <div className="flex items-center gap-2 mb-1 text-[10px]">
              <span className="font-medium text-cyan-400">STOCK OPTIONS</span>
              <span className="text-muted-foreground">(15 NSE F&O stocks, 9 strikes each — BSE has no stock options)</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.callBuy }} /> Call Buy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.putWrite }} /> Put Write</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.putBuy }} /> Put Buy</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-1.5 rounded-sm" style={{ background: COLORS.callWrite }} /> Call Write</span>
            </div>
            <div className="relative border border-border/20 rounded bg-black/20" style={{ height: CHART_HEIGHT }}>
              <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-border/10 z-10 flex flex-col justify-between py-1 px-1">
                <span className="text-[8px] font-mono text-muted-foreground">Bull</span>
                <span className="text-[8px] font-mono text-muted-foreground">0</span>
                <span className="text-[8px] font-mono text-muted-foreground">Bear</span>
              </div>
              <div className="absolute left-12 right-0 flex items-end gap-px overflow-hidden" style={{ top: 0, bottom: 0 }}>
                {visibleOptBars.map((bar, i) => {
                  const cbH = Math.max(0.5, (bar.stockTotalCallBuy / stkOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const pwH = Math.max(0.5, (bar.stockTotalPutWrite / stkOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const pbH = Math.max(0.5, (bar.stockTotalPutBuy / stkOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  const cwH = Math.max(0.5, (bar.stockTotalCallWrite / stkOptMaxAbs) * (CHART_HEIGHT * 0.25));
                  return (
                    <div key={i} className="flex flex-col items-center justify-center" style={{ width: BAR_WIDTH, height: '100%' }}>
                      {/* Bullish side */}
                      <div className="w-full flex-1 flex flex-col items-end justify-end">
                        <div className="w-full rounded-t-sm" style={{ height: cbH, background: COLORS.callBuy }}
                          title={`Stk Call Buy: ${(bar.stockTotalCallBuy / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                        <div className="w-full" style={{ height: pwH, background: COLORS.putWrite }}
                          title={`Stk Put Write: ${(bar.stockTotalPutWrite / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                      </div>
                      {/* Bearish side */}
                      <div className="w-full flex-1 flex flex-col items-start">
                        <div className="w-full" style={{ height: pbH, background: COLORS.putBuy }}
                          title={`Stk Put Buy: ${(bar.stockTotalPutBuy / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                        <div className="w-full rounded-b-sm" style={{ height: cwH, background: COLORS.callWrite }}
                          title={`Stk Call Write: ${(bar.stockTotalCallWrite / 100000).toFixed(1)}L | ${bar.timestamp}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Timestamp */}
          {latestOptBar && (
            <div className="text-right text-[9px] font-mono text-muted-foreground">
              Last update: {latestOptBar.timestamp}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ PER-INSTRUMENT BREAKDOWN ═══ */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            Per-Instrument Options Flow (Latest 15s Bar)
            <Badge variant="outline" className="ml-auto text-[10px] border-blue-500/40 text-blue-300">
              Click to drill down
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestOptBar && (
            <div className="space-y-3">
              {/* Index Options Table */}
              <div>
                <div className="text-[11px] font-medium text-amber-400 mb-1">Index Options (11 strikes each)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {latestOptBar.indexFlows.map(flow => (
                    <div
                      key={flow.symbol}
                      className={`p-2 rounded border cursor-pointer transition-all hover:border-primary/40 ${
                        selectedInstrument === flow.symbol ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border/30'
                      } ${flow.totalNetFlow > 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}
                      onClick={() => setSelectedInstrument(selectedInstrument === flow.symbol ? null : flow.symbol)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{flow.symbol}</span>
                        <span className="text-[9px] text-muted-foreground">ATM {flow.atmStrike.toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1 text-[9px] font-mono">
                        <div className="text-emerald-600" style={{ color: COLORS.callBuy }}>
                          CB: {(flow.totalCallBuy / 100000).toFixed(1)}L
                        </div>
                        <div style={{ color: COLORS.putWrite }}>
                          PW: {(flow.totalPutWrite / 100000).toFixed(1)}L
                        </div>
                        <div style={{ color: COLORS.putBuy }}>
                          PB: {(flow.totalPutBuy / 100000).toFixed(1)}L
                        </div>
                        <div style={{ color: COLORS.callWrite }}>
                          CW: {(flow.totalCallWrite / 100000).toFixed(1)}L
                        </div>
                      </div>
                      <div className={`text-[10px] font-mono font-bold mt-1 ${flow.totalNetFlow > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        Net: {flow.totalNetFlow > 0 ? '+' : ''}{(flow.totalNetFlow / 100000).toFixed(1)}L
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stock Options Table */}
              <div>
                <div className="text-[11px] font-medium text-cyan-400 mb-1">Stock Options (9 strikes each, NSE only)</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-5 gap-1">
                  {latestOptBar.stockFlows.map(flow => (
                    <div
                      key={flow.symbol}
                      className={`p-1.5 rounded border cursor-pointer transition-all hover:border-primary/40 ${
                        selectedInstrument === flow.symbol ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border/30'
                      } ${flow.totalNetFlow > 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}
                      onClick={() => setSelectedInstrument(selectedInstrument === flow.symbol ? null : flow.symbol)}
                    >
                      <div className="text-[10px] font-bold">{flow.symbol}</div>
                      <div className={`text-[9px] font-mono font-bold ${flow.totalNetFlow > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {flow.totalNetFlow > 0 ? '+' : ''}{(flow.totalNetFlow / 100000).toFixed(1)}L
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ STRIKE-LEVEL DRILL DOWN ═══ */}
      {drillDownInstrument && (
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-yellow-400" />
              {drillDownInstrument.name} — Strike-Level Flow
              <Badge variant="outline" className="text-[9px] border-yellow-500/40 text-yellow-300">
                ATM: {drillDownInstrument.atmStrike.toLocaleString()}
              </Badge>
              <Badge variant="outline" className="text-[9px] border-muted text-muted-foreground ml-auto">
                {drillDownInstrument.strikes.length} strikes
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Mini bar chart per strike */}
            <div className="flex items-end gap-1 mb-3" style={{ height: 80 }}>
              {drillDownInstrument.strikes.map((s, i) => {
                const maxVal = Math.max(1, ...drillDownInstrument.strikes.map(x =>
                  Math.max(x.bullishFlow, x.bearishFlow)
                ));
                const bullH = (s.bullishFlow / maxVal) * 70;
                const bearH = (s.bearishFlow / maxVal) * 70;

                return (
                  <div key={i} className="flex flex-col items-center flex-1" title={`Strike ${s.strike} | CB: ${(s.callBuy/1000).toFixed(0)}K | PW: ${(s.putWrite/1000).toFixed(0)}K | PB: ${(s.putBuy/1000).toFixed(0)}K | CW: ${(s.callWrite/1000).toFixed(0)}K`}>
                    {/* Bullish (green) */}
                    <div className="w-full flex items-end" style={{ height: 35 }}>
                      <div className="w-full rounded-t-sm" style={{ height: bullH, background: s.isATM ? '#22c55e' : '#16a34a' }} />
                    </div>
                    {/* Bearish (red) */}
                    <div className="w-full" style={{ height: 35 }}>
                      <div className="w-full rounded-b-sm" style={{ height: bearH, background: s.isATM ? '#ef4444' : '#dc2626' }} />
                    </div>
                    {/* Strike label */}
                    <div className={`text-[7px] font-mono mt-0.5 ${s.isATM ? 'text-yellow-400 font-bold' : 'text-muted-foreground'}`}>
                      {s.strike.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Strike table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="py-1 text-left font-medium">Strike</th>
                    <th className="py-1 text-right font-medium" style={{ color: COLORS.callBuy }}>Call Buy</th>
                    <th className="py-1 text-right font-medium" style={{ color: COLORS.putWrite }}>Put Write</th>
                    <th className="py-1 text-right font-medium">Bullish</th>
                    <th className="py-1 text-right font-medium" style={{ color: COLORS.putBuy }}>Put Buy</th>
                    <th className="py-1 text-right font-medium" style={{ color: COLORS.callWrite }}>Call Write</th>
                    <th className="py-1 text-right font-medium">Bearish</th>
                    <th className="py-1 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDownInstrument.strikes.map((s, i) => (
                    <tr key={i} className={`border-b border-border/10 ${s.isATM ? 'bg-yellow-500/5 font-bold' : ''}`}>
                      <td className={`py-0.5 font-mono ${s.isATM ? 'text-yellow-400' : ''}`}>
                        {s.isATM ? '→ ' : ''}{s.strike.toLocaleString()}
                      </td>
                      <td className="py-0.5 text-right font-mono" style={{ color: COLORS.callBuy }}>
                        {(s.callBuy / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right font-mono" style={{ color: COLORS.putWrite }}>
                        {(s.putWrite / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right font-mono text-emerald-400">
                        {(s.bullishFlow / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right font-mono" style={{ color: COLORS.putBuy }}>
                        {(s.putBuy / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right font-mono" style={{ color: COLORS.callWrite }}>
                        {(s.callWrite / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right font-mono text-red-400">
                        {(s.bearishFlow / 1000).toFixed(0)}K
                      </td>
                      <td className={`py-0.5 text-right font-mono ${s.netFlow > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.netFlow > 0 ? '+' : ''}{(s.netFlow / 1000).toFixed(0)}K
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ LEGEND + EXPLANATION ═══ */}
      <Card className="border-border/30 bg-card/50">
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[10px]">
            <span className="font-medium">Options Flow Legend:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: COLORS.callBuy }} /> Call Buy (dark green) — buyers buying calls = bullish
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: COLORS.putWrite }} /> Put Write (light green) — sellers writing puts = bullish
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: COLORS.putBuy }} /> Put Buy (dark red) — buyers buying puts = bearish
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ background: COLORS.callWrite }} /> Call Write (light red) — sellers writing calls = bearish
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground space-y-1">
            <p>
              <strong>Call Buy + Put Write = Bullish Flow</strong> — Both positions profit when price goes UP.
              When call buying surges AND put writing increases, smart money is positioning bullish.
            </p>
            <p>
              <strong>Put Buy + Call Write = Bearish Flow</strong> — Both positions profit when price goes DOWN.
              Heavy put buying + call writing = bearish positioning.
            </p>
            <p>
              <strong>Key Insight:</strong> When Cash Flow is bullish AND Options Flow is bullish → strong confirmation.
              When they diverge (cash outflow but heavy call buying) → potential trap or short covering.
              This is why the <span className="text-amber-400">stacked view</span> matters — you see correlation in real-time.
            </p>
            <p>
              <span className="text-cyan-400">BSE does NOT have stock options</span> — stock options data is NSE only.
              Index options (Nifty, Sensex, BankNifty, FinNifty) trade on both exchanges but NSE dominates volume.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
