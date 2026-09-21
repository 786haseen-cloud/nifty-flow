'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useDashboardStore } from '@/lib/store';
import { INDICES, TOP_STOCKS, InstrumentData } from '@/lib/types';

function formatNum(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

const ALL_INSTRUMENTS = [
  ...INDICES.map(i => ({ symbol: i.symbol, name: i.name })),
  ...TOP_STOCKS.map(s => ({ symbol: s.symbol, name: s.name })),
];

export default function GreeksAnalysis() {
  const { instrumentData, selectedInstrument, setSelectedInstrument, setInstrumentData, setVixData, setLastUpdate, setIsConnected, refreshInterval } = useDashboardStore();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data?mode=demo');
      if (!res.ok) throw new Error('Fetch failed');
      const json = await res.json();
      setInstrumentData(json.data);
      setVixData(json.vix);
      setLastUpdate(new Date());
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, [setInstrumentData, setVixData, setLastUpdate, setIsConnected]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  const data: InstrumentData | undefined = instrumentData[selectedInstrument];
  const strikes = data?.strikes ?? [];

  const thetaData = strikes.map(s => ({
    strike: s.strike,
    callTheta: Math.abs(s.callTheta),
    putTheta: Math.abs(s.putTheta),
  }));

  const ivSkewData = strikes.map(s => ({
    strike: s.strike,
    callIV: s.callIV,
    putIV: s.putIV,
  }));

  const gammaHeatmapData = strikes.map(s => ({
    strike: s.strike,
    callGamma: s.callGamma,
    putGamma: s.putGamma,
  }));

  const maxGamma = Math.max(...gammaHeatmapData.map(d => Math.max(d.callGamma, d.putGamma)), 0.0001);

  return (
    <div className="space-y-3 p-2 md:p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">Greeks Analysis</h2>
        <Select value={selectedInstrument} onValueChange={setSelectedInstrument}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Select instrument" />
          </SelectTrigger>
          <SelectContent>
            {ALL_INSTRUMENTS.map(inst => (
              <SelectItem key={inst.symbol} value={inst.symbol} className="text-xs">
                {inst.name} ({inst.symbol})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data ? (
        <>
          <Card className="bg-card border-border">
            <CardHeader className="p-2">
              <CardTitle className="text-xs">Full Greeks Table — {data.name} (ATM: {data.atmStrike})</CardTitle>
            </CardHeader>
            <CardContent className="p-1">
              <ScrollArea className="h-[300px] md:h-[350px]">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[9px]">
                      <TableHead className="text-center p-1">Strike</TableHead>
                      <TableHead className="text-center p-1 text-green-400">C IV%</TableHead>
                      <TableHead className="text-center p-1 text-green-400">C Δ</TableHead>
                      <TableHead className="text-center p-1 text-green-400">C Γ</TableHead>
                      <TableHead className="text-center p-1 text-green-400">C Θ</TableHead>
                      <TableHead className="text-center p-1 text-green-400">C ν</TableHead>
                      <TableHead className="text-center p-1 text-red-400">P IV%</TableHead>
                      <TableHead className="text-center p-1 text-red-400">P Δ</TableHead>
                      <TableHead className="text-center p-1 text-red-400">P Γ</TableHead>
                      <TableHead className="text-center p-1 text-red-400">P Θ</TableHead>
                      <TableHead className="text-center p-1 text-red-400">P ν</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strikes.map(s => (
                      <TableRow key={s.strike} className={`text-[10px] font-mono ${s.strike === data.atmStrike ? 'bg-primary/10' : ''}`}>
                        <TableCell className="text-center p-1 font-bold">{s.strike}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.callIV)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.callDelta, 3)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.callGamma, 5)}</TableCell>
                        <TableCell className="text-center p-1 text-red-300">{formatNum(s.callTheta, 3)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.callVega, 3)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.putIV)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.putDelta, 3)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.putGamma, 5)}</TableCell>
                        <TableCell className="text-center p-1 text-red-300">{formatNum(s.putTheta, 3)}</TableCell>
                        <TableCell className="text-center p-1">{formatNum(s.putVega, 3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">Theta Decay Comparison (|Θ| per day)</CardTitle>
              </CardHeader>
              <CardContent className="p-2 h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={thetaData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ fontSize: 10, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Bar dataKey="callTheta" name="Call |Θ|" fill="#22c55e" />
                    <Bar dataKey="putTheta" name="Put |Θ|" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">IV Skew (Implied Volatility by Strike)</CardTitle>
              </CardHeader>
              <CardContent className="p-2 h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ivSkewData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ fontSize: 10, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Line type="monotone" dataKey="callIV" name="Call IV%" stroke="#22c55e" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="putIV" name="Put IV%" stroke="#ef4444" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card border-border">
            <CardHeader className="p-2">
              <CardTitle className="text-xs">Gamma Risk Heatmap</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-center text-green-400 font-semibold mb-1">Call Gamma</div>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(strikes.length, 11)}, 1fr)` }}>
                    {gammaHeatmapData.map(d => {
                      const intensity = d.callGamma / maxGamma;
                      return (
                        <div
                          key={`c-${d.strike}`}
                          className="rounded-sm p-1 text-center text-[8px] font-mono"
                          style={{ backgroundColor: `rgba(34, 197, 94, ${Math.min(intensity * 0.8 + 0.1, 1)})` }}
                          title={`Strike: ${d.strike}, Call Γ: ${d.callGamma.toFixed(5)}`}
                        >
                          {d.strike % (data.type === 'index' ? 100 : 50) === 0 ? d.strike : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-center text-red-400 font-semibold mb-1">Put Gamma</div>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(strikes.length, 11)}, 1fr)` }}>
                    {gammaHeatmapData.map(d => {
                      const intensity = d.putGamma / maxGamma;
                      return (
                        <div
                          key={`p-${d.strike}`}
                          className="rounded-sm p-1 text-center text-[8px] font-mono"
                          style={{ backgroundColor: `rgba(239, 68, 68, ${Math.min(intensity * 0.8 + 0.1, 1)})` }}
                          title={`Strike: ${d.strike}, Put Γ: ${d.putGamma.toFixed(5)}`}
                        >
                          {d.strike % (data.type === 'index' ? 100 : 50) === 0 ? d.strike : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            Loading Greeks data...
          </CardContent>
        </Card>
      )}
    </div>
  );
}
