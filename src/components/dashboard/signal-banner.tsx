'use client';

/**
 * Signal Banner — the BIG hero element at the top of the Magnet & Gamma
 * Dashboard.
 *
 * Shows the aggregate market signal (BUY CALL / BUY PUT / WAIT) computed
 * across all 4 indices (weighted 3×) and 15 stocks (weighted 1×).
 *
 * Layout:
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  ┌──────────┐  MARKET SIGNAL                                     │
 *  │  │   BUY    │  ▲ CALL ▲  STRONG  •  Confidence: 78%              │
 *  │  │   CALL   │  ────────────────────────────────────              │
 *  │  └──────────┘  Top bull: NIFTY (STRONG, +7.2)                    │
 *  │                12 bull / 4 bear / 3 wait                         │
 *  │                ──────────────                                    │
 *  │                Notes: Charm-aligned entry, 1:30-3:30 window...   │
 *  └──────────────────────────────────────────────────────────────────┘
 */

import { useMemo } from 'react';
import {
  ArrowUpCircle, ArrowDownCircle, CircleSlash, Zap, Activity,
  type LucideIcon,
} from 'lucide-react';
import {
  computeAggregateSignal,
  type MagnetResult,
  type SignalResult,
  type SignalDirection,
} from '@/lib/magnet-engine';

// ─── Helpers ───

