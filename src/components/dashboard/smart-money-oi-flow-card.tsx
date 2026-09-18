'use client';

/**
 * Smart Money OI Flow Card (Task 42)
 * ─────────────────────────────────────────────────────────────────────────
 * Mirrors the Indian-F&O "Smart Money Tracker" reference layout provided
 * by the user. Aggregates per-participant per-instrument-category positioning
 * across the 3 most-recent NSE F&O participant reports and renders:
 *
 *   LEFT  — 6 tables (Index Future / Index Call / Index Put / Stock Future /
 *           Stock Call / Stock Put) — each table shows Client/DII/FII/Pro
 *           rows with Added Longs / Closed Longs / Added Shorts / Closed
 *           Shorts + Net Buy/Sell for today (computed as Δ vs yesterday).
 *   RIGHT TOP  — 3-day carried-positions panel (Today / 1 Day Ago / 2 Days
 *                Ago) per participant — total longs / shorts.
 *   RIGHT BOT — Net execution summary — per-participant per-category net
 *               (the same Δ as left panel, but flattened to one line per
 *               participant × category, sorted by magnitude).
 *   BOTTOM   — Prediction verdict — synthesizes the above into a
 *              directional bias (BULL / BEAR / NEUTRAL) with the same
 *              "FII & prop move market, fade retail" rule used by Factor 12.
 *
 * Data source: /api/participants/positioning?days=3 (reads Upstash Redis
 * keys populated by the daily CSV upload routine). The card polls every 60s
 * since positioning data only changes once a day (post-close), not intraday.
 *
 * Reference: User uploaded image (HSgf5FeasAAmou0.png) of an Excel-style
 * dashboard by an Indian analyst (Amit Dhamija, SEBI INH000019804). We
 * copied the *layout* and *data structure*, NOT the branding / course
 * promotions / contact banners — those are the analyst's personal marketing.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Layers, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import type {
  ParticipantPositioning,
  ParticipantCategoryBreakdown,
} from '@/lib/participant-service';

// ─── Types ───

type ParticipantKey = 'client' | 'dii' | 'fii' | 'pro';
type CategoryKey = keyof ParticipantCategoryBreakdown;  // 'indexFutures' | 'indexCalls' | ...

interface PositioningApiResponse {
  fao_oi: ParticipantPositioning[];
  fao_vol: ParticipantPositioning[];
  configured: boolean;
  days: number;
  timestamp: string;
  error?: string;
}

interface CategoryDelta {
  /** Δ Long contracts (today - yesterday). Positive = Added Longs, negative = Closed Longs (abs shown). */
  longDelta: number;
  /** Δ Short contracts. Positive = Added Shorts, negative = Closed Shorts (abs shown). */
  shortDelta: number;
  /** Net = longDelta - shortDelta. Positive = net buyer (bullish stance). */
  net: number;
}

interface ParticipantDelta {
  client: Record<CategoryKey, CategoryDelta>;
  dii: Record<CategoryKey, CategoryDelta>;
  fii: Record<CategoryKey, CategoryDelta>;
  pro: Record<CategoryKey, CategoryDelta>;
}

interface Prediction {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  score: number;            // -1.5 to +1.5
  headline: string;
  rationale: string;
}

// ─── Constants ───

const POLL_INTERVAL_MS = 60_000; // 60s — positioning only changes daily

const PARTICIPANT_LABELS: Record<ParticipantKey, string> = {
  client: 'Client',
  dii: 'DII',
  fii: 'FII',
  pro: 'Pro',
};

const CATEGORY_LABELS: { key: CategoryKey; label: string; sub: string }[] = [
  { key: 'indexFutures',  label: 'Index Futures', sub: 'NIFTY/BANKNIFTY/SENSEX/FINNIFTY fut' },
  { key: 'indexCalls',    label: 'Index Calls',   sub: 'Index CE options' },
  { key: 'indexPuts',     label: 'Index Puts',    sub: 'Index PE options' },
  { key: 'stockFutures',  label: 'Stock Futures', sub: '15 F&O stock futures' },
  { key: 'stockCalls',    label: 'Stock Calls',   sub: 'Stock CE options' },
  { key: 'stockPuts',     label: 'Stock Puts',    sub: 'Stock PE options' },
];

