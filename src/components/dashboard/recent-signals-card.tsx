'use client';

/**
 * Recent Signals Card
 * -------------------
 *
 * Shows the 5 most-recent signal flips across ALL 19 symbols (4 indices +
 * 15 F&O stocks), pulled from the 7-day Upstash Redis rolling history.
 *
 * Each row shows:
 *   - Time (IST, "2m ago" relative + HH:MM absolute)
 *   - Symbol (e.g. "NIFTY 50", "RELIANCE")
 *   - Direction chip (CALL green / PUT red / WAIT gray)
 *   - Strength tier (S/M/W)
 *   - Score (signed, -15..+15)
 *   - Spot at signal time
 *   - Outcome badge (✓ win / ✗ loss / ~ partial / ? pending)
 *
 * Polls /api/kite/recent-signals?limit=5 every 60s.
 *
 * If Upstash is not configured, shows a friendly "no history yet" state
 * with an explanation that the card will populate after the first signal
 * flips during market hours.
 */

import { useEffect, useState, useCallback } from 'react';
import { History, TrendingUp, TrendingDown, CircleSlash, RefreshCw } from 'lucide-react';
import { withCreds } from '@/lib/kite-creds';

// Mirror of SignalHistoryEntry from src/lib/signal-history.ts
interface RecentSignalEntry {
  symbol: string;
  ts: number;
  spot: number;
  direction: 'CALL' | 'PUT' | 'WAIT';
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  score: number;
  confidence: number;
  maxPain: number;
  magnetCenter: number;
  zeroGamma: number | null;
  pinning: number;
  basisPct: number | null;
  ivSkewPct: number | null;
  oiBuildup: string;
  vix: number | null;
  outcome?: 'win' | 'loss' | 'partial' | 'expired' | null;
  outcomeMovePct?: number | null;
}

interface RecentSignalsResponse {
  mode: 'live' | 'error';
  signals: RecentSignalEntry[];
  count: number;
  timestamp: string;
  error?: string;
}

const POLL_INTERVAL_MS = 60_000; // 60s — same as magnet-scan

// ─── Helpers ───

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtIST(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

function fmtSpot(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

// ─── Direction chip ───

function DirectionChip({ direction, strength }: {
  direction: RecentSignalEntry['direction'];
  strength: RecentSignalEntry['strength'];
}) {
  const strengthLetter = strength === 'STRONG' ? 'S' : strength === 'MODERATE' ? 'M' : strength === 'WEAK' ? 'W' : '';
  if (direction === 'CALL') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-emerald-500/50 bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[10px] font-bold">
        <TrendingUp className="h-2.5 w-2.5" />
        CALL{strengthLetter && <span className="opacity-70 ml-0.5">{strengthLetter}</span>}
      </span>
    );
  }
  if (direction === 'PUT') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-red-500/50 bg-red-500/15 text-red-400 px-1.5 py-0.5 text-[10px] font-bold">
        <TrendingDown className="h-2.5 w-2.5" />
        PUT{strengthLetter && <span className="opacity-70 ml-0.5">{strengthLetter}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-zinc-500/50 bg-zinc-500/15 text-zinc-400 px-1.5 py-0.5 text-[10px] font-bold">
      <CircleSlash className="h-2.5 w-2.5" />
      WAIT
    </span>
  );
}

// ─── Outcome badge ───

function OutcomeBadge({ outcome, movePct }: {
  outcome: RecentSignalEntry['outcome'];
  movePct?: number | null;
}) {
  if (!outcome) {
    return <span className="text-[9px] text-muted-foreground/60 font-mono">pending</span>;
  }
  const moveStr = typeof movePct === 'number'
    ? `${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%`
    : '';

  if (outcome === 'win') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-emerald-400">
        ✓ {moveStr}
      </span>
    );
  }
  if (outcome === 'loss') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-red-400">
        ✗ {moveStr}
      </span>
    );
  }
  if (outcome === 'partial') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-amber-400">
        ~ {moveStr}
      </span>
    );
  }
  // expired
  return <span className="text-[9px] font-mono text-muted-foreground/60">expired</span>;
}

