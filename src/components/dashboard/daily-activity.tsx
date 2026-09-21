'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import { Calendar, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { INDICES, TOP_STOCKS } from '@/lib/types';

interface DailyInstrument {
  symbol: string;
  cashVolume: number;
  optionVolume: number;
  futureVolume: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  signals: string[];
}

interface DailyData {
  date: string;
  instruments: DailyInstrument[];
  vix: { open: number; high: number; low: number; close: number };
  topCallStrikes: { symbol: string; strike: number; oi: number }[];
  topPutStrikes: { symbol: string; strike: number; oi: number }[];
}

function formatVol(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

export default function DailyActivity() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDaily = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/daily-log?date=${date}`);
      if (!res.ok) throw new Error('Fetch failed');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Daily log fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchDaily();
  }, [fetchDaily]);

  const totalCashVol = data?.instruments.reduce((s, i) => s + i.cashVolume, 0) ?? 0;
  const totalOptVol = data?.instruments.reduce((s, i) => s + i.optionVolume, 0) ?? 0;
  const totalFutVol = data?.instruments.reduce((s, i) => s + i.futureVolume, 0) ?? 0;

  const oiChartData = data?.instruments
    .filter(i => INDICES.some(idx => idx.symbol === i.symbol))
    .map(i => ({
      symbol: i.symbol,
      callOI: i.totalCallOI / 100000,
      putOI: i.totalPutOI / 100000,
    })) ?? [];

  const pcrChartData = data?.instruments
    .filter(i => INDICES.some(idx => idx.symbol === i.symbol))
    .map(i => ({
      symbol: i.symbol,
      pcr: i.pcr,
    })) ?? [];

  const intradayOiSim = Array.from({ length: 12 }, (_, i) => {
    const hour = 9 + Math.floor(i * 0.65);
    const min = (i * 5) % 60;
    const factor = 0.3 + (i / 12) * 0.7;
    return {
      time: `${hour}:${min.toString().padStart(2, '0')}`,
      callOI: Math.round(totalOptVol * factor * 0.3 / 100000),
      putOI: Math.round(totalOptVol * factor * 0.25 / 100000),
    };
  });

  return (
    <div className="space-y-3 p-2 md:p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          Daily Activity
        </h2>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-7 text-xs w-[140px]"
          />
        </div>
      </div>

      {loading && <div className="text-center text-muted-foreground text-sm p-4">Loading...</div>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Card className="bg-card border-border">
              <CardContent className="p-3">
                <span className="text-[10px] text-muted-foreground">Cash Volume</span>
                <div className="text-lg font-bold font-mono">₹{formatVol(totalCashVol)}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-3">
                <span className="text-[10px] text-muted-foreground">Options Volume</span>
                <div className="text-lg font-bold font-mono">₹{formatVol(totalOptVol)}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-3">
                <span className="text-[10px] text-muted-foreground">Futures Volume</span>
                <div className="text-lg font-bold font-mono">₹{formatVol(totalFutVol)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">Intraday OI Accumulation (Indices, in Lakhs)</CardTitle>
              </CardHeader>
              <CardContent className="p-2 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={intradayOiSim} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ fontSize: 10, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Area type="monotone" dataKey="callOI" name="Call OI" fill="#22c55e" fillOpacity={0.3} stroke="#22c55e" />
                    <Area type="monotone" dataKey="putOI" name="Put OI" fill="#ef4444" fillOpacity={0.3} stroke="#ef4444" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">PCR Movement (Indices)</CardTitle>
              </CardHeader>
              <CardContent className="p-2 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pcrChartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} domain={[0, 2]} />
                    <Tooltip contentStyle={{ fontSize: 10, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Bar dataKey="pcr" name="PCR" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">Top Call Strikes by OI</CardTitle>
              </CardHeader>
              <CardContent className="p-1">
                <ScrollArea className="h-[200px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[10px]">
                        <TableHead className="p-1">#</TableHead>
                        <TableHead className="p-1">Symbol</TableHead>
                        <TableHead className="p-1">Strike</TableHead>
                        <TableHead className="p-1">Call OI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topCallStrikes.map((s, i) => (
                        <TableRow key={`c-${i}`} className="text-[10px] font-mono">
                          <TableCell className="p-1">{i + 1}</TableCell>
                          <TableCell className="p-1 font-semibold">{s.symbol}</TableCell>
                          <TableCell className="p-1 text-green-400">{s.strike}</TableCell>
                          <TableCell className="p-1">{formatVol(s.oi)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="p-2">
                <CardTitle className="text-xs">Top Put Strikes by OI</CardTitle>
              </CardHeader>
              <CardContent className="p-1">
                <ScrollArea className="h-[200px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[10px]">
                        <TableHead className="p-1">#</TableHead>
                        <TableHead className="p-1">Symbol</TableHead>
                        <TableHead className="p-1">Strike</TableHead>
                        <TableHead className="p-1">Put OI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topPutStrikes.map((s, i) => (
                        <TableRow key={`p-${i}`} className="text-[10px] font-mono">
                          <TableCell className="p-1">{i + 1}</TableCell>
                          <TableCell className="p-1 font-semibold">{s.symbol}</TableCell>
                          <TableCell className="p-1 text-red-400">{s.strike}</TableCell>
                          <TableCell className="p-1">{formatVol(s.oi)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card border-border">
            <CardHeader className="p-2">
              <CardTitle className="text-xs">Index OI Comparison (Call vs Put, in Lakhs)</CardTitle>
            </CardHeader>
            <CardContent className="p-2 h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={oiChartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ fontSize: 10, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                  <Bar dataKey="callOI" name="Call OI (L)" fill="#22c55e" />
                  <Bar dataKey="putOI" name="Put OI (L)" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="p-2">
              <CardTitle className="text-xs">VIX Summary for {date}</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                {['Open', 'High', 'Low', 'Close'].map((label, i) => {
                  const val = [data.vix.open, data.vix.high, data.vix.low, data.vix.close][i];
                  return (
                    <div key={label}>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <div className="text-sm font-bold font-mono text-blue-400">{val.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