const PARTICIPANT_KEYS: ParticipantKey[] = ['client', 'dii', 'fii', 'pro'];

// ─── Pure helpers ───

function emptyDelta(): CategoryDelta {
  return { longDelta: 0, shortDelta: 0, net: 0 };
}

function emptyParticipantDelta(): ParticipantDelta['client'] {
  const out: Record<CategoryKey, CategoryDelta> = {} as Record<CategoryKey, CategoryDelta>;
  for (const c of CATEGORY_LABELS) out[c.key] = emptyDelta();
  return out as ParticipantDelta['client'];
}

/**
 * Compute the day-over-day Δ for every (participant × category) cell.
 * Returns null if either today's or yesterday's snapshot is missing the
 * per-category breakdown field.
 */
function computeDeltas(
  today: ParticipantPositioning | null,
  yesterday: ParticipantPositioning | null
): ParticipantDelta | null {
  if (!today?.breakdown || !yesterday?.breakdown) return null;

  const result: ParticipantDelta = {
    client: emptyParticipantDelta(),
    dii: emptyParticipantDelta(),
    fii: emptyParticipantDelta(),
    pro: emptyParticipantDelta(),
  };

  for (const p of PARTICIPANT_KEYS) {
    for (const c of CATEGORY_LABELS) {
      const t = today.breakdown[p][c.key];
      const y = yesterday.breakdown[p][c.key];
      const longDelta = t.long - y.long;
      const shortDelta = t.short - y.short;
      result[p][c.key] = {
        longDelta,
        shortDelta,
        net: longDelta - shortDelta,
      };
    }
  }

  return result;
}

/**
 * Compute the directional bias verdict.
 *
 * Rule (per the standing convention "FII & prop desk move the market, always
 * bet against the retail client"):
 *   - FII net buying Index Calls / writing Index Puts → bullish
 *   - FII net writing Index Calls / buying Index Puts → bearish
 *   - Client doing the OPPOSITE of FII on Index options → contrarian confirmation
 *   - Client doing the SAME as FII on Index options → yellow flag (no edge)
 *   - Pro alignment with FII strengthens the signal
 *
 * Score scale: -1.5 (max bear) to +1.5 (max bull). Each category contributes
 * a weighted vote; index categories weigh heavier than stock categories
 * because index flow moves the broader market more directly.
 */