function fmtNum(v: number, digits = 0): string {
  if (!isFinite(v) || v === 0) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtSigned(v: number, digits = 1): string {
  if (!isFinite(v) || v === 0) return '0';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

// ─── Signal chip (used inline for small displays) ───

const SIGNAL_CONFIG: Record<SignalDirection, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: LucideIcon;
  glow: string;
}> = {
  CALL: {
    label: 'BUY CALL',
    color: '#10b981',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/50',
    icon: ArrowUpCircle,
    glow: 'shadow-[0_0_30px_-5px_rgba(16,185,129,0.4)]',
  },
  PUT: {
    label: 'BUY PUT',
    color: '#ef4444',
    bg: 'bg-red-500/15',
    border: 'border-red-500/50',
    icon: ArrowDownCircle,
    glow: 'shadow-[0_0_30px_-5px_rgba(239,68,68,0.4)]',
  },
  WAIT: {
    label: 'WAIT',
    color: '#a1a1aa',
    bg: 'bg-zinc-500/15',
    border: 'border-zinc-500/50',
    icon: CircleSlash,
    glow: '',
  },
};

export function SignalChip({ signal, size = 'sm' }: { signal: SignalResult; size?: 'sm' | 'xs' }) {
  const cfg = SIGNAL_CONFIG[signal.direction];
  const Icon = cfg.icon;
  const sizeClasses = size === 'xs'
    ? 'text-[9px] px-1.5 py-0.5 gap-0.5'
    : 'text-[10px] px-2 py-1 gap-1';

  return (
    <span
      className={`inline-flex items-center rounded-md border ${cfg.border} ${cfg.bg} ${cfg.color} ${sizeClasses} font-bold tracking-wide`}
    >
      <Icon className={size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {cfg.label}
      {signal.strength !== 'NONE' && signal.strength !== 'WEAK' && (
        <span className="opacity-70 ml-0.5">{signal.strength[0]}</span>
      )}
    </span>
  );
}

// ─── Strength meter ───

function StrengthMeter({ strength, direction }: { strength: SignalResult['strength']; direction: SignalDirection }) {
  const cfg = SIGNAL_CONFIG[direction];
  const levels: SignalResult['strength'][] = ['WEAK', 'MODERATE', 'STRONG'];
  const activeIdx = levels.indexOf(strength);
  if (activeIdx < 0) return null;

  return (
    <div className="flex items-center gap-1">
      {levels.map((lvl, i) => (
        <div
          key={lvl}
          className="h-1 w-6 rounded-full transition-all"
          style={{
            backgroundColor: i <= activeIdx ? cfg.color : '#3f3f4640',
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Signal Banner ───

export function SignalBanner({ symbols }: { symbols: MagnetResult[] }) {
  const agg = useMemo(() => computeAggregateSignal(symbols), [symbols]);
  const cfg = SIGNAL_CONFIG[agg.direction];
  const Icon = cfg.icon;

  // Find top bull/bear signals for detail display
  const topBullSignal = symbols
    .filter(s => s.signal.direction === 'CALL')
    .sort((a, b) => b.signal.score - a.signal.score)[0];
  const topBearSignal = symbols
    .filter(s => s.signal.direction === 'PUT')
    .sort((a, b) => a.signal.score - b.signal.score)[0];

  return (
    <div className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} ${cfg.glow} p-4 transition-all`}>
      <div className="flex items-start gap-4 flex-wrap">
        {/* Big icon + label */}
        <div className="flex items-center gap-3 min-w-[180px]">
          <div
            className="rounded-xl p-3 flex items-center justify-center"
            style={{ backgroundColor: `${cfg.color}20` }}
          >
            <Icon className="h-10 w-10" style={{ color: cfg.color }} />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Market Signal</div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: cfg.color }}>
              {cfg.label}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StrengthMeter strength={agg.strength} direction={agg.direction} />
              <span className="text-[10px] font-mono text-muted-foreground">{agg.strength}</span>
            </div>
          </div>
        </div>

        {/* Score + confidence */}
        <div className="flex flex-col gap-1.5 min-w-[140px]">
          <div className="flex items-baseline gap-1">
            <span className="text-[10px] text-muted-foreground uppercase">Score</span>
            <span className="text-xl font-mono font-bold" style={{ color: cfg.color }}>
              {fmtSigned(agg.score, 1)}
            </span>
            <span className="text-[9px] text-muted-foreground">/±25</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-[10px] text-muted-foreground uppercase">Confidence</span>
            <span className="text-xl font-mono font-bold" style={{ color: cfg.color }}>
              {agg.confidence}%
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {agg.bullCount} bull · {agg.bearCount} bear · {agg.waitCount} wait
          </div>
        </div>

        {/* Top movers */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Plays</div>
          {topBullSignal && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <ArrowUpCircle className="h-3 w-3 text-emerald-400" />
              <span className="font-mono font-semibold text-emerald-400">{topBullSignal.symbol}</span>
              <span className="text-muted-foreground">
                {fmtSigned(topBullSignal.signal.score, 1)} ({topBullSignal.signal.strength.toLowerCase()})
              </span>
            </div>
          )}
          {topBearSignal && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <ArrowDownCircle className="h-3 w-3 text-red-400" />
              <span className="font-mono font-semibold text-red-400">{topBearSignal.symbol}</span>
              <span className="text-muted-foreground">
                {fmtSigned(topBearSignal.signal.score, 1)} ({topBearSignal.signal.strength.toLowerCase()})
              </span>
            </div>
          )}
          {!topBullSignal && !topBearSignal && (
            <div className="text-[10px] text-muted-foreground italic">No directional signals</div>
          )}
        </div>

        {/* Notes / action plan */}
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Action Plan</div>
          <div className="text-[11px] text-foreground/90 leading-relaxed">
            {agg.notes}
          </div>
          {agg.direction !== 'WAIT' && topBullSignal && agg.direction === 'CALL' && (
            <TradePlan signal={topBullSignal.signal} symbol={topBullSignal.symbol} spot={topBullSignal.spot} />
          )}
          {agg.direction !== 'WAIT' && topBearSignal && agg.direction === 'PUT' && (
            <TradePlan signal={topBearSignal.signal} symbol={topBearSignal.symbol} spot={topBearSignal.spot} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trade Plan mini-panel ───

function TradePlan({ signal, symbol, spot }: { signal: SignalResult; symbol: string; spot: number }) {
  const cfg = SIGNAL_CONFIG[signal.direction];
  const Icon = signal.timing === 'AFTERNOON' ? Activity : Zap;

  return (
    <div className="mt-2 pt-2 border-t border-border/30 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
      <div>
        <div className="text-muted-foreground uppercase text-[9px]">Entry Strike</div>
        <div className="font-mono font-bold" style={{ color: cfg.color }}>
          {symbol} {signal.direction === 'CALL' ? 'CE' : 'PE'} {fmtNum(signal.suggestedStrike)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground uppercase text-[9px]">Target</div>
        <div className="font-mono font-semibold">{fmtNum(signal.suggestedTarget)}</div>
      </div>
      <div>
        <div className="text-muted-foreground uppercase text-[9px]">Stop Loss</div>
        <div className="font-mono font-semibold text-red-300">{fmtNum(signal.suggestedStop)}</div>
      </div>
      <div>
        <div className="text-muted-foreground uppercase text-[9px]">Timing</div>
        <div className="flex items-center gap-1 font-mono font-semibold">
          <Icon className="h-2.5 w-2.5" />
          {signal.timing}
        </div>
      </div>
      {signal.notes && (
        <div className="col-span-2 sm:col-span-4 text-[10px] text-muted-foreground italic leading-relaxed">
          {signal.notes}
        </div>
      )}
    </div>
  );
}

// ─── Per-card reasons tooltip (for the per-symbol signal chip) ───

export function SignalReasonsTooltip({ signal }: { signal: SignalResult }) {
  if (!signal || signal.direction === 'WAIT') {
    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-[10px] max-w-[240px]">
        <div className="font-semibold text-muted-foreground mb-1">No Signal</div>
        <div className="text-muted-foreground">{signal?.notes || 'Signals mixed.'}</div>
      </div>
    );
  }

  const cfg = SIGNAL_CONFIG[signal.direction];
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-[10px] max-w-[320px]">
      <div className="font-bold mb-1" style={{ color: cfg.color }}>
        {cfg.label} · {signal.strength} · {signal.confidence}% confidence
      </div>
      <div className="text-[9px] text-muted-foreground mb-1.5">
        Score: {fmtSigned(signal.score, 1)} | Strike: {fmtNum(signal.suggestedStrike)} | Tgt: {fmtNum(signal.suggestedTarget)} | SL: {fmtNum(signal.suggestedStop)}
      </div>
      <div className="space-y-0.5">
        {signal.reasons
          .filter(r => r.weight !== 0)
          .slice(0, 11)
          .map((r, i) => (
            <div key={i} className="flex items-start gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{
                  backgroundColor: r.direction === 'bull' ? '#10b981' : r.direction === 'bear' ? '#ef4444' : '#a1a1aa'
                }}
              />
              <div>
                <span className="font-semibold">{r.factor}:</span>{' '}
                <span className="text-muted-foreground">{r.detail}</span>{' '}
                <span className="font-mono" style={{
                  color: r.direction === 'bull' ? '#10b981' : r.direction === 'bear' ? '#ef4444' : '#a1a1aa'
                }}>
                  ({fmtSigned(r.weight, 1)})
                </span>
              </div>
            </div>
          ))}
      </div>
      {signal.notes && (
        <div className="mt-1.5 pt-1.5 border-t border-border/30 text-[9px] italic text-muted-foreground">
          {signal.notes}
        </div>
      )}
    </div>
  );
}
