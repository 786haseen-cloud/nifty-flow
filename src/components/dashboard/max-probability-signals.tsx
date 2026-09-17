'use client';

/**
 * Max Probability Signals — TWO hero cards answering exactly one question:
 *
 *   "If I MUST buy a call right now, WHICH one has the maximum probability?"
 *   "If I MUST buy a put right now, WHICH one has the maximum probability?"
 *
 * Born from the 500-point fall (Sep 2026) where the fired-direction engine
 * showed WAIT everywhere: structure factors lagged the downtrend while flow
 * factors screamed bearish — so no PUT ever reached its band. This panel
 * ranks BOTH directions independently across all 19 symbols using the
 * dual-lens probability model (computeMaxProbabilitySignals in
 * magnet-engine.ts): structure lens (13-factor score vs asymmetric bands)
 * + flow lens (footprint / basis / participant bias / VIX / OI buildup).
 *
 * Honesty contract: a candidate is ALWAYS shown per direction, but its tier
 * label (ELITE / HIGH / MODERATE / LEAN / NO EDGE) tells the truth — and a
 * gated/divergent candidate is flagged instead of hidden.
 *
 * Layout:
 *  ┌─────────────────────────────┐  ┌─────────────────────────────┐
 *  │ STRONGEST CALL BUY          │  │ STRONGEST PUT BUY           │
 *  │  NIFTY  ·  74% ELITE        │  │  BANKNIFTY  ·  61% MODERATE │
 *  │  [ring]  Engine + flow OK   │  │  [ring]  Flow aligned       │
 *  │  Structure ██ 68%           │  │  Structure █░ 29%           │
 *  │  Flow     ██ 81%            │  │  Flow    ██ 83%             │
 *  │  • footprint −3 (bear)      │  │  • footprint −3 (+12.6pts)  │
 *  │  • basis −0.20% discount    │  │  • VIX +8% (+6.3pts)        │
 *  │  Strike 24,950 → 25,100/SL  │  │  ...                        │
 *  └─────────────────────────────┘  └─────────────────────────────┘
 */

import { useMemo } from 'react';
import {
  ArrowUpCircle, ArrowDownCircle, Zap, Target, ShieldAlert, Flame,
  CircleDot, Clock3, type LucideIcon,
} from 'lucide-react';
import {
  computeMaxProbabilitySignals,
  type MagnetResult,
  type MaxProbSignal,
  type MaxProbTier,
} from '@/lib/magnet-engine';

// ─── Direction styling (mirrors SignalBanner conventions) ───

const DIR_STYLE = {
  CALL: {
    label: 'STRONGEST CALL BUY',
    color: '#10b981',
    text: 'text-emerald-300',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/[0.04]',
    chipBg: 'bg-emerald-500/15',
    barFill: 'bg-emerald-500',
    icon: ArrowUpCircle,
  },
  PUT: {
    label: 'STRONGEST PUT BUY',
    color: '#ef4444',
    text: 'text-red-300',
    border: 'border-red-500/40',
    bg: 'bg-red-500/[0.04]',
    chipBg: 'bg-red-500/15',
    barFill: 'bg-red-500',
    icon: ArrowDownCircle,
  },
} as const;

const TIER_STYLE: Record<MaxProbTier, { cls: string; hint: string }> = {
  'ELITE':    { cls: 'bg-amber-400/20 text-amber-200 border-amber-300/50',       hint: 'rare — everything aligned' },
  'HIGH':     { cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40', hint: 'takeable setup' },
  'MODERATE': { cls: 'bg-sky-500/15 text-sky-200 border-sky-400/40',             hint: 'tradeable with size control' },
  'LEAN':     { cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/30',          hint: 'slight edge only' },
  'NO EDGE':  { cls: 'bg-zinc-700/30 text-zinc-400 border-zinc-500/30',          hint: 'below coin-flip — watch, don\u2019t trade' },
};

function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtSigned1(v: number): string {
  if (!isFinite(v)) return '0';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
}

// ─── Probability ring gauge ───

function ProbRing({ probability, color, dim }: { probability: number; color: string; dim: boolean }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const filled = Math.max(0, Math.min(100, probability)) / 100 * C;
  const stroke = dim ? '#52525b' : color;

  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="#3f3f4650" strokeWidth="7" />
        <circle
          cx="38" cy="38" r={R} fill="none" stroke={stroke} strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${C}`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold leading-none ${dim ? 'text-zinc-400' : 'text-foreground'}`}>
          {Math.round(probability)}%
        </span>
        <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">prob</span>
      </div>
    </div>
  );
}

// ─── Lens mini-bar ───

function LensBar({ label, value, fillClass }: { label: string; value: number; fillClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[10px] text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-700/40 overflow-hidden">
        <div
          className={`h-full rounded-full ${fillClass} transition-all duration-700`}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-8 text-[10px] font-semibold text-right">{Math.round(value)}%</span>
    </div>
  );
}

// ─── Status chip ───

function StatusChip({ icon: Icon, text, cls }: { icon: LucideIcon; text: string; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {text}
    </span>
  );
}

// ─── One candidate card ───

