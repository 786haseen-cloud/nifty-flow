'use client';

/**
 * Magnet & Gamma Dashboard Card
 * -----------------------------
 *
 * One card per symbol (4 indices + 15 stocks = 19 cards in the Trends tab).
 *
 * Visual elements per card:
 *
 *  ┌──────────────────────────────────────────────┐
 *  │  SYMBOL NAME              Spot price  ±dist% │  ← header
 *  │                                              │
 *  │  ╔══════ Pinning Probability Gauge ══════╗   │
 *  │  ║            72%                        ║   │  ← big number
 *  │  ║  ████████████░░░░  (progress bar)     ║   │
 *  │  ╚═══════════════════════════════════════╝   │
 *  │                                              │
 *  │  GEX Strip per strike:                       │
 *  │       ▌   ▎   ▌  ▍  █  ▎   ▌                │  ← red/green bars
 *  │       K1  K2  K3 ATM K5 K6  K7              │
 *  │            ↑          ↑                     │
 *  │         zeroΓ     magnet zone               │
 *  │                                              │
 *  │  Charm ↑ / ↓ / →    Magnitude: 1.2 Cr/day    │
 *  │  Gamma regime: POSITIVE / NEGATIVE / NEUTRAL │
 *  │  Max Pain: 24,350   PCR: 0.85                │
 *  └──────────────────────────────────────────────┘
 *
 * Color coding:
 *   - Pinning probability: green ≥65, amber 35-65, red <35
 *   - GEX bars: green for positive (long gamma), red for negative
 *   - Magnet zone: amber highlight band
 *   - Zero-gamma flip: blue dashed line
 *   - Charm: green up arrow, red down arrow, gray flat
 */

import { useMemo } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  ArrowUp, ArrowDown, ArrowRight, Magnet, Activity,
  type LucideIcon,
} from 'lucide-react';
import type { MagnetResult } from '@/lib/magnet-engine';

// ─── Helpers ───

