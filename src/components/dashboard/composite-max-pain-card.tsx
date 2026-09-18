'use client';

/**
 * Composite Max Pain Magnet Card
 * ─────────────────────────────────────────────────────────────────────────
 * Aggregates (spot − maxPain) across all 4 indices + 15 F&O stocks into a
 * single OI-weighted pull number. Shows:
 *
 *   1. Reliability tier badge — auto-detected from IST expiry calendar
 *      (TIER 1 super-monthly / TIER 2 weekly / TIER 3 T-1 / TIER 4 drift)
 *   2. Twin bars — equal-weighted % pull (sentiment) vs OI-weighted % pull
 *      (real rupee-weighted magnetic pull)
 *   3. Indices vs Stocks ₹ Cr split — who is pulling which way
 *   4. Per-symbol breakdown table — sorted by |contributionCr| descending
 *
 * Card consumes the same /api/kite/max-pain-scan response that the existing
 * Max Pain Gravity Meter uses — no new API calls.
 *
 * Sign convention:
 *   maxPain > spot  → magnet pulls UP   → positive contribution
 *   maxPain < spot  → magnet pulls DOWN → negative contribution
 *   (i.e. composite pull sign = direction market will try to close toward)
 */

import { useMemo } from 'react';
import {
  Magnet,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  computeCompositeMaxPain,
  formatPullCr,
  formatPullPct,
  type MaxPainScanItem,
} from '@/lib/composite-max-pain';
import {
  getExpiryContext,
  shortExpirySummary,
  type MagnetStrength,
} from '@/lib/expiry-calendar';
import { istNow } from '@/lib/ist';

interface CompositeMaxPainCardProps {
  /** Per-symbol scan items from /api/kite/max-pain-scan */
  scanData: MaxPainScanItem[];
  /** True while the parent is fetching a fresh scan */
  loading: boolean;
  /** Optional error string from the parent fetch */
  error: string | null;
  /** Last-updated ISO timestamp (from parent) */
  lastUpdated: string | null;
  /** Manual refresh callback — reuses parent scan trigger */
  onRefresh: () => void;
}