function computePrediction(deltas: ParticipantDelta | null): Prediction {
  if (!deltas) {
    return {
      direction: 'NEUTRAL',
      score: 0,
      headline: 'No Δ data',
      rationale: 'Need at least 2 days of positioning snapshots to compute day-over-day deltas.',
    };
  }

  // Per-participant per-category weighted score.
  // Weights: index categories ×2 (they move the broader market), stock ×1.
  // Sign of each contribution = sign of `net` (positive net = bullish stance).
  let score = 0;
  const weights: Record<CategoryKey, number> = {
    indexFutures: 2,
    indexCalls: 2,
    indexPuts: 2,
    stockFutures: 1,
    stockCalls: 1,
    stockPuts: 1,
  };

  // Normalize raw Δ by typical magnitude (~100k contracts is meaningful).
  // Cap at ±1 per (participant × category) to avoid one cell dominating.
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / 100_000));

  let fiiBull = 0, fiiBear = 0;
  let proBull = 0, proBear = 0;
  let clientBull = 0, clientBear = 0;

  for (const c of CATEGORY_LABELS) {
    const w = weights[c.key];

    // FII — moves the market
    const fiiNet = deltas.fii[c.key].net;
    score += clamp(fiiNet) * w * 0.5; // FII weight = 0.5 per unit
    if (fiiNet > 0) fiiBull += w;
    else if (fiiNet < 0) fiiBear += w;

    // Pro — also smart money
    const proNet = deltas.pro[c.key].net;
    score += clamp(proNet) * w * 0.3; // Pro weight = 0.3
    if (proNet > 0) proBull += w;
    else if (proNet < 0) proBear += w;

    // Client — CONTRARIAN. If client is short (selling), that's bullish.
    // If client is long (buying), that's bearish (retail trapped).
    const clientNet = deltas.client[c.key].net;
    score += clamp(-clientNet) * w * 0.2; // Client weight = 0.2 (inverted)
    if (clientNet < 0) clientBull += w;
    else if (clientNet > 0) clientBear += w;

    // DII — neutral support, light weight
    const diiNet = deltas.dii[c.key].net;
    score += clamp(diiNet) * w * 0.1;
  }

  // Cap score at ±1.5
  score = Math.max(-1.5, Math.min(1.5, score));

  let direction: Prediction['direction'] = 'NEUTRAL';
  if (score > 0.3) direction = 'BULL';
  else if (score < -0.3) direction = 'BEAR';

  // Headline — describe the dominant signal
  let headline: string;
  if (direction === 'BULL') {
    if (fiiBull > fiiBear && clientBull > clientBear) {
      headline = `FII buying + Client selling = contrarian BULL (smart money accumulating, retail capitulating)`;
    } else if (fiiBull > fiiBear) {
      headline = `FII net buying across ${fiiBull} categories — bullish lean`;
    } else {
      headline = `Mild bullish lean — net score ${score.toFixed(2)}`;
    }
  } else if (direction === 'BEAR') {
    if (fiiBear > fiiBull && clientBear > clientBull) {
      headline = `FII selling + Client buying = contrarian BEAR (smart money distributing, retail trapped)`;
    } else if (fiiBear > fiiBull) {
      headline = `FII net selling across ${fiiBear} categories — bearish lean`;
    } else {
      headline = `Mild bearish lean — net score ${score.toFixed(2)}`;
    }
  } else {
    headline = `Balanced — FII buying ${fiiBull} / selling ${fiiBear}, no edge`;
  }

  const rationale =
    `Score = 0.5×FII + 0.3×Pro + 0.2×(-Client) + 0.1×DII, normalized per category, weighted ×2 for index categories and ×1 for stock. ` +
    `Threshold ±0.3 for directional verdict. Per "FII & prop move market, fade retail" rule.`;

  return { direction, score, headline, rationale };
}

// ─── Number formatting ───

