'use client';

/**
 * Live Smart-Money Footprint Card (Phase 2d)
 * ──────────────────────────────────────────
 * Answers ONE question live: "who is moving the market right now —
 * FII/Prop desks or the retail crowd?" — from the user's model that
 * FII + prop desks move the market and always bet against the retail
 * client.
 *
 * Four live footprints per symbol (all from the SAME 60s magnet-scan
 * poll — zero extra Kite API calls):
 *   1. Futures buildup   — price × OI (retail barely trades futures,
 *                          so futures OI ≈ FII/Prop positioning)
 *   2. Fresh OI walls    — which strikes desks STARTED writing today
 *   3. PCR velocity      — rising = put writing, falling = call writing
 *   4. Writer-vs-buyer   — Σ|ΔOI|÷Σvolume: POSITIONING (desks) vs CHURN
 *                          (retail lottery tickets)
 *
 * Deltas are measured vs the FIRST capture of the IST day (baseline in
 * Upstash — survives Vercel cold starts). If the dashboard first polls
 * at 11:00, deltas run from 11:00 — shown honestly in the delta window.
 *
 * Data source: useMagnetScan hook (rides the existing poll).
 */

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScanEye, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import type { SymbolFootprint, BuildupLabel, VerdictTone } from '@/lib/footprint';

// ─── Formatting helpers ───

/** Compact Indian-style OI/volume: 48,200 → 48.2K · 3,410,000 → 34.1L · 12,300,000 → 1.23Cr */
function fmtOI(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(a)}`;
}

function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/** "214" → "3h 34m" */
function fmtAge(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

const BUILDUP_LABELS: Record<BuildupLabel, string> = {
  LONG_BUILDUP: 'LONG BUILDUP',
  SHORT_BUILDUP: 'SHORT BUILDUP',
  SHORT_COVERING: 'SHORT COVERING',
  LONG_UNWINDING: 'LONG UNWINDING',
  NEUTRAL: 'NEUTRAL',
};

const BUILDUP_STYLES: Record<BuildupLabel, string> = {
  LONG_BUILDUP: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  SHORT_BUILDUP: 'bg-red-500/15 text-red-300 border-red-500/30',
  SHORT_COVERING: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20',
  LONG_UNWINDING: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  NEUTRAL: 'bg-muted/20 text-muted-foreground border-border/40',
};

const CHURN_STYLES: Record<string, string> = {
  POSITIONING: 'text-purple-300',
  MIXED: 'text-muted-foreground',
  CHURN: 'text-amber-300',
  UNKNOWN: 'text-muted-foreground',
};

function verdictBadgeClass(tone: VerdictTone): string {
  switch (tone) {
    case 'bullish': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    case 'bearish': return 'bg-red-500/15 text-red-300 border-red-500/40';
    case 'churn': return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    default: return 'bg-muted/20 text-muted-foreground border-border/40';
  }
}

function PcrCell({ fp }: { fp: SymbolFootprint }) {
  const { now, delta, direction } = fp.pcr;
  if (now == null) return <span className="text-muted-foreground">—</span>;
  const Icon = direction === 'rising' ? TrendingUp : direction === 'falling' ? TrendingDown : Minus;
  const cls = direction === 'rising' ? 'text-emerald-400' : direction === 'falling' ? 'text-red-400' : 'text-muted-foreground';
  const word = direction === 'rising' ? 'put writing' : direction === 'falling' ? 'call writing' : 'flat';
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${cls}`}>
      <Icon className="h-3 w-3" />
      {now.toFixed(2)}
      <span className="text-[9px] opacity-80">({word})</span>
      {delta != null && <span className="text-[9px] opacity-60">{delta >= 0 ? '+' : ''}{delta.toFixed(2)}</span>}
    </span>
  );
}

// ─── Index card (detailed) ───

