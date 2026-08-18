'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';
import { Building2, TrendingUp, TrendingDown, RefreshCw, AlertTriangle, CheckCircle, CircleDollarSign } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { InstitutionalFlow, BigTrade, TimeSeriesPoint, OIBuildupEvent } from '@/lib/types';

// ============================================================
// Section A: Divergence Chart
// ============================================================
function DivergenceChart({ timeSeries }: { timeSeries: TimeSeriesPoint[] }) {
  if (timeSeries.length === 0) return <div className="text-muted-foreground text-sm p-4">Loading time series data...</div>;

  // Detect current divergence status
  const lastPoint = timeSeries[timeSeries.length - 1];
  const prevPoint = timeSeries[timeSeries.length - 2];

  let currentDivergence: 'bullish' | 'bearish' | 'confirmed' | 'none' = 'none';
  if (prevPoint) {
    const priceUp = lastPoint.niftyPrice > prevPoint.niftyPrice;
    const scoreUp = lastPoint.signalScore > prevPoint.signalScore;
    if (priceUp && !scoreUp) currentDivergence = 'bearish';
    else if (!priceUp && scoreUp) currentDivergence = 'bullish';
    else if (priceUp && scoreUp) currentDivergence = 'confirmed';
    else if (!priceUp && !scoreUp) currentDivergence = 'confirmed';
  }

  const divergenceBadge = {
    bullish: { label: '🟢 Bullish Divergence', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: <TrendingUp className="h-3 w-3" /> },
    bearish: { label: '🔴 Bearish Divergence', class: 'bg-red-500/20 text-red-400 border-red-500/30', icon: <TrendingDown className="h-3 w-3" /> },
    confirmed: { label: '✅ Confirmed', class: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: <CheckCircle className="h-3 w-3" /> },
    none: { label: '— No Divergence', class: 'bg-muted/30 text-muted-foreground', icon: <AlertTriangle className="h-3 w-3" /> },
  }[currentDivergence];

  // Add divergence zone data for the chart
  const chartData = timeSeries.map((p, i) => {
    let bearishZone = 0;
    let bullishZone = 0;
    if (i > 0) {
      const prev = timeSeries[i - 1];
      const priceUp = p.niftyPrice > prev.niftyPrice;
      const scoreUp = p.signalScore > prev.signalScore;
      if (priceUp && !scoreUp) bearishZone = 100; // shaded area for bearish
      else if (!priceUp && scoreUp) bullishZone = 100;
    }
    return { ...p, bearishZone, bullishZone };
  });

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4 text-orange-400" />
            Nifty50 Divergence Chart
          </CardTitle>
          <Badge variant="outline" className={`text-[10px] ${divergenceBadge.class}`}>
            {divergenceBadge.icon}
            <span className="ml-1">{divergenceBadge.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#888' }} />
            <YAxis
              yAxisId="price"
              tick={{ fontSize: 9, fill: '#60a5fa' }}
              domain={['dataMin - 30', 'dataMax + 30']}
              orientation="left"
            />
            <YAxis
              yAxisId="score"
              tick={{ fontSize: 9, fill: '#f97316' }}
              domain={[0, 100]}
              orientation="right"
            />
            <Tooltip
              contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }}
              formatter={(value: number, name: string) => {
                if (name === 'Nifty Price') return [`₹${value.toFixed(0)}`, name];
                return [value.toFixed(0), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {/* Divergence zones */}
            <Area yAxisId="score" type="monotone" dataKey="bearishZone" fill="rgba(239,68,68,0.1)" stroke="none" name="Bearish Zone" />
            <Area yAxisId="score" type="monotone" dataKey="bullishZone" fill="rgba(34,197,94,0.1)" stroke="none" name="Bullish Zone" />
            <Line yAxisId="price" type="monotone" dataKey="niftyPrice" stroke="#60a5fa" strokeWidth={2} dot={false} name="Nifty Price" />
            <Line yAxisId="score" type="monotone" dataKey="signalScore" stroke="#f97316" strokeWidth={2} dot={false} name="Signal Score" />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Section B: Institutional Flow Table
// ============================================================
function InstitutionalFlowTable({ flow }: { flow: InstitutionalFlow | null }) {
  if (!flow) return <div className="text-muted-foreground text-sm p-4">Loading institutional data...</div>;

  const netClass = (v: number) => v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-muted-foreground';
  const formatCr = (v: number) => `₹${v >= 0 ? '+' : ''}${v.toFixed(0)} Cr`;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-emerald-400" />
            Institutional Flow (FII / DII)
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className={`text-[10px] ${flow.stance === 'bullish' ? 'bg-emerald-500/20 text-emerald-400' : flow.stance === 'bearish' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
              Stance: {flow.stance.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Dominant: {flow.dominantPlayer} ({flow.dominantSegment})
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-72">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="p-1">Entity</TableHead>
                <TableHead className="p-1">Segment</TableHead>
                <TableHead className="text-right p-1">Buy (₹Cr)</TableHead>
                <TableHead className="text-right p-1">Sell (₹Cr)</TableHead>
                <TableHead className="text-right p-1">Net (₹Cr)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* FII Rows */}
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1 font-bold row-span-3" rowSpan={3}>FII</TableCell>
                <TableCell className="p-1">Cash</TableCell>
                <TableCell className="text-right p-1">{flow.fii.cashBuy.toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{flow.fii.cashSell.toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.fii.cashNet)}`}>{formatCr(flow.fii.cashNet)}</TableCell>
              </TableRow>
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1">Futures</TableCell>
                <TableCell className="text-right p-1">{flow.fii.futBuy.toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{flow.fii.futSell.toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.fii.futNet)}`}>{formatCr(flow.fii.futNet)}</TableCell>
              </TableRow>
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1">Options</TableCell>
                <TableCell className="text-right p-1">{(flow.fii.optCallBuy + flow.fii.optPutBuy).toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{(flow.fii.optCallSell + flow.fii.optPutSell).toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.fii.optCallNet + flow.fii.optPutNet)}`}>{formatCr(flow.fii.optCallNet + flow.fii.optPutNet)}</TableCell>
              </TableRow>
              {/* FII Total */}
              <TableRow className="text-[10px] font-mono border-t-2 border-border/50">
                <TableCell className="p-1 font-bold" colSpan={2}>FII Total Net</TableCell>
                <TableCell className="text-right p-1" colSpan={2}></TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.fii.totalNet)}`}>{formatCr(flow.fii.totalNet)}</TableCell>
              </TableRow>
              {/* DII Rows */}
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1 font-bold" rowSpan={3}>DII</TableCell>
                <TableCell className="p-1">Cash</TableCell>
                <TableCell className="text-right p-1">{flow.dii.cashBuy.toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{flow.dii.cashSell.toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.dii.cashNet)}`}>{formatCr(flow.dii.cashNet)}</TableCell>
              </TableRow>
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1">Futures</TableCell>
                <TableCell className="text-right p-1">{flow.dii.futBuy.toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{flow.dii.futSell.toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.dii.futNet)}`}>{formatCr(flow.dii.futNet)}</TableCell>
              </TableRow>
              <TableRow className="text-[10px] font-mono">
                <TableCell className="p-1">Options</TableCell>
                <TableCell className="text-right p-1">{(flow.dii.optCallBuy + flow.dii.optPutBuy).toFixed(0)}</TableCell>
                <TableCell className="text-right p-1">{(flow.dii.optCallSell + flow.dii.optPutSell).toFixed(0)}</TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.dii.optCallNet + flow.dii.optPutNet)}`}>{formatCr(flow.dii.optCallNet + flow.dii.optPutNet)}</TableCell>
              </TableRow>
              {/* DII Total */}
              <TableRow className="text-[10px] font-mono border-t-2 border-border/50">
                <TableCell className="p-1 font-bold" colSpan={2}>DII Total Net</TableCell>
                <TableCell className="text-right p-1" colSpan={2}></TableCell>
                <TableCell className={`text-right p-1 font-bold ${netClass(flow.dii.totalNet)}`}>{formatCr(flow.dii.totalNet)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ScrollArea>

        {/* Net stance summary */}
        <div className="mt-3 p-2 rounded bg-muted/20 text-xs font-mono">
          <span className={netClass(flow.fii.totalNet)}>FII: {flow.fii.totalNet > 0 ? 'Net Buyer' : 'Net Seller'} {formatCr(flow.fii.totalNet)}</span>
          <span className="mx-2 text-muted-foreground">|</span>
          <span className={netClass(flow.dii.totalNet)}>DII: {flow.dii.totalNet > 0 ? 'Net Buyer' : 'Net Seller'} {formatCr(flow.dii.totalNet)}</span>
          <span className="mx-2 text-muted-foreground">|</span>
          <span>Stance: <span className={flow.stance === 'bullish' ? 'text-emerald-400' : flow.stance === 'bearish' ? 'text-red-400' : 'text-yellow-400'}>{flow.stance.toUpperCase()}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Section C: Biggest Trades of the Day
// ============================================================
function BigTradesTimeline({ trades }: { trades: BigTrade[] }) {
  if (trades.length === 0) return <div className="text-muted-foreground text-sm p-4">Loading trades...</div>;

  const impactBadge = (impact: BigTrade['impact']) => {
    switch (impact) {
      case 'Heavy': return <Badge className="bg-red-500/20 text-red-400 text-[9px]">Heavy</Badge>;
      case 'Moderate': return <Badge className="bg-yellow-500/20 text-yellow-400 text-[9px]">Moderate</Badge>;
      case 'Light': return <Badge className="bg-muted/30 text-muted-foreground text-[9px]">Light</Badge>;
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Building2 className="h-4 w-4 text-red-400" />
          Biggest Trades of the Day (Top 20)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-64">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="p-1">Time</TableHead>
                <TableHead className="p-1">Instrument</TableHead>
                <TableHead className="p-1">Type</TableHead>
                <TableHead className="p-1">Action</TableHead>
                <TableHead className="text-right p-1">Qty</TableHead>
                <TableHead className="text-right p-1">Value (₹Cr)</TableHead>
                <TableHead className="p-1">Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t, idx) => {
                const timeStr = new Date(t.timestamp).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return (
                  <TableRow key={idx} className="text-[10px] font-mono">
                    <TableCell className="p-1 text-muted-foreground">{timeStr}</TableCell>
                    <TableCell className="p-1 font-semibold">{t.instrument}</TableCell>
                    <TableCell className="p-1">
                      <Badge variant="outline" className="text-[9px]">{t.tradeType}</Badge>
                    </TableCell>
                    <TableCell className={`p-1 ${t.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.action}
                    </TableCell>
                    <TableCell className="text-right p-1">{t.quantity.toLocaleString('en-IN')}</TableCell>
                    <TableCell className={`text-right p-1 font-semibold ${t.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      ₹{t.value.toFixed(1)}Cr
                    </TableCell>
                    <TableCell className="p-1">{impactBadge(t.impact)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Section D: OI Buildup Timeline
// ============================================================
function OIBuildupTimeline({ events }: { events: OIBuildupEvent[] }) {
  if (events.length === 0) return <div className="text-muted-foreground text-sm p-4">Loading OI events...</div>;

  const sigColor = (s: OIBuildupEvent['significance']) => {
    switch (s) {
      case 'high': return 'text-red-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-muted-foreground';
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          OI Buildup Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-52">
          <div className="space-y-1">
            {events.map((e, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded hover:bg-muted/20">
                <span className="text-muted-foreground w-12">{e.time}</span>
                <span className="font-semibold w-14">{e.instrument}</span>
                <Badge variant="outline" className={`text-[9px] ${e.optionType === 'CE' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {e.strike} {e.optionType}
                </Badge>
                <span className={`font-semibold ${e.oiChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {e.oiChange > 0 ? '+' : ''}{e.oiChange.toLocaleString('en-IN')}
                </span>
                <span className="text-muted-foreground">{e.builtUpType}</span>
                <Badge variant="secondary" className={`text-[8px] ${sigColor(e.significance)}`}>
                  {e.significance}
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Section E: Cash + Futures + Options Combined Flow
// ============================================================
function CombinedFlowSection({ flow }: { flow: InstitutionalFlow | null }) {
  if (!flow) return <div className="text-muted-foreground text-sm p-4">Loading flow data...</div>;

  const netClass = (v: number) => v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-muted-foreground';

  // Pie data
  const cashAbs = Math.abs(flow.fii.cashNet + flow.dii.cashNet);
  const futAbs = Math.abs(flow.fii.futNet + flow.dii.futNet);
  const optAbs = Math.abs(flow.fii.optCallNet + flow.fii.optPutNet + flow.dii.optCallNet + flow.dii.optPutNet);
  const total = cashAbs + futAbs + optAbs;

  const pieData = [
    { name: 'Cash', value: cashAbs, color: '#22c55e' },
    { name: 'Futures', value: futAbs, color: '#3b82f6' },
    { name: 'Options', value: optAbs, color: '#f97316' },
  ];

  // Bar data: FII vs DII across segments
  const barData = [
    {
      segment: 'Cash',
      FII: flow.fii.cashNet,
      DII: flow.dii.cashNet,
    },
    {
      segment: 'Futures',
      FII: flow.fii.futNet,
      DII: flow.dii.futNet,
    },
    {
      segment: 'Options',
      FII: flow.fii.optCallNet + flow.fii.optPutNet,
      DII: flow.dii.optCallNet + flow.dii.optPutNet,
    },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-blue-400" />
          Cash + Futures + Options Combined Flow
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Donut Chart */}
          <div>
            <h4 className="text-xs font-medium mb-2 text-center">Where is the money flowing today?</h4>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ₹${(value).toFixed(0)}Cr (${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%)`}
                >
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart: FII vs DII */}
          <div>
            <h4 className="text-xs font-medium mb-2 text-center">FII vs DII across Segments</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="segment" tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="FII" fill="#f97316" />
                <Bar dataKey="DII" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Net institutional stance */}
        <div className="mt-3 p-2 rounded bg-muted/20 text-xs font-mono text-center">
          <span className={netClass(flow.fii.totalNet)}>FII Net: ₹{flow.fii.totalNet >= 0 ? '+' : ''}{flow.fii.totalNet.toFixed(0)}Cr</span>
          <span className="mx-3 text-muted-foreground">|</span>
          <span className={netClass(flow.dii.totalNet)}>DII Net: ₹{flow.dii.totalNet >= 0 ? '+' : ''}{flow.dii.totalNet.toFixed(0)}Cr</span>
          <span className="mx-3 text-muted-foreground">|</span>
          <span>Net Flow: <span className={netClass(flow.fii.totalNet + flow.dii.totalNet)}>₹{(flow.fii.totalNet + flow.dii.totalNet) >= 0 ? '+' : ''}{(flow.fii.totalNet + flow.dii.totalNet).toFixed(0)}Cr</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Main Big Money Tab
// ============================================================
export default function BigMoneyTab() {
  const {
    institutionalFlow, setInstitutionalFlow,
    bigTrades, setBigTrades,
    timeSeries, setTimeSeries,
    oiBuildupEvents, setOiBuildupEvents,
    setLastRefresh,
  } = useStore();

  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/institutional');
      const data = await res.json();
      if (data.institutionalFlow) setInstitutionalFlow(data.institutionalFlow);
      if (data.bigTrades) setBigTrades(data.bigTrades.map((t: BigTrade & { timestamp: string }) => ({ ...t, timestamp: new Date(t.timestamp) })));
      if (data.timeSeries) setTimeSeries(data.timeSeries);
      if (data.oiBuildupEvents) setOiBuildupEvents(data.oiBuildupEvents);
      setLastRefresh(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [setInstitutionalFlow, setBigTrades, setTimeSeries, setOiBuildupEvents, setLastRefresh]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5 text-orange-400" />
          Big Money Footprint
        </h2>
        <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Section A: Divergence Chart — MOST IMPORTANT */}
      <DivergenceChart timeSeries={timeSeries} />

      {/* Section B: Institutional Flow */}
      <InstitutionalFlowTable flow={institutionalFlow} />

      {/* Section C: Biggest Trades */}
      <BigTradesTimeline trades={bigTrades} />

      {/* Section D: OI Buildup Timeline */}
      <OIBuildupTimeline events={oiBuildupEvents} />

      {/* Section E: Combined Flow */}
      <CombinedFlowSection flow={institutionalFlow} />
    </div>
  );
}