function fmtContracts(n: number): string {
  // Use Indian numbering (lakh-style commas) — 2,11,134 not 211,134.
  return Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtSigned(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtContracts(n)}`;
}

// ─── Component ───

export default function SmartMoneyOiFlowCard() {
  const [data, setData] = useState<PositioningApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPositioning = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/participants/positioning?days=3', { cache: 'no-store' });
      const json: PositioningApiResponse = await res.json();
      if (!res.ok && json.error) {
        setError(json.error);
      } else {
        setData(json);
        setLastUpdated(new Date().toISOString());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositioning();
    pollRef.current = setInterval(fetchPositioning, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Today / Yesterday / 2-days-ago snapshots (fao_oi — close-of-day positions)
  const today = data?.fao_oi?.[0] ?? null;
  const yesterday = data?.fao_oi?.[1] ?? null;
  const twoDaysAgo = data?.fao_oi?.[2] ?? null;

  const deltas = useMemo(
    () => computeDeltas(today, yesterday),
    [today, yesterday]
  );

  const prediction = useMemo(
    () => computePrediction(deltas),
    [deltas]
  );

  const hasData = !!today;
  const hasDeltas = !!deltas;

  // ─── Empty / loading / error states ───

  if (!hasData && !loading && !error) {
    return (
      <CardShell
        loading={loading}
        lastUpdated={lastUpdated}
        onRefresh={fetchPositioning}
      >
        <div className="text-center py-8">
          <Layers className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-zinc-400">
            No participant positioning data yet.
          </p>
          <p className="text-[10px] text-zinc-500 mt-1">
            Upload today's NSE F&O participant OI CSV via Settings → Participant Flow → Upload.
          </p>
        </div>
      </CardShell>
    );
  }

  if (loading && !hasData) {
    return (
      <CardShell
        loading={loading}
        lastUpdated={lastUpdated}
        onRefresh={fetchPositioning}
      >
        <div className="text-center py-8">
          <RefreshCw className="w-5 h-5 text-zinc-600 animate-spin mx-auto mb-2" />
          <p className="text-xs text-zinc-400">Loading participant positioning…</p>
        </div>
      </CardShell>
    );
  }

  if (error && !hasData) {
    return (
      <CardShell
        loading={loading}
        lastUpdated={lastUpdated}
        onRefresh={fetchPositioning}
      >
        <div className="text-[11px] text-red-400/90 px-2 py-4">
          Error: {error}
        </div>
      </CardShell>
    );
  }

  // ─── Main render ───

  return (
    <CardShell
      loading={loading}
      lastUpdated={lastUpdated}
      onRefresh={fetchPositioning}
      dateLabel={today?.date}
    >
      {/* Top-level prediction banner */}
      <PredictionBanner prediction={prediction} hasDeltas={hasDeltas} />

      {/* Two-column grid: left = 6 tables, right = 3-day + net summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
        {/* LEFT — 6 tables */}
        <div className="lg:col-span-2 space-y-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
            OI Changes — Futures &amp; Options (Today vs Yesterday)
          </div>
          {hasDeltas ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {CATEGORY_LABELS.map(c => (
                <CategoryTable
                  key={c.key}
                  categoryKey={c.key}
                  categoryLabel={c.label}
                  categorySub={c.sub}
                  deltas={deltas!}
                />
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded px-3 py-2">
              <AlertTriangle className="w-3 h-3 inline mr-1.5" />
              Need at least 2 days of positioning snapshots to compute day-over-day Δ. Upload yesterday's CSV if missing.
            </div>
          )}
        </div>

        {/* RIGHT — 3-day carried + net summary */}
        <div className="space-y-3">
          <CarriedPositionsPanel
            today={today}
            yesterday={yesterday}
            twoDaysAgo={twoDaysAgo}
          />
          <NetSummaryPanel deltas={deltas} />
        </div>
      </div>

      {/* Rules / discipline box */}
      <div className="mt-3 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/20">
        <div className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold mb-1">
          ⚠ Discipline Checklist
        </div>
        <ol className="text-[10px] text-amber-300/90 list-decimal list-inside space-y-0.5">
          <li>Keep stop-loss in system &amp; trail as trend confirms.</li>
          <li>Check global markets for opposite trend before taking positions.</li>
          <li>Watch for market-impacting news (RBI, Fed, geopolitical).</li>
          <li>Respect key levels — trade only on price-action confirmation.</li>
        </ol>
      </div>
    </CardShell>
  );
}

// ─── Sub-components ───

function CardShell({
  children,
  loading,
  lastUpdated,
  onRefresh,
  dateLabel,
}: {
  children: React.ReactNode;
  loading: boolean;
  lastUpdated: string | null;
  onRefresh: () => void;
  dateLabel?: string;
}) {
  let timeAgo = '';
  if (lastUpdated) {
    const ms = Date.now() - new Date(lastUpdated).getTime();
    if (ms < 60_000) timeAgo = 'just now';
    else if (ms < 3_600_000) timeAgo = `${Math.floor(ms / 60_000)}m ago`;
    else timeAgo = `${Math.floor(ms / 3_600_000)}h ago`;
  }
  return (
    <div className="bg-card border border-border/30 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Smart Money OI Flow
          </span>
          {dateLabel && (
            <span className="text-[9px] text-zinc-600 ml-1.5 px-1.5 py-0.5 rounded bg-zinc-800/50 font-mono">
              {dateLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {timeAgo && <span className="text-[9px] text-zinc-600">{timeAgo}</span>}
          {loading && <RefreshCw className="w-3 h-3 text-zinc-600 animate-spin" />}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
            aria-label="Refresh Smart Money OI Flow"
          >
            <RefreshCw className={`w-3 h-3 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function PredictionBanner({
  prediction,
  hasDeltas,
}: {
  prediction: Prediction;
  hasDeltas: boolean;
}) {
  const isBull = prediction.direction === 'BULL';
  const isBear = prediction.direction === 'BEAR';
  const colorClass = isBull
    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    : isBear
    ? 'text-red-300 bg-red-500/10 border-red-500/30'
    : 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30';
  const Icon = isBull ? TrendingUp : isBear ? TrendingDown : Minus;

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-md border ${colorClass}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wider">
            {prediction.direction} {prediction.score > 0 ? '+' : ''}{prediction.score.toFixed(2)}
          </span>
          {!hasDeltas && (
            <span className="text-[9px] px-1 py-0 rounded bg-zinc-800 text-zinc-400">
              no Δ data
            </span>
          )}
        </div>
        <div className="text-[10px] leading-relaxed">
          {prediction.headline}
        </div>
        <div className="text-[9px] text-zinc-500 leading-relaxed mt-1">
          {prediction.rationale}
        </div>
      </div>
    </div>
  );
}