function fmtNum(v: number, digits = 0): string {
  if (!isFinite(v) || v === 0) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtSigned(v: number, digits = 1): string {
  if (!isFinite(v) || v === 0) return '0';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function fmtCr(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

// ─── Tooltip ───

function GexTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-[10px]">
      <div className="font-mono text-muted-foreground">Strike {fmtNum(d.strike)}</div>
      <div className={d.gexCr >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        GEX: {fmtSigned(d.gexCr, 2)} Cr/1%
      </div>
      {d.inMagnetZone && (
        <div className="text-amber-300 font-semibold">★ Magnet Zone</div>
      )}
      {d.isZeroGamma && (
        <div className="text-sky-300 font-semibold">◇ Zero Gamma Flip</div>
      )}
    </div>
  );
}

// ─── Pinning Probability Gauge ───

function PinGauge({ probability }: { probability: number }) {
  const color = probability >= 65 ? '#10b981' : probability >= 35 ? '#f59e0b' : '#ef4444';
  const label = probability >= 75 ? 'HIGH PIN'
              : probability >= 50 ? 'MODERATE'
              : probability >= 30 ? 'WEAK'
              : 'NO PIN';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Pinning Prob</span>
          <span className="text-[9px] font-mono font-bold" style={{ color }}>{label}</span>
        </div>
        <div className="relative h-2 bg-muted/40 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all"
            style={{ width: `${probability}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="text-lg font-mono font-bold" style={{ color }}>
        {probability}%
      </div>
    </div>
  );
}

// ─── Charm Direction Badge ───

function CharmBadge({ direction, magnitude }: { direction: 'up' | 'down' | 'flat'; magnitude: number }) {
  const cfg: Record<string, { icon: LucideIcon; color: string; label: string }> = {
    up:    { icon: ArrowUp,    color: '#10b981', label: 'Drift UP' },
    down:  { icon: ArrowDown,  color: '#ef4444', label: 'Drift DOWN' },
    flat:  { icon: ArrowRight, color: '#a1a1aa', label: 'Flat' },
  };
  const { icon: Icon, color, label } = cfg[direction];
  return (
    <div className="flex items-center gap-1 text-[10px]" style={{ color }}>
      <Icon className="h-3 w-3" />
      <span className="font-semibold">{label}</span>
      <span className="text-muted-foreground ml-1 font-mono">{fmtCr(magnitude)} Cr/d</span>
    </div>
  );
}

// ─── Main Card ───

interface MagnetCardProps {
  data: MagnetResult;
  compact?: boolean;  // smaller layout for stocks grid
}

export default function MagnetCard({ data, compact = false }: MagnetCardProps) {
  // Prepare chart data: GEX per strike
  const chartData = useMemo(() => {
    if (!data.gexStrikes || data.gexStrikes.length === 0) return [];
    return data.gexStrikes.map((s) => ({
      strike: s.strike,
      gexCr: s.gexCr,
      gexShares: s.gexShares,
      inMagnetZone: data.magnetZone.includes(s.strike),
      isZeroGamma: data.zeroGamma !== null && Math.abs(s.strike - data.zeroGamma) < data.strikeStep * 0.1,
    }));
  }, [data]);

  // Color for each bar based on sign
  const barColor = (g: number) => g >= 0 ? '#10b981' : '#ef4444';

  // Header distance color
  const distColor = Math.abs(data.maxPainDistPct) < 0.3 ? '#10b981'
                  : Math.abs(data.maxPainDistPct) < 0.8 ? '#f59e0b'
                  : '#a1a1aa';

  const regimeColor = data.gammaRegime === 'positive' ? '#10b981'
                    : data.gammaRegime === 'negative' ? '#ef4444'
                    : '#a1a1aa';

  const cardHeight = compact ? 'h-[220px]' : 'h-[260px]';

  return (
    <div className={`rounded-lg border border-border/50 bg-card/50 p-2.5 flex flex-col ${cardHeight}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Magnet className={`h-3.5 w-3.5 shrink-0 ${data.type === 'index' ? 'text-purple-400' : 'text-orange-400'}`} />
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{data.symbol}</div>
            {!compact && <div className="text-[9px] text-muted-foreground truncate">{data.name}</div>}
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <div className="text-xs font-mono font-semibold">{fmtNum(data.spot)}</div>
          <div className="text-[9px] font-mono" style={{ color: distColor }}>
            {fmtSigned(data.maxPainDistPct, 2)}% off MP
          </div>
        </div>
      </div>

      {/* Pinning probability gauge */}
      <div className="mb-2">
        <PinGauge probability={data.pinningProbability} />
      </div>

      {/* GEX Strip chart */}
      <div className="flex-1 min-h-0">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
              barCategoryGap={1}
            >
              <XAxis
                dataKey="strike"
                tick={{ fill: '#71717a', fontSize: 8 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => {
                  // For indices, show full strike; for stocks, show abbreviated
                  if (v >= 10000) return (v / 1000).toFixed(1) + 'K';
                  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
                  return String(v);
                }}
                interval="preserveStartEnd"
                minTickGap={5}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip content={<GexTooltip />} cursor={{ fill: '#ffffff08' }} />
              <ReferenceLine y={0} stroke="#ffffff30" />
              {/* Magnet zone reference lines */}
              {data.magnetZone.map((s) => (
                <ReferenceLine
                  key={`mz-${s}`}
                  x={s}
                  stroke="#f59e0b"
                  strokeOpacity={0.5}
                  strokeDasharray="2 2"
                />
              ))}
              {/* Zero gamma flip reference line */}
              {data.zeroGamma !== null && (
                <ReferenceLine
                  x={Math.round(data.zeroGamma)}
                  stroke="#0ea5e9"
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                  label={{ value: '0Γ', position: 'top', fill: '#0ea5e9', fontSize: 8 }}
                />
              )}
              {/* Spot reference line */}
              <ReferenceLine
                x={Math.round(data.spot)}
                stroke="#a855f7"
                strokeOpacity={0.7}
                strokeWidth={1.5}
                label={{ value: 'S', position: 'top', fill: '#a855f7', fontSize: 8 }}
              />
              <Bar dataKey="gexCr" radius={[2, 2, 0, 0]} maxBarSize={14}>
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={barColor(entry.gexCr)}
                    fillOpacity={entry.inMagnetZone ? 1.0 : 0.55}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground">
            No GEX data
          </div>
        )}
      </div>

      {/* Footer: charm + regime + max pain */}
      <div className="mt-1.5 pt-1.5 border-t border-border/30 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <CharmBadge direction={data.charmDirection} magnitude={data.charmMagnitudeCr} />
          <div className="text-[9px] font-mono" style={{ color: regimeColor }}>
            {data.gammaRegime === 'positive' ? '+Γ' : data.gammaRegime === 'negative' ? '−Γ' : '~Γ'}
          </div>
        </div>
        <div className="flex items-center justify-between text-[9px] font-mono">
          <span className="text-muted-foreground">MP: <span className="text-foreground">{fmtNum(data.maxPain)}</span></span>
          <span className="text-muted-foreground">PCR: <span className="text-foreground">{data.pcr.toFixed(2)}</span></span>
          <span className="text-muted-foreground">0Γ: <span className="text-sky-300">{data.zeroGamma !== null ? fmtNum(Math.round(data.zeroGamma)) : '—'}</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── Aggregate summary card (shows the BIG picture across all 19 symbols) ───

interface MagnetSummary {
  totalPinning: number;          // average pinning probability
  pinnedCount: number;           // # of symbols with pinning >= 65
  indicesAboveMP: number;        // # of indices with spot > maxPain
  stocksAboveMP: number;
  positiveGammaCount: number;    // # of symbols in positive gamma regime
  charmUp: number;
  charmDown: number;
  charmFlat: number;
}

export function MagnetSummaryRow({ symbols }: { symbols: MagnetResult[] }) {
  const summary: MagnetSummary = useMemo(() => {
    const indices = symbols.filter(s => s.type === 'index');
    const stocks = symbols.filter(s => s.type === 'stock');
    return {
      totalPinning: symbols.length > 0
        ? Math.round(symbols.reduce((s, x) => s + x.pinningProbability, 0) / symbols.length)
        : 0,
      pinnedCount: symbols.filter(s => s.pinningProbability >= 65).length,
      indicesAboveMP: indices.filter(s => s.maxPainDist > 0).length,
      stocksAboveMP: stocks.filter(s => s.maxPainDist > 0).length,
      positiveGammaCount: symbols.filter(s => s.gammaRegime === 'positive').length,
      charmUp: symbols.filter(s => s.charmDirection === 'up').length,
      charmDown: symbols.filter(s => s.charmDirection === 'down').length,
      charmFlat: symbols.filter(s => s.charmDirection === 'flat').length,
    };
  }, [symbols]);

  const stats = [
    {
      label: 'Avg Pinning',
      value: `${summary.totalPinning}%`,
      sub: `${summary.pinnedCount}/${symbols.length} HIGH pin`,
      color: summary.totalPinning >= 50 ? '#10b981' : summary.totalPinning >= 30 ? '#f59e0b' : '#ef4444',
      icon: Magnet,
    },
    {
      label: 'Above Max Pain',
      value: `${summary.indicesAboveMP}/4 IND`,
      sub: `${summary.stocksAboveMP}/15 STK`,
      color: summary.indicesAboveMP >= 3 ? '#10b981' : summary.indicesAboveMP >= 2 ? '#f59e0b' : '#ef4444',
      icon: Activity,
    },
    {
      label: 'Gamma Regime',
      value: `+Γ ${summary.positiveGammaCount}`,
      sub: `−Γ ${symbols.length - summary.positiveGammaCount}`,
      color: summary.positiveGammaCount >= 12 ? '#10b981' : summary.positiveGammaCount >= 8 ? '#f59e0b' : '#ef4444',
      icon: Activity,
    },
    {
      label: 'Charm Drift',
      value: `↑${summary.charmUp} ↓${summary.charmDown}`,
      sub: `→${summary.charmFlat} flat`,
      color: summary.charmUp > summary.charmDown ? '#10b981'
           : summary.charmDown > summary.charmUp ? '#ef4444'
           : '#a1a1aa',
      icon: summary.charmUp > summary.charmDown ? ArrowUp : ArrowDown,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-border/40 bg-card/40 p-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <stat.icon className="h-3 w-3" style={{ color: stat.color }} />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{stat.label}</span>
          </div>
          <div className="text-sm font-mono font-bold" style={{ color: stat.color }}>
            {stat.value}
          </div>
          <div className="text-[9px] text-muted-foreground">{stat.sub}</div>
        </div>
      ))}
    </div>
  );
}
