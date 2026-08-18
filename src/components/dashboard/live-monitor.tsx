'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Activity, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { InstrumentData, VIXData, OptionStrike, BuiltUpType } from '@/lib/types';

function formatNumber(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(2) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function builtUpColor(type: BuiltUpType): string {
  switch (type) {
    case 'Long Build-up': return 'text-emerald-400';
    case 'Short Build-up': return 'text-red-400';
    case 'Long Unwinding': return 'text-yellow-400';
    case 'Short Covering': return 'text-blue-400';
    default: return 'text-muted-foreground';
  }
}

function VIXCard({ vix }: { vix: VIXData | null }) {
  if (!vix) return <Card className="border-border/50"><CardContent className="p-4"><span className="text-muted-foreground text-sm">Loading VIX...</span></CardContent></Card>;

  const statusColors: Record<string, string> = {
    low: 'bg-emerald-500/20 text-emerald-400',
    normal: 'bg-emerald-500/20 text-emerald-400',
    elevated: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-orange-500/20 text-orange-400',
    extreme: 'bg-red-500/20 text-red-400',
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4 text-yellow-500" />
          India VIX
          <Badge variant="secondary" className={`text-[10px] ${statusColors[vix.status]}`}>
            {vix.status.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-mono font-bold text-yellow-500">{vix.value.toFixed(2)}</span>
          <span className={`text-sm font-mono ${vix.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {vix.change >= 0 ? '+' : ''}{vix.change.toFixed(2)} ({vix.changePct >= 0 ? '+' : ''}{vix.changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground font-mono">
          <span>H: {vix.dayHigh.toFixed(2)}</span>
          <span>L: {vix.dayLow.toFixed(2)}</span>
          <span>O: {vix.open.toFixed(2)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function IndexCard({ data }: { data: InstrumentData }) {
  const isUp = data.change >= 0;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-sm font-medium">{data.name}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-mono font-bold">{data.ltp.toFixed(2)}</span>
          <span className={`text-sm font-mono flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isUp ? '+' : ''}{data.change.toFixed(2)} ({isUp ? '+' : ''}{data.changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="flex gap-3 mt-1 text-xs font-mono">
          <span className="text-muted-foreground">PCR: <span className={data.pcr > 1 ? 'text-emerald-400' : 'text-red-400'}>{data.pcr.toFixed(2)}</span></span>
          <span className="text-muted-foreground">MaxPain: <span className="text-yellow-400">{data.maxPain}</span></span>
          <span className="text-muted-foreground">Fut OI: <span className="text-blue-400">{formatNumber(data.futuresOI)}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionChainTable({ strikes, atmStrike }: { strikes: OptionStrike[]; atmStrike: number }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium">Option Chain — ATM {atmStrike}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-72">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="w-14 text-center p-1">C OI Chg</TableHead>
                <TableHead className="w-14 text-center p-1">C OI</TableHead>
                <TableHead className="w-14 text-center p-1">C LTP</TableHead>
                <TableHead className="w-14 text-center p-1">C IV</TableHead>
                <TableHead className="w-16 text-center p-1 font-bold">Strike</TableHead>
                <TableHead className="w-14 text-center p-1">P IV</TableHead>
                <TableHead className="w-14 text-center p-1">P LTP</TableHead>
                <TableHead className="w-14 text-center p-1">P OI</TableHead>
                <TableHead className="w-14 text-center p-1">P OI Chg</TableHead>
                <TableHead className="w-20 text-center p-1">Build-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strikes.map((s) => {
                const isATM = s.strike === atmStrike;
                const isITMCall = s.strike < atmStrike;
                const isITMPut = s.strike > atmStrike;
                return (
                  <TableRow key={s.strike} className={`text-[10px] font-mono ${isATM ? 'bg-yellow-500/10' : ''}`}>
                    <TableCell className={`text-center p-1 ${s.callOIChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatNumber(s.callOIChange)}
                    </TableCell>
                    <TableCell className={`text-center p-1 ${isITMCall ? 'bg-emerald-500/5' : ''}`}>
                      {formatNumber(s.callOI)}
                    </TableCell>
                    <TableCell className="text-center p-1">{s.callLTP.toFixed(1)}</TableCell>
                    <TableCell className="text-center p-1 text-muted-foreground">{s.callIV.toFixed(1)}</TableCell>
                    <TableCell className={`text-center p-1 font-bold ${isATM ? 'text-yellow-400' : ''}`}>{s.strike}</TableCell>
                    <TableCell className="text-center p-1 text-muted-foreground">{s.putIV.toFixed(1)}</TableCell>
                    <TableCell className="text-center p-1">{s.putLTP.toFixed(1)}</TableCell>
                    <TableCell className={`text-center p-1 ${isITMPut ? 'bg-red-500/5' : ''}`}>
                      {formatNumber(s.putOI)}
                    </TableCell>
                    <TableCell className={`text-center p-1 ${s.putOIChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatNumber(s.putOIChange)}
                    </TableCell>
                    <TableCell className={`text-center p-1 ${builtUpColor(s.builtUpType)}`}>
                      {s.builtUpType !== 'None' ? s.builtUpType : '—'}
                    </TableCell>
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

function StockQuickView({ instruments }: { instruments: InstrumentData[] }) {
  const stocks = instruments.filter((i) => i.type === 'STOCK');
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium">Top Stocks Quick View</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ScrollArea className="max-h-48">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {stocks.map((s) => {
              const isUp = s.change >= 0;
              return (
                <div key={s.symbol} className="flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono hover:bg-muted/30">
                  <span className="font-semibold truncate">{s.symbol}</span>
                  <span className="ml-2">{s.ltp.toFixed(1)}</span>
                  <span className={`ml-2 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isUp ? '+' : ''}{s.changePct.toFixed(2)}%
                  </span>
                  <span className={`ml-1 ${s.pcr > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    PCR:{s.pcr.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function LiveMonitor() {
  const { instruments, setInstruments, vix, setVix, setLastRefresh, refreshInterval } = useStore();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dataRes, vixRes] = await Promise.all([
        fetch('/api/data'),
        fetch('/api/vix'),
      ]);
      const dataJson = await dataRes.json();
      const vixJson = await vixRes.json();

      if (dataJson.instruments) setInstruments(dataJson.instruments);
      if (vixJson.vix) setVix(vixJson.vix);
      setLastRefresh(new Date());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [setInstruments, setVix, setLastRefresh]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  const indices = instruments.filter((i) => i.type === 'INDEX');
  const selectedInstr = instruments.find((i) => i.symbol === useStore.getState().selectedInstrument) || indices[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live Market Monitor</h2>
        <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* VIX Card */}
      <VIXCard vix={vix} />

      {/* Index Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {indices.map((idx) => (
          <IndexCard key={idx.symbol} data={idx} />
        ))}
      </div>

      {/* Option Chain */}
      {selectedInstr && (
        <OptionChainTable strikes={selectedInstr.strikes} atmStrike={selectedInstr.atmStrike} />
      )}

      {/* Stock Quick View */}
      <StockQuickView instruments={instruments} />
    </div>
  );
}
