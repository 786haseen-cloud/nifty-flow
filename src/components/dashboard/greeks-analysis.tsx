'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Sigma, TrendingDown, TrendingUp } from 'lucide-react';
import { useStore } from '@/lib/store';
import { calcAllGreeks, daysToExpiry } from '@/lib/black-scholes';
import type { OptionStrike } from '@/lib/types';

function formatGreek(v: number, decimals: number = 4): string {
  return v.toFixed(decimals);
}

function deltaColor(d: number): string {
  if (d > 0.5) return 'text-emerald-400';
  if (d > 0) return 'text-emerald-300';
  if (d > -0.5) return 'text-red-300';
  return 'text-red-400';
}

function thetaColor(t: number): string {
  return t < 0 ? 'text-red-400' : 'text-emerald-400';
}

function GreeksTable({ strikes, spot }: { strikes: OptionStrike[]; spot: number }) {
  const daysToExp = 3; // assume 3 days to expiry
  const tte = daysToExpiry(daysToExp);

  const greeksData = useMemo(() => {
    return strikes.map((s) => {
      const callGreeks = calcAllGreeks(spot, s.strike, tte, s.callIV / 100, 'CE');
      const putGreeks = calcAllGreeks(spot, s.strike, tte, s.putIV / 100, 'PE');
      return { strike: s.strike, callGreeks, putGreeks, callLTP: s.callLTP, putLTP: s.putLTP };
    });
  }, [strikes, spot, tte]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Sigma className="h-4 w-4 text-blue-400" />
          Greeks Table (Days to Expiry: {daysToExp})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-80">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="text-center p-1">Strike</TableHead>
                <TableHead className="text-center p-1">C Δ</TableHead>
                <TableHead className="text-center p-1">C Γ</TableHead>
                <TableHead className="text-center p-1">C Θ</TableHead>
                <TableHead className="text-center p-1">C ν</TableHead>
                <TableHead className="text-center p-1">C IV%</TableHead>
                <TableHead className="text-center p-1">P Δ</TableHead>
                <TableHead className="text-center p-1">P Γ</TableHead>
                <TableHead className="text-center p-1">P Θ</TableHead>
                <TableHead className="text-center p-1">P ν</TableHead>
                <TableHead className="text-center p-1">P IV%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {greeksData.map((row) => (
                <TableRow key={row.strike} className="text-[10px] font-mono">
                  <TableCell className="text-center p-1 font-bold">{row.strike}</TableCell>
                  <TableCell className={`text-center p-1 ${deltaColor(row.callGreeks.delta)}`}>{formatGreek(row.callGreeks.delta)}</TableCell>
                  <TableCell className="text-center p-1">{formatGreek(row.callGreeks.gamma)}</TableCell>
                  <TableCell className={`text-center p-1 ${thetaColor(row.callGreeks.theta)}`}>{formatGreek(row.callGreeks.theta)}</TableCell>
                  <TableCell className="text-center p-1">{formatGreek(row.callGreeks.vega)}</TableCell>
                  <TableCell className="text-center p-1 text-yellow-400">{(row.callGreeks.iv * 100).toFixed(1)}</TableCell>
                  <TableCell className={`text-center p-1 ${deltaColor(row.putGreeks.delta)}`}>{formatGreek(row.putGreeks.delta)}</TableCell>
                  <TableCell className="text-center p-1">{formatGreek(row.putGreeks.gamma)}</TableCell>
                  <TableCell className={`text-center p-1 ${thetaColor(row.putGreeks.theta)}`}>{formatGreek(row.putGreeks.theta)}</TableCell>
                  <TableCell className="text-center p-1">{formatGreek(row.putGreeks.vega)}</TableCell>
                  <TableCell className="text-center p-1 text-yellow-400">{(row.putGreeks.iv * 100).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function ThetaDecayChart({ strikes, spot }: { strikes: OptionStrike[]; spot: number }) {
  const chartData = useMemo(() => {
    const days = [1, 2, 3, 5, 7, 10, 15, 20];
    const atmStrike = strikes.reduce((closest, s) =>
      Math.abs(s.strike - spot) < Math.abs(closest.strike - spot) ? s : closest
    , strikes[0]);

    return days.map((d) => {
      const tte = daysToExpiry(d);
      const greeks = calcAllGreeks(spot, atmStrike.strike, tte, atmStrike.callIV / 100, 'CE');
      return { day: d, theta: greeks.theta, premium: greeks.theoreticalPrice };
    });
  }, [strikes, spot]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-red-400" />
          Theta Decay — ATM Call
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#888' }} label={{ value: 'Days to Expiry', position: 'insideBottom', fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
            <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
            <Line type="monotone" dataKey="premium" stroke="#22c55e" strokeWidth={2} dot={false} name="Premium" />
            <Line type="monotone" dataKey="theta" stroke="#ef4444" strokeWidth={2} dot={false} name="Theta/Day" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function IVSkewChart({ strikes }: { strikes: OptionStrike[] }) {
  const chartData = strikes.map((s) => ({
    strike: s.strike,
    callIV: s.callIV,
    putIV: s.putIV,
  }));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-400" />
          IV Skew
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="strike" tick={{ fontSize: 9, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} domain={['dataMin - 2', 'dataMax + 2']} />
            <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
            <Line type="monotone" dataKey="callIV" stroke="#22c55e" strokeWidth={2} dot={false} name="Call IV" />
            <Line type="monotone" dataKey="putIV" stroke="#ef4444" strokeWidth={2} dot={false} name="Put IV" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function GammaHeatmap({ strikes, spot }: { strikes: OptionStrike[]; spot: number }) {
  const tte = daysToExpiry(3);
  const gammaData = useMemo(() => {
    return strikes.map((s) => {
      const callGreeks = calcAllGreeks(spot, s.strike, tte, s.callIV / 100, 'CE');
      const putGreeks = calcAllGreeks(spot, s.strike, tte, s.putIV / 100, 'PE');
      return {
        strike: s.strike,
        callGamma: callGreeks.gamma,
        putGamma: putGreeks.gamma,
      };
    });
  }, [strikes, spot, tte]);

  const maxGamma = Math.max(...gammaData.map((d) => Math.max(d.callGamma, d.putGamma)));

  const chartData = gammaData.map((d) => ({
    strike: d.strike,
    callGamma: d.callGamma,
    putGamma: d.putGamma,
  }));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          Gamma Heatmap — Max Γ: {maxGamma.toFixed(4)}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="strike" tick={{ fontSize: 9, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
            <Tooltip contentStyle={{ fontSize: 10, backgroundColor: '#1a1a2e', border: '1px solid #333' }} />
            <Bar dataKey="callGamma" name="Call Γ">
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={`rgba(34, 197, 94, ${Math.min(entry.callGamma / maxGamma, 1)})`} />
              ))}
            </Bar>
            <Bar dataKey="putGamma" name="Put Γ">
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={`rgba(239, 68, 68, ${Math.min(entry.putGamma / maxGamma, 1)})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function GreeksAnalysis() {
  const { instruments, selectedInstrument, setSelectedInstrument } = useStore();
  const [localInstr, setLocalInstr] = useState(selectedInstrument);

  const instr = instruments.find((i) => i.symbol === localInstr) || instruments[0];

  if (!instr) {
    return <div className="text-muted-foreground text-sm p-4">No instrument data available. Switch to Live tab first.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sigma className="h-5 w-5 text-blue-400" />
          Greeks Analysis
        </h2>
        <Select value={localInstr} onValueChange={(v) => { setLocalInstr(v); setSelectedInstrument(v); }}>
          <SelectTrigger className="w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {instruments.map((i) => (
              <SelectItem key={i.symbol} value={i.symbol}>{i.symbol}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px]">Spot: {instr.spotPrice.toFixed(2)}</Badge>
        <Badge variant="secondary" className="text-[10px]">ATM: {instr.atmStrike}</Badge>
        <Badge variant="secondary" className="text-[10px]">PCR: {instr.pcr.toFixed(2)}</Badge>
      </div>

      <GreeksTable strikes={instr.strikes} spot={instr.spotPrice} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ThetaDecayChart strikes={instr.strikes} spot={instr.spotPrice} />
        <IVSkewChart strikes={instr.strikes} />
      </div>

      <GammaHeatmap strikes={instr.strikes} spot={instr.spotPrice} />
    </div>
  );
}