// ─── Score cell ───

function ScoreCell({ score }: { score: number }) {
  const color = score > 0.5 ? 'text-emerald-400'
              : score < -0.5 ? 'text-red-400'
              : 'text-muted-foreground';
  return (
    <span className={`text-[10px] font-mono font-semibold ${color}`}>
      {score > 0 ? '+' : ''}{score.toFixed(1)}
    </span>
  );
}

// ─── Main component ───

export function RecentSignalsCard() {
  const [signals, setSignals] = useState<RecentSignalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(withCreds('/api/kite/recent-signals?limit=5'));
      const json: RecentSignalsResponse = await res.json();
      if (json.mode === 'live') {
        setSignals(json.signals);
        setError(null);
      } else {
        setError(json.error || 'Failed to load recent signals');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLastFetch(Date.now());
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    const timer = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchSignals]);

  return (
    <div className="rounded-xl border border-border bg-card/50 backdrop-blur p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-sky-400" />
          <h3 className="text-xs font-bold tracking-wide text-foreground">
            Recent Signals
          </h3>
          <span className="text-[9px] text-muted-foreground font-mono">
            (7-day history)
          </span>
        </div>
        <button
          onClick={fetchSignals}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Last refresh: ${lastFetch ? fmtRelative(lastFetch) : 'never'}`}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      {loading && signals.length === 0 ? (
        <div className="py-8 text-center text-[10px] text-muted-foreground">
          Loading recent signals…
        </div>
      ) : error ? (
        <div className="py-6 text-center text-[10px] text-red-400">
          {error}
        </div>
      ) : signals.length === 0 ? (
        <div className="py-6 text-center text-[10px] text-muted-foreground">
          <div className="mb-1">No signal history yet</div>
          <div className="text-[9px] text-muted-foreground/70">
            Card will populate once signals fire during market hours.
            <br />
            First few sessions will build the 7-day rolling database.
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Column header */}
          <div className="grid grid-cols-[60px_1fr_70px_45px_60px_60px] gap-2 text-[9px] text-muted-foreground uppercase tracking-wider font-mono px-1 pb-1 border-b border-border/30">
            <span>Time</span>
            <span>Symbol</span>
            <span>Signal</span>
            <span>Score</span>
            <span>Spot</span>
            <span className="text-right">Result</span>
          </div>

          {/* Rows */}
          {signals.map((s, i) => (
            <div
              key={`${s.symbol}-${s.ts}-${i}`}
              className="grid grid-cols-[60px_1fr_70px_45px_60px_60px] gap-2 items-center text-[10px] px-1 py-1 hover:bg-accent/30 rounded transition-colors"
            >
              <div className="font-mono text-muted-foreground">
                <div>{fmtRelative(s.ts)}</div>
                <div className="text-[8px] text-muted-foreground/60">{fmtIST(s.ts)}</div>
              </div>
              <div className="font-semibold text-foreground truncate" title={s.symbol}>
                {s.symbol}
              </div>
              <div>
                <DirectionChip direction={s.direction} strength={s.strength} />
              </div>
              <div>
                <ScoreCell score={s.score} />
              </div>
              <div className="font-mono text-muted-foreground text-right">
                {fmtSpot(s.spot)}
              </div>
              <div className="text-right">
                <OutcomeBadge outcome={s.outcome} movePct={s.outcomeMovePct} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {signals.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between text-[9px] text-muted-foreground/70 font-mono">
          <span>
            {signals.filter(s => s.outcome === 'win').length}/{signals.filter(s => s.outcome && s.outcome !== 'expired').length} resolved wins
          </span>
          <span>
            Updated {fmtRelative(lastFetch)}
          </span>
        </div>
      )}
    </div>
  );
}