const STRENGTH_COLORS: Record<MagnetStrength, { text: string; bg: string; border: string; bar: string }> = {
  STRONGEST: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', bar: '#22c55e' },
  STRONG:    { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', bar: '#22c55e' },
  BUILDING:  { text: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   bar: '#eab308' },
  WEAK:      { text: 'text-zinc-400',    bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    bar: '#71717a' },
};

export default function CompositeMaxPainCard({
  scanData,
  loading,
  error,
  lastUpdated,
  onRefresh,
}: CompositeMaxPainCardProps) {
  // ─── Compute composite + expiry context, memoized on scanData ───
  const { composite, expiry, computedAt } = useMemo(() => {
    const composite = computeCompositeMaxPain(scanData);
    const expiry = getExpiryContext(istNow());
    return { composite, expiry, computedAt: new Date().toISOString() };
  }, [scanData]);

  const strength = expiry.magnetStrength;
  const colors = STRENGTH_COLORS[strength];

  // Time-ago display
  let timeAgo = '';
  if (lastUpdated) {
    const ms = Date.now() - new Date(lastUpdated).getTime();
    if (ms < 60_000) timeAgo = `${Math.max(1, Math.floor(ms / 1000))}s ago`;
    else if (ms < 3_600_000) timeAgo = `${Math.floor(ms / 60_000)}m ago`;
    else timeAgo = `${Math.floor(ms / 3_600_000)}h ago`;
  }

  // ─── Empty / loading states ───
  if (scanData.length === 0 && !loading && !error) {
    return (
      <div className="bg-card border border-border/30 rounded-lg p-4">
        <Header
          loading={loading}
          onRefresh={onRefresh}
          timeAgo={timeAgo}
        />
        <div className="text-center py-6">
          <Magnet className="w-5 h-5 text-zinc-600 mx-auto mb-1.5" />
          <p className="text-[10px] text-zinc-500">
            Connect Kite API to see composite max pain magnet
          </p>
        </div>
      </div>
    );
  }

  if (loading && scanData.length === 0) {
    return (
      <div className="bg-card border border-border/30 rounded-lg p-4">
        <Header
          loading={loading}
          onRefresh={onRefresh}
          timeAgo={timeAgo}
        />
        <div className="text-center py-6">
          <RefreshCw className="w-5 h-5 text-zinc-600 animate-spin mx-auto mb-1.5" />
          <p className="text-[10px] text-zinc-500">
            Aggregating max pain across all 19 symbols...
          </p>
        </div>
      </div>
    );
  }

  if (error && scanData.length === 0) {
    return (
      <div className="bg-card border border-border/30 rounded-lg p-4">
        <Header
          loading={loading}
          onRefresh={onRefresh}
          timeAgo={timeAgo}
        />
        <div className="text-[10px] text-red-400/80">Composite scan error: {error}</div>
      </div>
    );
  }

  // ─── Bar widths (cap visualization at 1% for sanity; real values rarely exceed) ───
  const maxBarPct = 1.0; // 1% pull = full bar
  const equalW = Math.min(100, Math.abs(composite.equalWeightedPullPct) / maxBarPct * 100);
  const oiW = Math.min(100, Math.abs(composite.oiWeightedPullPct) / maxBarPct * 100);

  // Pull direction visual
  const isUp = composite.direction === 'UP';
  const isDown = composite.direction === 'DOWN';
  const dirIcon = isUp ? <TrendingUp className="w-4 h-4 text-emerald-400" />
    : isDown ? <TrendingDown className="w-4 h-4 text-red-400" />
    : <Minus className="w-4 h-4 text-zinc-400" />;
  const dirLabel = isUp ? 'PULL UP' : isDown ? 'PULL DOWN' : 'NEUTRAL';
  const dirColor = isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-zinc-400';

  return (
    <div className="bg-card border border-border/30 rounded-lg p-4">
      <Header
        loading={loading}
        onRefresh={onRefresh}
        timeAgo={timeAgo}
      />

      {/* ─── Tier + expiry badge ─── */}
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-3 ${colors.bg} border ${colors.border}`}>
        <Magnet className={`w-3.5 h-3.5 ${colors.text}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-semibold ${colors.text} leading-tight`}>
            {expiry.tierLabel}
          </div>
          <div className="text-[9px] text-zinc-400 leading-tight mt-0.5">
            {shortExpirySummary(expiry)} • magnet {strength.toLowerCase()}
          </div>
        </div>
        <div className={`text-[9px] px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} font-mono`}>
          T{expiry.tier}
        </div>
      </div>
      <p className="text-[9px] text-zinc-500 leading-relaxed mb-3 -mt-1">
        {expiry.tierDescription}
      </p>

      {/* ─── Big composite number ─── */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div>
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
            Composite Magnet
          </div>
          <div className={`text-2xl font-bold ${dirColor} leading-none flex items-center gap-1.5`}>
            {dirIcon}
            {formatPullPct(composite.oiWeightedPullPct)}
          </div>
          <div className="text-[9px] text-zinc-500 mt-1">
            OI-weighted • {dirLabel} • {composite.upCount}↑ / {composite.downCount}↓ / {composite.flatCount}≈
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
            Total ₹ Cr Pull
          </div>
          <div className={`text-xl font-bold ${dirColor} leading-none font-mono`}>
            {formatPullCr(composite.totalPullCr)}
          </div>
          <div className="text-[9px] text-zinc-500 mt-1">
            idx {formatPullCr(composite.indicesPullCr)} • stk {formatPullCr(composite.stocksPullCr)}
          </div>
        </div>
      </div>

      {/* ─── Twin bars: equal-weighted vs OI-weighted ─── */}
      <div className="space-y-2 mb-4">
        {/* Equal-weighted (sentiment) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
              Equal-weighted (sentiment)
            </span>
            <span className="text-[10px] text-zinc-300 font-mono">
              {formatPullPct(composite.equalWeightedPullPct)}
            </span>
          </div>
          <div className="relative w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-zinc-700" />
            <div
              className="absolute top-0 bottom-0 rounded-full transition-all duration-500"
              style={{
                left: composite.equalWeightedPullPct >= 0 ? '50%' : `${50 - equalW}%`,
                width: `${equalW}%`,
                backgroundColor: composite.equalWeightedPullPct >= 0 ? '#22c55e' : '#ef4444',
              }}
            />
          </div>
        </div>

        {/* OI-weighted (real pull) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
              OI-weighted (real ₹ pull)
            </span>
            <span className={`text-[10px] font-mono ${dirColor}`}>
              {formatPullPct(composite.oiWeightedPullPct)}
            </span>
          </div>
          <div className="relative w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-zinc-700" />
            <div
              className="absolute top-0 bottom-0 rounded-full transition-all duration-500"
              style={{
                left: composite.oiWeightedPullPct >= 0 ? '50%' : `${50 - oiW}%`,
                width: `${oiW}%`,
                backgroundColor: colors.bar,
              }}
            />
          </div>
        </div>
      </div>

      {/* ─── Gap callout: equal vs OI divergence ─── */}
      {Math.abs(composite.oiWeightedPullPct - composite.equalWeightedPullPct) > 0.15 && (
        <div className="text-[9px] text-amber-400/90 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1 mb-3 flex items-start gap-1">
          <Info className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
          <span>
            {composite.oiWeightedPullPct > composite.equalWeightedPullPct
              ? 'Big-cap OI dominates — heavyweights pulling harder than the basket average.'
              : 'Small-cap cluster diverging — basket average pulled harder than OI-weighted reality.'}
          </span>
        </div>
      )}

      {/* ─── Per-symbol breakdown table ─── */}
      <div className="border border-border/20 rounded-md overflow-hidden">
        <div className="grid grid-cols-[1fr_56px_56px_44px_44px] gap-0 bg-zinc-900/50 px-2.5 py-1.5 text-[8px] text-zinc-500 uppercase tracking-wider">
          <span>Symbol</span>
          <span className="text-right">Spot</span>
          <span className="text-right">MaxP</span>
          <span className="text-right">Diff</span>
          <span className="text-right">Pull</span>
        </div>
        {composite.perSymbol.slice(0, 19).map(r => (
          <div
            key={`${r.exchange}-${r.symbol}`}
            className="grid grid-cols-[1fr_56px_56px_44px_44px] gap-0 px-2.5 py-1 border-t border-border/10 hover:bg-zinc-800/30 transition-colors"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span
                className="w-1 h-1 rounded-full flex-shrink-0"
                style={{
                  backgroundColor:
                    r.direction === 'UP' ? '#22c55e'
                    : r.direction === 'DOWN' ? '#ef4444'
                    : '#71717a',
                }}
              />
              <span className={`text-[10px] truncate ${r.type === 'index' ? 'font-semibold text-foreground' : 'text-zinc-300'}`}>
                {r.symbol}
              </span>
              {r.exchange === 'BSE' && (
                <span className="text-[7px] px-0.5 py-0 rounded bg-amber-500/10 text-amber-400/80 ml-0.5">B</span>
              )}
            </div>
            <span className="text-[9px] text-zinc-400 text-right font-mono">
              {r.spot.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[9px] text-amber-400/80 text-right font-mono">
              {r.maxPain.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className={`text-[9px] text-right font-mono ${
              r.direction === 'UP' ? 'text-emerald-400/80'
              : r.direction === 'DOWN' ? 'text-red-400/80'
              : 'text-zinc-500'
            }`}>
              {r.diffPts > 0 ? '+' : ''}{Math.round(r.diffPts)}
            </span>
            <span className={`text-[9px] text-right font-mono ${
              r.contributionCr > 0 ? 'text-emerald-400/70'
              : r.contributionCr < 0 ? 'text-red-400/70'
              : 'text-zinc-600'
            }`}>
              {r.contributionCr > 0 ? '+' : r.contributionCr < 0 ? '−' : ''}
              {Math.abs(r.contributionCr) >= 100
                ? Math.abs(r.contributionCr).toFixed(0)
                : Math.abs(r.contributionCr).toFixed(1)}
            </span>
          </div>
        ))}
      </div>

      {/* ─── Footer note ─── */}
      <div className="mt-2 text-[8px] text-zinc-600 leading-relaxed">
        Composite = Σ (maxPain − spot) × OI per symbol. Sign = direction market tends to gravitate toward at expiry.
        Reliability scales with expiry tier — strongest on last Tuesday of month (NSE super-basket).
        Use as overlay with 13-factor engine, not as standalone signal.
      </div>
    </div>
  );
}

// ─── Header (shared across all states) ───

function Header({
  loading,
  onRefresh,
  timeAgo,
}: {
  loading: boolean;
  onRefresh: () => void;
  timeAgo: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-1.5">
        <Magnet className="w-3.5 h-3.5 text-violet-500" />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Composite Max Pain Magnet
        </span>
        <span className="text-[8px] text-zinc-700 ml-1">4 idx + 15 stk</span>
      </div>
      <div className="flex items-center gap-2">
        {timeAgo && (
          <span className="text-[9px] text-zinc-600">{timeAgo}</span>
        )}
        {loading && <RefreshCw className="w-3 h-3 text-zinc-600 animate-spin" />}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          aria-label="Refresh composite max pain"
        >
          <RefreshCw className={`w-3 h-3 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