function FootprintIndexCard({ fp }: { fp: SymbolFootprint }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-2.5 flex flex-col gap-1.5">
      {/* Header: symbol + verdict */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <span className="text-xs font-bold">{fp.symbol}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${verdictBadgeClass(fp.verdict.tone)}`}>
          {fp.verdict.label}
        </span>
      </div>

      {/* Futures buildup */}
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <span className="text-[10px] text-muted-foreground">Futures</span>
        {fp.futures ? (
          <span className="flex items-center gap-1">
            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border ${BUILDUP_STYLES[fp.futures.buildup]}`}>
              {BUILDUP_LABELS[fp.futures.buildup]}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">
              {fmtPct(fp.futures.priceChgPct, 1)} · OI {fmtPct(fp.futures.oiChgPct, 1)}
            </span>
          </span>
        ) : (
          <span className="text-[9px] text-muted-foreground">no futures data</span>
        )}
      </div>

      {/* PCR velocity */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-muted-foreground">PCR</span>
        <PcrCell fp={fp} />
      </div>

      {/* Writer-vs-buyer churn */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-muted-foreground">Flow</span>
        <span className={`text-[10px] font-semibold ${CHURN_STYLES[fp.churn.label]}`}>
          {fp.churn.label}
          {fp.churn.ratio != null && (
            <span className="ml-1 font-mono text-[9px] text-muted-foreground">r={fp.churn.ratio.toFixed(2)}</span>
          )}
        </span>
      </div>

      {/* Fresh walls */}
      <div className="text-[9px] leading-relaxed border-t border-border/30 pt-1">
        <div className="flex justify-between gap-1">
          <span className="text-muted-foreground">CE walls</span>
          <span className="font-mono text-red-300/90">
            {fp.freshWalls.ceAdds.length > 0
              ? fp.freshWalls.ceAdds.slice(0, 2).map(w => `${w.strike.toLocaleString('en-IN')} +${fmtOI(w.delta)}`).join(' · ')
              : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1">
          <span className="text-muted-foreground">PE walls</span>
          <span className="font-mono text-emerald-300/90">
            {fp.freshWalls.peAdds.length > 0
              ? fp.freshWalls.peAdds.slice(0, 2).map(w => `${w.strike.toLocaleString('en-IN')} +${fmtOI(w.delta)}`).join(' · ')
              : '—'}
          </span>
        </div>
      </div>

      {/* Verdict sentence */}
      <div className="text-[9px] italic text-muted-foreground border-t border-border/30 pt-1">
        &ldquo;{fp.verdict.sentence}&rdquo;
      </div>
    </div>
  );
}

// ─── Main card ───

export function SmartMoneyFootprintCard({
  footprint,
  mode,
  lastPollAt,
}: {
  footprint: SymbolFootprint[];
  mode: 'live' | 'demo' | 'error' | 'loading';
  lastPollAt: number;
}) {
  const indices = useMemo(() => footprint.filter(f => f.type === 'index'), [footprint]);
  const stocks = useMemo(() => footprint.filter(f => f.type === 'stock'), [footprint]);

  // Delta window label (from the first index baseline — same day capture)
  const deltaWindow = useMemo(() => {
    const ages = indices.map(i => i.baselineAgeMin).filter((a): a is number => a != null);
    if (ages.length === 0) return null;
    return fmtAge(Math.max(...ages));
  }, [indices]);

  // Top fresh wall across CE+PE for the stock table
  const topWall = (fp: SymbolFootprint): string => {
    const ce = fp.freshWalls.ceAdds[0];
    const pe = fp.freshWalls.peAdds[0];
    const best =
      ce && pe ? (ce.delta >= pe.delta ? { ...ce, side: 'CE' } : { ...pe, side: 'PE' })
      : ce ? { ...ce, side: 'CE' }
      : pe ? { ...pe, side: 'PE' }
      : null;
    return best ? `${best.side} ${best.strike.toLocaleString('en-IN')} +${fmtOI(best.delta)}` : '—';
  };

  const pollStr = lastPollAt > 0
    ? new Date(lastPollAt).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })
    : '—';

  const hasData = footprint.length > 0;
  const anyBaseline = footprint.some(f => f.hasBaseline);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ScanEye className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Live Smart-Money Footprint — Who Is Moving the Market</h3>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            futures buildup · fresh OI walls · PCR velocity · writer-vs-buyer
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Badge
            variant="outline"
            className={mode === 'live' && hasData
              ? 'border-emerald-500/40 text-emerald-300'
              : mode === 'error'
                ? 'border-red-500/40 text-red-300'
                : 'border-orange-500/40 text-orange-300'}
          >
            {mode === 'live' ? (hasData ? 'LIVE' : 'Scanning') : mode === 'error' ? 'Error' : mode === 'demo' ? 'Demo' : 'Loading'}
          </Badge>
          {deltaWindow && (
            <span className="text-muted-foreground">Δ window: {deltaWindow}</span>
          )}
          <span className="text-muted-foreground">Poll: {pollStr}</span>
        </div>
      </div>

      {/* Empty states */}
      {!hasData && mode === 'loading' && (
        <div className="h-[80px] flex items-center justify-center text-xs text-muted-foreground">
          Waiting for the first magnet scan of the session...
        </div>
      )}
      {!hasData && (mode === 'demo' || mode === 'error') && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-xs text-orange-300">
          Footprint needs live Kite data — configure credentials in Settings. Deltas build from the first scan after market open.
        </div>
      )}
      {hasData && !anyBaseline && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5 text-[10px] text-sky-300 mb-2 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Baseline captured on this scan — deltas, walls and verdicts start building from the NEXT poll (60s).
        </div>
      )}

      {/* Indices — 4 detailed cards */}
      {indices.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-block w-1 h-3 bg-amber-400 rounded-sm" />
            <h4 className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">
              Indices ({indices.length}/4)
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            {indices.map(fp => <FootprintIndexCard key={fp.symbol} fp={fp} />)}
          </div>
        </>
      )}

      {/* Stocks — compact table */}
      {stocks.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-block w-1 h-3 bg-orange-400 rounded-sm" />
            <h4 className="text-[11px] font-semibold text-orange-300 uppercase tracking-wider">
              F&amp;O Stocks ({stocks.length}/15)
            </h4>
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border/40">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="text-left py-1.5 px-2 font-medium">Symbol</th>
                  <th className="text-left py-1.5 px-2 font-medium">Verdict</th>
                  <th className="text-left py-1.5 px-2 font-medium hidden sm:table-cell">Futures</th>
                  <th className="text-left py-1.5 px-2 font-medium">PCR</th>
                  <th className="text-left py-1.5 px-2 font-medium">Flow</th>
                  <th className="text-left py-1.5 px-2 font-medium hidden md:table-cell">Top wall</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map(fp => (
                  <tr key={fp.symbol} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                    <td className="py-1 px-2 font-semibold">{fp.symbol}</td>
                    <td className="py-1 px-2">
                      <span className={`font-semibold ${fp.verdict.tone === 'bullish' ? 'text-emerald-300' : fp.verdict.tone === 'bearish' ? 'text-red-300' : fp.verdict.tone === 'churn' ? 'text-amber-300' : 'text-muted-foreground'}`}>
                        {fp.verdict.label}
                      </span>
                    </td>
                    <td className="py-1 px-2 hidden sm:table-cell">
                      {fp.futures ? (
                        <span className="font-mono">
                          <span className={fp.futures.tone === 'bullish' ? 'text-emerald-400' : fp.futures.tone === 'bearish' ? 'text-red-400' : 'text-muted-foreground'}>
                            {BUILDUP_LABELS[fp.futures.buildup]}
                          </span>
                          <span className="text-muted-foreground"> {fmtPct(fp.futures.priceChgPct, 1)}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-1 px-2"><PcrCell fp={fp} /></td>
                    <td className={`py-1 px-2 font-semibold ${CHURN_STYLES[fp.churn.label]}`}>
                      {fp.churn.label}{fp.churn.ratio != null && <span className="ml-1 font-mono text-[9px] text-muted-foreground">{fp.churn.ratio.toFixed(2)}</span>}
                    </td>
                    <td className="py-1 px-2 font-mono hidden md:table-cell text-muted-foreground">{topWall(fp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Legend / how to read */}
      <div className="mt-3 pt-3 border-t border-border/30 text-[10px] text-muted-foreground space-y-1">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><strong className="text-emerald-300">LONG BUILDUP</strong> price↑ + futures OI↑ — institutions going long</span>
          <span><strong className="text-red-300">SHORT BUILDUP</strong> price↓ + futures OI↑ — desks betting down</span>
          <span><strong className="text-emerald-400/80">SHORT COVERING</strong> price↑ + OI↓ — weak squeeze rally</span>
          <span><strong className="text-orange-300">LONG UNWINDING</strong> price↓ + OI↓ — no conviction</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><strong className="text-purple-300">POSITIONING</strong> fresh OI ÷ volume high — builders (desks) active</span>
          <span><strong className="text-amber-300">CHURN</strong> heavy volume, little fresh OI — retail-dominant tape</span>
          <span><strong>PCR ↑</strong> put writing (bullish desks) · <strong>PCR ↓</strong> call writing (bearish desks)</span>
        </div>
        <div className="italic">
          Why it works: SEBI/NSE label trades FII/Pro/Client only AFTER close (Factor 12). Live, desks leave footprints —
          they WRITE options and trade futures (retail BUYS options and barely touches futures). Deltas are measured vs the
          first capture of the day (persisted in Upstash, survives server restarts); if the dashboard first polls at 11:00,
          the delta window starts at 11:00. Strike-level deltas skip strikes that entered the sliding window mid-day.
          EOD confirmation comes from the Participant Flow card (Factor 12) after NSE publishes the participant reports.
        </div>
      </div>
    </div>
  );
}
