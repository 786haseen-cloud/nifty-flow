'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Plus, X, CheckCircle, BookOpen, Target, Trophy,
  TrendingUp, TrendingDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────

interface Trade {
  id: string;
  symbol: string;
  direction: string;
  strike: number | null;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  target: number;
  reason: string;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  pnl?: number;
  status: 'open' | 'closed';
}

interface Signal {
  id: string;
  time: string;
  symbol: string;
  signal: string;
  confidence: string;
  result: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const SYMBOLS = [
  'NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'RELIANCE', 'TCS',
  'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'SBIN', 'BHARTIARTL',
  'ITC', 'KOTAKBANK', 'LT', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TATAMOTORS',
];

const DIRECTIONS = [
  'BUY CE', 'SELL CE', 'BUY PE', 'SELL PE', 'BUY FUTURE', 'SELL FUTURE',
];

const LOT_SIZES: Record<string, number> = {
  NIFTY: 75, BANKNIFTY: 30, SENSEX: 10, FINNIFTY: 50, RELIANCE: 250,
  TCS: 150, HDFCBANK: 550, INFY: 600, ICICIBANK: 700, HINDUNILVR: 300,
  SBIN: 1500, BHARTIARTL: 475, ITC: 1600, KOTAKBANK: 400, LT: 150,
  AXISBANK: 900, BAJFINANCE: 125, MARUTI: 50, TATAMOTORS: 2250,
};

const TABS = ['New Trade', 'Open', 'History', 'Signals'] as const;
type Tab = (typeof TABS)[number];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2) + ' L';
  return sign + '₹' + abs.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function isSell(dir: string) {
  return dir.startsWith('SELL');
}

function calcPnl(t: Trade, exitPrice: number): number {
  const lot = LOT_SIZES[t.symbol] ?? 1;
  const mult = isSell(t.direction) ? -1 : 1;
  return (exitPrice - t.entryPrice) * t.quantity * lot * mult;
}

// ─── Shared styles ────────────────────────────────────────────────────

const INPUT_CLS =
  'bg-background border border-border/30 rounded px-2 py-1.5 text-xs w-full outline-none focus:border-primary/60';
const CARD_CLS = 'bg-card border border-border/30 rounded-lg p-3';
const TH_CLS = 'text-left px-2 py-1.5 text-[11px] font-medium text-muted-foreground bg-muted/30';
const TD_CLS = 'px-2 py-1.5 text-xs';
const pnlCls = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

// ─── Stat Card (extracted to avoid creating components during render) ──