function MaxProbCard({ sig }: { sig: MaxProbSignal }) {
  const S = DIR_STYLE[sig.direction];
  const Icon = S.icon;
  const noEdge = sig.tier === 'NO EDGE';
  const tier = TIER_STYLE[sig.tier];

  return (
    <div className={`relative rounded-xl border p-3 ${S.border} ${S.bg} ${noEdge ? 'opacity-70' : ''}`}>
      {/* Header: label + type */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-4 w-4 ${S.text}`} />
          <span className={`text-[11px] font-bold tracking-wider ${S.text}`}>{S.label}</span>
        </div>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          {sig.type === 'index' ? 'INDEX' : 'STOCK'}
        </span>
      </div>

      {/* Symbol + probability ring */}
      <div className="flex items-center gap-3">
        <ProbRing probability={sig.probability} color={S.color} dim={noEdge} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-bold leading-tight">{sig.symbol}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-bold ${tier.cls}`} title={tier.hint}>
              {sig.tier}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            Spot {fmtNum(sig.spot)} · engine score {fmtSigned1(sig.score)}
          </div>
          {/* Status chips */}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {sig.gated && (
              <StatusChip icon={ShieldAlert} text="GATED — FLOW OPPOSES" cls="border-amber-400/50 bg-amber-400/10 text-amber-300" />
            )}
            {!sig.gated && sig.alignment === 'aligned' && (
              <StatusChip icon={Flame} text="FLOW ALIGNED" cls="border-emerald-400/40 bg-emerald-400/10 text-emerald-300" />
            )}
            {!sig.gated && sig.alignment === 'divergent' && (
              <StatusChip icon={ShieldAlert} text="FLOW DIVERGENT" cls="border-amber-400/50 bg-amber-400/10 text-amber-300" />
            )}
            {sig.engineFired && (
              <StatusChip icon={Zap} text="ENGINE FIRED" cls={`${S.border} ${S.chipBg} ${S.text}`} />
            )}
            {sig.alignment === 'neutral' && !sig.engineFired && (
              <StatusChip icon={CircleDot} text="FLOW NEUTRAL" cls="border-zinc-500/40 bg-zinc-500/10 text-zinc-300" />
            )}
          </div>
        </div>
      </div>

      {/* Dual lens bars */}
      <div className="mt-2.5 space-y-1.5">
        <LensBar label="Structure" value={sig.structureProb} fillClass={sig.structureProb >= 50 ? S.barFill : 'bg-zinc-500'} />
        <LensBar label="Flow" value={sig.flowProb} fillClass={sig.flowProb >= 50 ? S.barFill : 'bg-zinc-500'} />
      </div>

      {/* Top drivers */}
      <div className="mt-2 space-y-1">
        {sig.drivers.slice(0, 3).map((d, i) => (
          <div key={`${d.label}-${i}`} className="flex items-start justify-between gap-2 text-[10px]">
            <span className="min-w-0">
              <span className="font-medium">{d.label}</span>
              <span className="text-muted-foreground"> — {d.detail}</span>
            </span>
            <span className={`shrink-0 font-mono font-semibold ${d.points >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {d.points >= 0 ? '+' : ''}{d.points.toFixed(1)}pt
            </span>
          </div>
        ))}
      </div>

      {/* Trade plan */}
      <div className="mt-2 pt-2 border-t border-border/40 grid grid-cols-4 gap-1 text-center">
        <div>
          <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Strike</div>
          <div className="text-[11px] font-semibold">{fmtNum(sig.strike)}</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Target</div>
          <div className="text-[11px] font-semibold text-emerald-300">{fmtNum(sig.target)}</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Stop</div>
          <div className="text-[11px] font-semibold text-red-300">{fmtNum(sig.stop)}</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-0.5">
            <Clock3 className="h-2 w-2" />Timing
          </div>
          <div className="text-[11px] font-semibold">{sig.timing}</div>
        </div>
      </div>

      {/* Recommendation + runner-up */}
      <div className={`mt-2 text-[10px] leading-snug ${noEdge ? 'text-zinc-400' : 'text-foreground/80'}`}>
        <Target className="h-2.5 w-2.5 inline mr-1 -mt-0.5" />
        {sig.notes}
      </div>
      {sig.runnerUp && (
        <div className="mt-1 text-[9px] text-muted-foreground">
          Next best: <span className="font-medium text-foreground/70">{sig.runnerUp.symbol}</span> ({sig.runnerUp.probability}%)
        </div>
      )}
    </div>
  );
}

// ─── Panel ───

export function MaxProbabilitySignals({ symbols }: { symbols: MagnetResult[] }) {
  const result = useMemo(() => computeMaxProbabilitySignals(symbols), [symbols]);

  if (!result.call && !result.put) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <Zap className="h-4 w-4 text-amber-400" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
          Max-Probability Signals
        </h4>
        <span className="text-[10px] text-muted-foreground">
          best CALL BUY vs best PUT BUY across all 19 — dual-lens probability (structure 50% + live flow 50%)
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {result.call && <MaxProbCard sig={result.call} />}
        {result.put && <MaxProbCard sig={result.put} />}
      </div>
    </div>
  );
}