function CategoryTable({
  categoryKey,
  categoryLabel,
  categorySub,
  deltas,
}: {
  categoryKey: CategoryKey;
  categoryLabel: string;
  categorySub: string;
  deltas: ParticipantDelta;
}) {
  return (
    <div className="border border-border/20 rounded-md overflow-hidden">
      <div className="px-2.5 py-1.5 bg-zinc-900/60 border-b border-border/10">
        <div className="text-[11px] font-semibold text-foreground leading-tight">
          {categoryLabel}
        </div>
        <div className="text-[8px] text-zinc-500 leading-tight mt-0.5">
          {categorySub}
        </div>
      </div>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_56px_56px_56px] gap-0 bg-zinc-900/40 px-2 py-1 text-[8px] text-zinc-500 uppercase tracking-wider">
        <span></span>
        <span className="text-right text-emerald-500/70">Long Δ</span>
        <span className="text-right text-red-500/70">Short Δ</span>
        <span className="text-right">Net</span>
      </div>
      {/* Rows: Client, DII, FII, Pro */}
      {PARTICIPANT_KEYS.map(p => {
        const d = deltas[p][categoryKey];
        const longAdded = d.longDelta > 0;
        const shortAdded = d.shortDelta > 0;
        const netBull = d.net > 0;
        return (
          <div
            key={p}
            className="grid grid-cols-[1fr_56px_56px_56px] gap-0 px-2 py-1 border-t border-border/10 hover:bg-zinc-800/30 transition-colors"
          >
            <span className="text-[10px] text-zinc-300 truncate">
              {PARTICIPANT_LABELS[p]}
            </span>
            <span className={`text-[9px] text-right font-mono ${
              longAdded ? 'text-emerald-400' : d.longDelta < 0 ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              {longAdded ? '+' : d.longDelta < 0 ? '−' : ''}{fmtContracts(d.longDelta)}
            </span>
            <span className={`text-[9px] text-right font-mono ${
              shortAdded ? 'text-red-400' : d.shortDelta < 0 ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              {shortAdded ? '+' : d.shortDelta < 0 ? '−' : ''}{fmtContracts(d.shortDelta)}
            </span>
            <span className={`text-[9px] text-right font-mono font-semibold ${
              netBull ? 'text-emerald-400' : d.net < 0 ? 'text-red-400' : 'text-zinc-500'
            }`}>
              {netBull ? '+' : d.net < 0 ? '−' : ''}{fmtContracts(d.net)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CarriedPositionsPanel({
  today,
  yesterday,
  twoDaysAgo,
}: {
  today: ParticipantPositioning | null;
  yesterday: ParticipantPositioning | null;
  twoDaysAgo: ParticipantPositioning | null;
}) {
  const dates = [
    { label: 'Today', entry: today },
    { label: '1 Day Ago', entry: yesterday },
    { label: '2 Days Ago', entry: twoDaysAgo },
  ];

  return (
    <div className="border border-border/20 rounded-md overflow-hidden">
      <div className="px-2.5 py-1.5 bg-zinc-900/60 border-b border-border/10">
        <div className="text-[11px] font-semibold text-foreground leading-tight">
          Total Positions Carried
        </div>
        <div className="text-[8px] text-zinc-500 leading-tight mt-0.5">
          Open Interest (close-of-day)
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_52px_52px_52px] gap-0 bg-zinc-900/40 px-2 py-1 text-[8px] text-zinc-500 uppercase tracking-wider">
        <span></span>
        {dates.map(d => (
          <span key={d.label} className="text-right">{d.label}</span>
        ))}
      </div>

      {/* Rows: 4 participants × (Long | Short) = 8 rows */}
      {PARTICIPANT_KEYS.map(p => (
        <RowGroup
          key={p}
          participantKey={p}
          dates={dates}
        />
      ))}
    </div>
  );
}

function RowGroup({
  participantKey,
  dates,
}: {
  participantKey: ParticipantKey;
  dates: { label: string; entry: ParticipantPositioning | null }[];
}) {
  const label = PARTICIPANT_LABELS[participantKey];
  return (
    <>
      <div className="grid grid-cols-[1fr_52px_52px_52px] gap-0 px-2 py-0.5 border-t border-border/10 bg-zinc-900/20">
        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">
          {label} L
        </span>
        {dates.map(d => {
          const v = d.entry?.positioning?.[participantKey]?.longContracts ?? 0;
          return (
            <span key={d.label} className="text-[9px] text-right font-mono text-zinc-300">
              {v > 0 ? (v / 100000).toFixed(2) + 'L' : '—'}
            </span>
          );
        })}
      </div>
      <div className="grid grid-cols-[1fr_52px_52px_52px] gap-0 px-2 py-0.5 border-t border-border/5">
        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">
          {label} S
        </span>
        {dates.map(d => {
          const v = d.entry?.positioning?.[participantKey]?.shortContracts ?? 0;
          return (
            <span key={d.label} className="text-[9px] text-right font-mono text-zinc-400">
              {v > 0 ? (v / 100000).toFixed(2) + 'L' : '—'}
            </span>
          );
        })}
      </div>
    </>
  );
}

function NetSummaryPanel({ deltas }: { deltas: ParticipantDelta | null }) {
  if (!deltas) {
    return (
      <div className="border border-border/20 rounded-md p-3 text-center">
        <p className="text-[10px] text-zinc-500">Need Δ data for net summary</p>
      </div>
    );
  }

  // Flatten to (participant, category, net) tuples and sort by |net| desc.
  const flat: { p: ParticipantKey; c: CategoryKey; net: number }[] = [];
  for (const p of PARTICIPANT_KEYS) {
    for (const cat of CATEGORY_LABELS) {
      flat.push({ p, c: cat.key, net: deltas[p][cat.key].net });
    }
  }
  flat.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const top = flat.slice(0, 12);

  return (
    <div className="border border-border/20 rounded-md overflow-hidden">
      <div className="px-2.5 py-1.5 bg-zinc-900/60 border-b border-border/10">
        <div className="text-[11px] font-semibold text-foreground leading-tight">
          Net Execution Today
        </div>
        <div className="text-[8px] text-zinc-500 leading-tight mt-0.5">
          Top 12 by |net contracts| (Bought=+, Sold=−)
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr_56px] gap-0 bg-zinc-900/40 px-2 py-1 text-[8px] text-zinc-500 uppercase tracking-wider">
        <span>Who</span>
        <span>What</span>
        <span className="text-right">Net</span>
      </div>
      {top.map(({ p, c, net }) => {
        const catLabel = CATEGORY_LABELS.find(cl => cl.key === c)?.label ?? c;
        const isBull = net > 0;
        return (
          <div
            key={`${p}-${c}`}
            className="grid grid-cols-[1fr_1fr_56px] gap-0 px-2 py-1 border-t border-border/10 hover:bg-zinc-800/30"
          >
            <span className="text-[9px] text-zinc-300">
              {PARTICIPANT_LABELS[p]}
            </span>
            <span className="text-[9px] text-zinc-400 truncate pl-1">
              {catLabel}
            </span>
            <span className={`text-[9px] text-right font-mono font-semibold ${
              isBull ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-zinc-500'
            }`}>
              {fmtSigned(net)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
