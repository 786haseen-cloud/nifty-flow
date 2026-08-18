'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts';
import { Calendar, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { DailySummary } from '@/lib/types';

function formatCr(n: number): string {
  const prefix = n >= 0 ? '+' : '';
  return `${prefix}₹${n.toFixed(0)} Cr`;
}

function netClass(v: number): string {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-muted-foreground';
}

export default function DailyActivity() {
  const { dailySummaries, setDailySummaries, setLastRefresh } = useStore();
  const [loading, setLoading] = useState(false);
  const [selectedDays, setSelectedDays] = useState(5);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/daily-log');
      const data = await res.json();
      if (data.summaries) setDailySummaries(data.summaries);
      setLastRefresh(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [setDailySummaries, setLastRefresh]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // VIX chart data
  const vixChartData = dailySummaries.map((s) => ({
    date: s.date.slice(5), // MM-DD
    open: s.vixOpen,
    high: s.vixHigh,
    low: s.vixLow,
    close: s.vixClose,
  }));

  // FII/DII bar data
  const fidiiBarData = dailySummaries.map((s) => ({
    date: s.date.slice(5),
    FII_Cash: s.fiiCashNet,
    DII_Cash: s.diiCashNet,
    FII_Fut: s.fiiFutNet,
    DII_Fut: s.diiFutNet,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-400" />
          Daily Activity
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setSelectedDays(5); fetchData(); }}
            disabled={loading}
            className="gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* VIX Historical Chart */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">VIX History (Last {selectedDays} Days)</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={vixChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} />
              <YAxis tick={{ fontSize: 10, fill: '#888' }} domain={[8, 30]} />
              <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="open" stroke="#f97316" strokeWidth={1.5} dot={false} name="Open" />
              <Line type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={2} dot={false} name="Close" />
              <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" dot={false} name="High" />
              <Line type="monotone" dataKey="low" stroke="#22c55e" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Low" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* FII/DII Historical Comparison Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">FII/DII Comparison (Last {selectedDays} Days)</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <ScrollArea className="max-h-72">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="p-1">Date</TableHead>
                  <TableHead className="p-1">PCR</TableHead>
                  <TableHead className="text-right p-1">FII Cash</TableHead>
                  <TableHead className="text-right p-1">DII Cash</TableHead>
                  <TableHead className="text-right p-1">FII Fut</TableHead>
                  <TableHead className="text-right p-1">DII Fut</TableHead>
                  <TableHead className="text-right p-1">FII Opt</TableHead>
                  <TableHead className="text-right p-1">DII Opt</TableHead>
                  <TableHead className="p-1">Stance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailySummaries.map((s) => {
                  const totalNet = s.fiiCashNet + s.diiCashNet + s.fiiFutNet + s.diiFutNet + s.fiiOptNet + s.diiOptNet;
                  const stance = totalNet > 500 ? 'bullish' : totalNet < -500 ? 'bearish' : 'neutral';
                  return (
                    <TableRow key={s.date} className="text-[10px] font-mono">
                      <TableCell className="p-1">{s.date.slice(5)}</TableCell>
                      <TableCell className="p-1">{s.pcr.toFixed(2)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.fiiCashNet)}`}>{formatCr(s.fiiCashNet)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.diiCashNet)}`}>{formatCr(s.diiCashNet)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.fiiFutNet)}`}>{formatCr(s.fiiFutNet)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.diiFutNet)}`}>{formatCr(s.diiFutNet)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.fiiOptNet)}`}>{formatCr(s.fiiOptNet)}</TableCell>
                      <TableCell className={`text-right p-1 ${netClass(s.diiOptNet)}`}>{formatCr(s.diiOptNet)}</TableCell>
                      <TableCell className="p-1">
                        <Badge variant="outline" className={`text-[9px] ${stance === 'bullish' ? 'text-emerald-400' : stance === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {stance === 'bullish' ? <TrendingUp className="h-2 w-2 mr-0.5" /> : stance === 'bearish' ? <TrendingDown className="h-2 w-2 mr-0.5" /> : null}
                          {stance}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* FII vs DII Bar Chart */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">FII vs DII — Cash & Futures</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fidiiBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} />
              <YAxis tick={{ fontSize: 10, fill: '#888' }} />
              <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="FII_Cash" fill="#f97316" name="FII Cash" />
              <Bar dataKey="DII_Cash" fill="#22c55e" name="DII Cash" />
              <Bar dataKey="FII_Fut" fill="#3b82f6" name="FII Futures" />
              <Bar dataKey="DII_Fut" fill="#a855f7" name="DII Futures" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {dailySummaries.slice(0, 3).map((s) => (
          <Card key={s.date} className="border-border/50">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium">{s.date}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 text-[10px] font-mono space-y-1">
              <div>Total OI: {s.totalOI.toLocaleString('en-IN')}</div>
              <div>Volume: {s.totalVolume.toLocaleString('en-IN')}</div>
              <div>PCR: <span className={s.pcr > 1 ? 'text-emerald-400' : 'text-red-400'}>{s.pcr.toFixed(2)}</span></div>
              <div>VIX: {s.vixOpen.toFixed(1)} → {s.vixClose.toFixed(1)}</div>
              <div className={netClass(s.fiiCashNet + s.diiCashNet)}>
                Net Cash: {formatCr(s.fiiCashNet + s.diiCashNet)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