function StatCard({ label, value, icon: Icon, raw }: {
  label: string; value: string; icon: React.ElementType; raw?: number;
}) {
  return (
    <div className={CARD_CLS}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className={`text-sm font-semibold ${raw !== undefined ? pnlCls(raw) : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────

export default function JournalTab() {
  const [tab, setTab] = useState<Tab>('New Trade');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState('');
  const [signalResultId, setSignalResultId] = useState<string | null>(null);
  const [signalResultInput, setSignalResultInput] = useState('');

  // ── Form state ──
  const [form, setForm] = useState({
    symbol: 'NIFTY', direction: 'BUY CE', strike: '', entryPrice: '',
    quantity: '1', stopLoss: '', target: '', reason: '',
  });

  // ── Persistence (sync from external store on mount) ──
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem('journal-trades');
        if (raw) setTrades(JSON.parse(raw));
      } catch { /* ignore */ }
      try {
        const raw = localStorage.getItem('signal-backtest-log');
        if (raw) setSignals(JSON.parse(raw));
      } catch { /* ignore */ }
    });
  }, []);

  const saveTrades = useCallback((t: Trade[]) => {
    setTrades(t);
    localStorage.setItem('journal-trades', JSON.stringify(t));
  }, []);

  const saveSignals = useCallback((s: Signal[]) => {
    setSignals(s);
    localStorage.setItem('signal-backtest-log', JSON.stringify(s));
  }, []);

  // ── Submit trade ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trade: Trade = {
      id: uid(),
      symbol: form.symbol,
      direction: form.direction,
      strike: form.strike ? Number(form.strike) : null,
      entryPrice: Number(form.entryPrice),
      quantity: Number(form.quantity),
      stopLoss: Number(form.stopLoss),
      target: Number(form.target),
      reason: form.reason,
      entryTime: new Date().toISOString(),
      status: 'open',
    };
    saveTrades([trade, ...trades]);
    setForm({
      symbol: 'NIFTY', direction: 'BUY CE', strike: '', entryPrice: '',
      quantity: '1', stopLoss: '', target: '', reason: '',
    });
  };

  // ── Close trade ──
  const confirmClose = (trade: Trade) => {
    const exitPrice = Number(exitPriceInput);
    if (!exitPrice || exitPrice <= 0) return;
    const updated = trades.map((t) => {
      if (t.id !== trade.id) return t;
      return {
        ...t, status: 'closed' as const, exitPrice,
        exitTime: new Date().toISOString(), pnl: calcPnl(t, exitPrice),
      };
    });
    saveTrades(updated);
    setClosingId(null);
    setExitPriceInput('');
  };

  // ── Signal result ──
  const saveSignalResult = (id: string) => {
    if (!signalResultInput.trim()) return;
    saveSignals(signals.map((s) => s.id === id ? { ...s, result: signalResultInput } : s));
    setSignalResultId(null);
    setSignalResultInput('');
  };

  // ── Derived data ──
  const openTrades = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => t.status === 'closed');

  const stats = {
    total: closedTrades.length,
    wins: closedTrades.filter((t) => (t.pnl ?? 0) > 0).length,
    winRate: closedTrades.length
      ? ((closedTrades.filter((t) => (t.pnl ?? 0) > 0).length / closedTrades.length) * 100).toFixed(1)
      : '0.0',
    avgPnl: closedTrades.length
      ? closedTrades.reduce((a, t) => a + (t.pnl ?? 0), 0) / closedTrades.length
      : 0,
    totalPnl: closedTrades.reduce((a, t) => a + (t.pnl ?? 0), 0),
    best: closedTrades.length
      ? Math.max(...closedTrades.map((t) => t.pnl ?? 0))
      : 0,
    worst: closedTrades.length
      ? Math.min(...closedTrades.map((t) => t.pnl ?? 0))
      : 0,
  };

  // ─── Render functions (not components) ──────────────────────────────

  const renderNewTrade = (): ReactNode => (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Symbol</label>
          <select
            value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            className={INPUT_CLS}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Direction</label>
          <select
            value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}
            className={INPUT_CLS}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">
            Strike <span className="text-muted-foreground/60">(opt)</span>
          </label>
          <input
            type="number" placeholder="e.g. 24500"
            value={form.strike} onChange={(e) => setForm({ ...form, strike: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Entry Price</label>
          <input
            type="number" step="0.05" placeholder="0.00" required
            value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">
            Quantity <span className="text-muted-foreground/60">(lots × {LOT_SIZES[form.symbol] ?? 1})</span>
          </label>
          <input
            type="number" min="1" placeholder="1" required
            value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Stop Loss</label>
          <input
            type="number" step="0.05" placeholder="0.00" required
            value={form.stopLoss} onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Target</label>
          <input
            type="number" step="0.05" placeholder="0.00" required
            value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-muted-foreground mb-1 block">Reason / Notes</label>
          <input
            type="text" placeholder="Why did you take this trade?"
            value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
      </div>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium rounded px-3 py-1.5 hover:bg-primary/90 transition"
      >
        <Plus className="h-3.5 w-3.5" /> Add Trade
      </button>
    </form>
  );

  const renderOpen = (): ReactNode => {
    if (openTrades.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <BookOpen className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-xs">No open trades yet. Add one from the New Trade tab.</p>
        </div>
      );
    }
    return (
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={TH_CLS}>Time</th>
              <th className={TH_CLS}>Symbol</th>
              <th className={TH_CLS}>Dir</th>
              <th className={TH_CLS}>Strike</th>
              <th className={TH_CLS}>Entry</th>
              <th className={TH_CLS}>Lots</th>
              <th className={TH_CLS}>SL</th>
              <th className={TH_CLS}>Target</th>
              <th className={TH_CLS}>Reason</th>
              <th className={TH_CLS}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {openTrades.map((t) => (
              <tr key={t.id} className="hover:bg-muted/10 transition">
                <td className={TD_CLS + ' whitespace-nowrap'}>{fmtTime(t.entryTime)}</td>
                <td className={TD_CLS + ' font-medium'}>{t.symbol}</td>
                <td className={TD_CLS}>
                  <span className={t.direction.startsWith('BUY') ? 'text-emerald-400' : 'text-red-400'}>
                    {t.direction}
                  </span>
                </td>
                <td className={TD_CLS}>{t.strike ?? '—'}</td>
                <td className={TD_CLS}>₹{t.entryPrice}</td>
                <td className={TD_CLS}>{t.quantity}</td>
                <td className={TD_CLS + ' text-red-400'}>₹{t.stopLoss}</td>
                <td className={TD_CLS + ' text-emerald-400'}>₹{t.target}</td>
                <td className={TD_CLS + ' max-w-[120px] truncate'} title={t.reason}>{t.reason || '—'}</td>
                <td className={TD_CLS}>
                  {closingId === t.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="0.05" placeholder="Exit ₹"
                        value={exitPriceInput}
                        onChange={(e) => setExitPriceInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmClose(t)}
                        className="w-16 bg-background border border-border/30 rounded px-1.5 py-1 text-xs outline-none"
                        autoFocus
                      />
                      <button onClick={() => confirmClose(t)} className="text-emerald-400 hover:text-emerald-300">
                        <CheckCircle className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => { setClosingId(null); setExitPriceInput(''); }} className="text-red-400 hover:text-red-300">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setClosingId(t.id); setExitPriceInput(''); }}
                      className="text-xs text-muted-foreground hover:text-foreground border border-border/30 rounded px-2 py-0.5 transition"
                    >
                      Close
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderHistory = (): ReactNode => {
    if (closedTrades.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Trophy className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-xs">No closed trades yet. Close a trade to see stats here.</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Trades" value={String(stats.total)} icon={BookOpen} />
          <StatCard label="Win Rate" value={stats.winRate + '%'} icon={Target} raw={Number(stats.winRate)} />
          <StatCard label="Avg P&L" value={fmtMoney(stats.avgPnl)} icon={TrendingUp} raw={stats.avgPnl} />
          <StatCard label="Total P&L" value={fmtMoney(stats.totalPnl)} icon={Trophy} raw={stats.totalPnl} />
          <StatCard label="Best Trade" value={fmtMoney(stats.best)} icon={TrendingUp} raw={stats.best} />
          <StatCard label="Worst Trade" value={fmtMoney(stats.worst)} icon={TrendingDown} raw={stats.worst} />
        </div>
        <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={TH_CLS}>Entry</th>
                <th className={TH_CLS}>Exit</th>
                <th className={TH_CLS}>Symbol</th>
                <th className={TH_CLS}>Dir</th>
                <th className={TH_CLS}>Strike</th>
                <th className={TH_CLS}>Entry ₹</th>
                <th className={TH_CLS}>Exit ₹</th>
                <th className={TH_CLS}>Lots</th>
                <th className={TH_CLS}>P&L</th>
                <th className={TH_CLS}>Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {closedTrades.map((t) => (
                <tr key={t.id} className="hover:bg-muted/10 transition">
                  <td className={TD_CLS + ' whitespace-nowrap'}>{fmtTime(t.entryTime)}</td>
                  <td className={TD_CLS + ' whitespace-nowrap'}>{t.exitTime ? fmtTime(t.exitTime) : '—'}</td>
                  <td className={TD_CLS + ' font-medium'}>{t.symbol}</td>
                  <td className={TD_CLS}>
                    <span className={t.direction.startsWith('BUY') ? 'text-emerald-400' : 'text-red-400'}>
                      {t.direction}
                    </span>
                  </td>
                  <td className={TD_CLS}>{t.strike ?? '—'}</td>
                  <td className={TD_CLS}>₹{t.entryPrice}</td>
                  <td className={TD_CLS}>₹{t.exitPrice ?? '—'}</td>
                  <td className={TD_CLS}>{t.quantity}</td>
                  <td className={TD_CLS + ' font-medium ' + pnlCls(t.pnl ?? 0)}>
                    {fmtMoney(t.pnl ?? 0)}
                  </td>
                  <td className={TD_CLS + ' max-w-[100px] truncate'} title={t.reason}>{t.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const addSignal = () => {
    saveSignals([
      { id: uid(), time: new Date().toISOString(), symbol: 'NIFTY', signal: 'BUY CE 24500', confidence: 'High', result: '' },
      ...signals,
    ]);
  };

  const renderSignals = (): ReactNode => {
    if (signals.length === 0) {
      return (
        <div className="space-y-3">
          <div className="flex items-start gap-2 bg-muted/20 border border-border/20 rounded-lg p-3">
            <Target className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground mb-0.5">Signal Backtesting</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Log your trading signals here and manually record results later to backtest your
                strategy accuracy. Add signals as they appear during market hours, then update
                outcomes once the trade plays out.
              </p>
            </div>
          </div>
          <button
            onClick={addSignal}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium rounded px-3 py-1.5 hover:bg-primary/90 transition"
          >
            <Plus className="h-3.5 w-3.5" /> Log Signal
          </button>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BookOpen className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">No signals logged yet. Start recording to build your backtest data.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-muted/20 border border-border/20 rounded-lg p-3">
          <Target className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground mb-0.5">Signal Backtesting</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Log your trading signals here and manually record results later to backtest your
              strategy accuracy. Add signals as they appear during market hours, then update
              outcomes once the trade plays out.
            </p>
          </div>
        </div>
        <button
          onClick={addSignal}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium rounded px-3 py-1.5 hover:bg-primary/90 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Log Signal
        </button>
        <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={TH_CLS}>Time</th>
                <th className={TH_CLS}>Symbol</th>
                <th className={TH_CLS}>Signal</th>
                <th className={TH_CLS}>Confidence</th>
                <th className={TH_CLS}>Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {signals.map((s) => (
                <tr key={s.id} className="hover:bg-muted/10 transition">
                  <td className={TD_CLS + ' whitespace-nowrap'}>{fmtTime(s.time)}</td>
                  <td className={TD_CLS + ' font-medium'}>{s.symbol}</td>
                  <td className={TD_CLS}>{s.signal}</td>
                  <td className={TD_CLS}>
                    <span className={
                      s.confidence === 'High'
                        ? 'text-emerald-400'
                        : s.confidence === 'Medium'
                          ? 'text-yellow-400'
                          : 'text-red-400'
                    }>
                      {s.confidence}
                    </span>
                  </td>
                  <td className={TD_CLS}>
                    {signalResultId === s.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text" placeholder="WIN / LOSS / PARTIAL"
                          value={signalResultInput}
                          onChange={(e) => setSignalResultInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveSignalResult(s.id)}
                          className="w-24 bg-background border border-border/30 rounded px-1.5 py-1 text-xs outline-none"
                          autoFocus
                        />
                        <button onClick={() => saveSignalResult(s.id)} className="text-emerald-400 hover:text-emerald-300">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => { setSignalResultId(null); setSignalResultInput(''); }} className="text-red-400 hover:text-red-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className={
                          s.result === 'WIN'
                            ? 'text-emerald-400'
                            : s.result === 'LOSS'
                              ? 'text-red-400'
                              : s.result
                                ? 'text-yellow-400'
                                : 'text-muted-foreground'
                        }>
                          {s.result || '—'}
                        </span>
                        <button
                          onClick={() => { setSignalResultId(s.id); setSignalResultInput(''); }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── Main render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-muted/20 rounded-lg p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition ${
              tab === t
                ? 'bg-card border border-border/30 text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className={CARD_CLS}>
        {tab === 'New Trade' && renderNewTrade()}
        {tab === 'Open' && renderOpen()}
        {tab === 'History' && renderHistory()}
        {tab === 'Signals' && renderSignals()}
      </div>
    </div>
  );
}
