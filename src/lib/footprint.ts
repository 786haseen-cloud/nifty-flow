/**
 * Live Smart-Money Footprint — pure classification logic (no I/O).
 * ─────────────────────────────────────────────────────────────────
 *
 * USER'S MODEL (Sep 2026): "FII and prop desk move the market and always
 * bet against the retail client." SEBI/NSE only label trades FII / Pro /
 * Client AFTER market close (the 4 participant reports → Factor 12).
 * During the live session nobody gets a labeled feed — so we read the
 * footprints that distinguish desks from the crowd:
 *
 *   1. FUTURES OI + PRICE  — retail barely trades futures (lot sizes),
 *      so futures OI is essentially FII/Prop positioning:
 *        price ↑ + OI ↑ → LONG BUILDUP   (institutions going long)
 *        price ↓ + OI ↑ → SHORT BUILDUP  (desks betting down — live PUT case)
 *        price ↑ + OI ↓ → SHORT COVERING (retail rally, weak)
 *        price ↓ + OI ↓ → LONG UNWINDING (no conviction)
 *
 *   2. OPTION WRITING vs BUYING — FII/Pro are structural net option
 *      WRITERS in India; retail is structural net BUYER:
 *        OI jumping at a strike  → desks building walls/magnets
 *        volume ↑ but OI flat    → retail churning lottery tickets
 *
 *   3. WRITER-vs-BUYER RATIO — Σ|ΔOI| ÷ Σvolume. Fresh positions move OI
 *      (ratio high = positioning/builders); day-trade churn moves volume
 *      without moving OI (ratio low = retail-dominant tape).
 *
 *   4. PCR VELOCITY — not the PCR level (stale) but the intraday direction
 *      of change: rising = put writing (bullish desks), falling = call
 *      writing (bearish desks).
 *
 * All deltas are measured against the FIRST CAPTURE of the IST day
 * (baseline persisted in Upstash by footprint-service.ts so Vercel cold
 * starts don't reset it). If the dashboard first polls at 11:00, deltas
 * run from 11:00 — the panel labels this honestly.
 *
 * KNOWN LIMITATION: the 11-strike window follows spot. A strike that
 * enters the window mid-day has no baseline → excluded from delta math
 * (treated as unknown, not as a fresh add), so ΔOI slightly undercounts
 * on fast-moving days. Acceptable for a live panel.
 */

// ─── Types ───

export type BuildupLabel =
  | 'LONG_BUILDUP'    // price ↑ + OI ↑ — institutions going long
  | 'SHORT_BUILDUP'   // price ↓ + OI ↑ — desks betting down
  | 'SHORT_COVERING'  // price ↑ + OI ↓ — short squeeze, weak rally
  | 'LONG_UNWINDING'  // price ↓ + OI ↓ — longs exiting
  | 'NEUTRAL';

export type BuildupTone = 'bullish' | 'bearish' | 'neutral';
export type ChurnLabel = 'POSITIONING' | 'MIXED' | 'CHURN' | 'UNKNOWN';
export type PcrDirection = 'rising' | 'falling' | 'flat';
export type VerdictTone = 'bullish' | 'bearish' | 'neutral' | 'churn';

/** One strike's live OI + day-cumulative option volume (contracts). */
export interface StrikeFoot {
  strike: number;
  ceOI: number;
  peOI: number;
  ceVol: number;
  peVol: number;
}

/** First capture of the day — persisted per symbol per IST date. */
export interface FootprintBaseline {
  /** Unix ms when this baseline was captured. */
  ts: number;
  /** Futures OI at capture (null if future quote unavailable). */
  futOi: number | null;
  /** Futures LTP at capture. */
  futLtp: number | null;
  /** Futures previous-day close at capture (for price-change math). */
  futPrevClose: number | null;
  /** Strike-level OI + volume snapshot. */
  strikes: StrikeFoot[];
}

/** A strike whose OI grew vs baseline — a "fresh wall". */
export interface FreshWall {
  strike: number;
  delta: number;
  /** % distance of the strike from current spot (signed). */
  distPct: number;
}

export interface SymbolFootprint {
  symbol: string;
  type: 'index' | 'stock';
  spot: number;
  /** False until the day's baseline exists (first scan of the day). */
  hasBaseline: boolean;
  /** Minutes since baseline capture (null when no baseline). */
  baselineAgeMin: number | null;
  futures: {
    buildup: BuildupLabel;
    tone: BuildupTone;
    /** Futures price change vs previous close (%). */
    priceChgPct: number | null;
    /** Futures OI change vs baseline (%). */
    oiChgPct: number | null;
    /** Futures OI change vs baseline (absolute contracts). */
    oiChgAbs: number | null;
  } | null;
  pcr: {
    now: number | null;
    delta: number | null;
    direction: PcrDirection;
  };
  churn: {
    /** Σ|ΔOI| ÷ Σvolume over the common strike window (null = unknown). */
    ratio: number | null;
    label: ChurnLabel;
    absDeltaOi: number | null;
    volume: number | null;
  };
  freshWalls: {
    ceAdds: FreshWall[];
    peAdds: FreshWall[];
  };
  verdict: {
    label: string;
    tone: VerdictTone;
    score: number;
    sentence: string;
  };
}

export interface FootprintInput {
  symbol: string;
  type: 'index' | 'stock';
  spot: number;
  baseline: FootprintBaseline | null;
  /** True when the baseline was captured THIS scan (deltas are zero). */
  baselineFresh: boolean;
  /** Current futures quote data (null if future instrument unavailable). */
  futures: { ltp: number; oi: number; volume: number; prevClose: number } | null;
  /** Current strike OI + volume snapshot. */
  strikes: StrikeFoot[];
  nowMs: number;
}

// ─── Tunable thresholds (calibration constants — change here only) ───

/** Min futures price change (%) for a directional buildup classification. */
export const FUT_PRICE_MOVE_PCT = 0.15;
/** Min futures OI change (%) for a directional buildup classification. */
export const FUT_OI_MOVE_PCT = 0.3;
/** PCR delta band considered flat (PCR is slow-moving). */
export const PCR_FLAT_BAND = 0.02;
/** Σ|ΔOI|/Σvolume ≥ this → fresh positioning dominates (builders active). */
export const CHURN_POSITIONING_RATIO = 0.35;
/** Σ|ΔOI|/Σvolume ≤ this → churn dominates (retail-dominant tape). */
export const CHURN_LOW_RATIO = 0.15;
/** Walls within ±1% of spot count as "near" (they actually defend price). */
export const WALL_NEAR_PCT = 1.0;
/** One side's near-wall adds must exceed the other's by 20% to call it. */
export const WALL_DOMINANCE = 1.2;
/** Top-N fresh walls reported per side. */
export const WALL_TOP_N = 3;

// ─── Classifiers ───

/**
 * Classify futures OI × price action into the classic 4 buildup states.
 * Requires OI change vs the day baseline (intraday positioning change).
 */
export function classifyFuturesBuildup(
  priceChgPct: number,
  oiChgPct: number,
): { buildup: BuildupLabel; tone: BuildupTone } {
  const up = priceChgPct >= FUT_PRICE_MOVE_PCT;
  const down = priceChgPct <= -FUT_PRICE_MOVE_PCT;
  const oiUp = oiChgPct >= FUT_OI_MOVE_PCT;
  const oiDown = oiChgPct <= -FUT_OI_MOVE_PCT;

  if (up && oiUp) return { buildup: 'LONG_BUILDUP', tone: 'bullish' };
  if (down && oiUp) return { buildup: 'SHORT_BUILDUP', tone: 'bearish' };
  if (up && oiDown) return { buildup: 'SHORT_COVERING', tone: 'bullish' };
  if (down && oiDown) return { buildup: 'LONG_UNWINDING', tone: 'bearish' };
  return { buildup: 'NEUTRAL', tone: 'neutral' };
}

/**
 * Writer-vs-buyer classification from Σ|ΔOI| ÷ Σvolume.
 * High ratio → positions opened AND held (builders = desks leaving
 * footprints). Low ratio → heavy trading but little fresh OI (retail
 * churning between themselves).
 */
export function classifyChurn(ratio: number | null): { label: ChurnLabel } {
  if (ratio == null) return { label: 'UNKNOWN' };
  if (ratio >= CHURN_POSITIONING_RATIO) return { label: 'POSITIONING' };
  if (ratio <= CHURN_LOW_RATIO) return { label: 'CHURN' };
  return { label: 'MIXED' };
}

/** PCR velocity — direction of intraday change, not the level. */
export function pcrDirection(
  pcrNow: number | null,
  pcrBase: number | null,
): { direction: PcrDirection; delta: number | null } {
  if (pcrNow == null || pcrBase == null) return { direction: 'flat', delta: null };
  const delta = pcrNow - pcrBase;
  if (delta > PCR_FLAT_BAND) return { direction: 'rising', delta };
  if (delta < -PCR_FLAT_BAND) return { direction: 'falling', delta };
  return { direction: 'flat', delta };
}

/**
 * Fresh walls: strikes whose OI GREW vs baseline (top N per side).
 * Only strikes present in BOTH windows are considered — a strike that
 * just entered the sliding window has no honest delta.
 */
export function computeFreshWalls(
  baselineStrikes: StrikeFoot[],
  nowStrikes: StrikeFoot[],
  spot: number,
): { ceAdds: FreshWall[]; peAdds: FreshWall[] } {
  const baseMap = new Map<number, StrikeFoot>();
  for (const s of baselineStrikes) baseMap.set(s.strike, s);

  const ceAdds: FreshWall[] = [];
  const peAdds: FreshWall[] = [];
  for (const s of nowStrikes) {
    const b = baseMap.get(s.strike);
    if (!b) continue; // entered window mid-day — skip (unknown delta)
    const dCE = s.ceOI - b.ceOI;
    const dPE = s.peOI - b.peOI;
    const distPct = spot > 0 ? ((s.strike - spot) / spot) * 100 : 0;
    if (dCE > 0) ceAdds.push({ strike: s.strike, delta: dCE, distPct });
    if (dPE > 0) peAdds.push({ strike: s.strike, delta: dPE, distPct });
  }
  ceAdds.sort((a, b) => b.delta - a.delta);
  peAdds.sort((a, b) => b.delta - a.delta);
  return { ceAdds: ceAdds.slice(0, WALL_TOP_N), peAdds: peAdds.slice(0, WALL_TOP_N) };
}

/**
 * Composite live verdict — combines the four footprints into one label
 * + one plain-English sentence the trader can read in two seconds.
 *
 * Scoring: buildup ±2/±1, PCR velocity ±1, near-spot wall dominance ±1.
 * Retail-churn override: heavy churn + no directional desk evidence
 * → 'RETAIL CHURN' (the crowd is the story, not the desks).
 */
export function composeVerdict(
  buildup: { buildup: BuildupLabel; tone: BuildupTone } | null,
  pcr: { direction: PcrDirection; delta: number | null },
  walls: { ceAdds: FreshWall[]; peAdds: FreshWall[] },
  churn: ChurnLabel,
): { label: string; tone: VerdictTone; score: number; sentence: string } {
  let score = 0;
  const parts: string[] = [];

  if (buildup) {
    switch (buildup.buildup) {
      case 'LONG_BUILDUP':
        score += 2;
        parts.push('futures long buildup');
        break;
      case 'SHORT_BUILDUP':
        score -= 2;
        parts.push('futures short buildup');
        break;
      case 'SHORT_COVERING':
        score += 1;
        parts.push('futures short covering');
        break;
      case 'LONG_UNWINDING':
        score -= 1;
        parts.push('futures long unwinding');
        break;
      default:
        break;
    }
  }

  if (pcr.direction === 'rising') {
    score += 1;
    parts.push('put writing active');
  } else if (pcr.direction === 'falling') {
    score -= 1;
    parts.push('call writing active');
  }

  // Near-spot wall dominance — fresh OI adds that actually defend price
  const nearCE = walls.ceAdds.filter(w => Math.abs(w.distPct) <= WALL_NEAR_PCT);
  const nearPE = walls.peAdds.filter(w => Math.abs(w.distPct) <= WALL_NEAR_PCT);
  const ceSum = nearCE.reduce((a, w) => a + w.delta, 0);
  const peSum = nearPE.reduce((a, w) => a + w.delta, 0);
  if (peSum > 0 && peSum > ceSum * WALL_DOMINANCE) {
    score += 1;
    parts.push(`put walls building @ ${nearPE[0].strike.toLocaleString('en-IN')}`);
  } else if (ceSum > 0 && ceSum > peSum * WALL_DOMINANCE) {
    score -= 1;
    parts.push(`call walls building @ ${nearCE[0].strike.toLocaleString('en-IN')}`);
  }

  // Verdict label + tone
  let label: string;
  let tone: VerdictTone;
  if (churn === 'CHURN' && Math.abs(score) <= 1) {
    label = 'RETAIL CHURN';
    tone = 'churn';
  } else if (score >= 2) {
    label = 'SMART MONEY BULLISH';
    tone = 'bullish';
  } else if (score <= -2) {
    label = 'SMART MONEY BEARISH';
    tone = 'bearish';
  } else if (score === 1) {
    label = 'BULLISH LEAN';
    tone = 'bullish';
  } else if (score === -1) {
    label = 'BEARISH LEAN';
    tone = 'bearish';
  } else {
    label = 'MIXED';
    tone = 'neutral';
  }

  // Sentence
  let sentence: string;
  if (tone === 'churn') {
    sentence = 'Heavy churn, little fresh OI — retail-dominant tape, no institutional conviction.';
  } else if (parts.length === 0) {
    sentence = 'No strong institutional footprint yet — flow is two-sided.';
  } else {
    const conclusion =
      tone === 'bullish' ? 'desks positioning bullish'
      : tone === 'bearish' ? 'desks positioning bearish'
      : 'flow is two-sided';
    const confirm = churn === 'POSITIONING' && Math.abs(score) >= 2
      ? ' — heavy fresh positioning confirms desks'
      : '';
    sentence = `${parts.join(' + ')} — ${conclusion}${confirm}.`;
  }

  return { label, tone, score, sentence };
}

// ─── Orchestrator ───

/**
 * Compute one symbol's live footprint from baseline + current data.
 * Pure — fully unit-testable.
 */
export function computeSymbolFootprint(input: FootprintInput): SymbolFootprint {
  const { symbol, type, spot, baseline, baselineFresh, futures, strikes, nowMs } = input;

  const shell: SymbolFootprint = {
    symbol,
    type,
    spot,
    hasBaseline: false,
    baselineAgeMin: null,
    futures: null,
    pcr: { now: null, delta: null, direction: 'flat' },
    churn: { ratio: null, label: 'UNKNOWN', absDeltaOi: null, volume: null },
    freshWalls: { ceAdds: [], peAdds: [] },
    verdict: {
      label: 'BASELINE SET',
      tone: 'neutral',
      score: 0,
      sentence: baseline
        ? 'Baseline captured this scan — footprint deltas build through the session.'
        : 'Waiting for the first scan of the day to set the baseline.',
    },
  };

  // No baseline (or captured THIS scan) → nothing to diff against yet.
  // PCR "now" is still computable and shown (delta is not).
  const totalCE = strikes.reduce((a, s) => a + s.ceOI, 0);
  const totalPE = strikes.reduce((a, s) => a + s.peOI, 0);
  shell.pcr.now = totalCE > 0 ? totalPE / totalCE : null;

  if (!baseline || baselineFresh) {
    return shell;
  }

  shell.hasBaseline = true;
  shell.baselineAgeMin = Math.max(0, Math.round((nowMs - baseline.ts) / 60_000));

  // ── Futures buildup ──
  if (
    futures && futures.ltp > 0 && futures.prevClose > 0 &&
    baseline.futOi != null && baseline.futOi > 0 && futures.oi > 0
  ) {
    const priceChgPct = ((futures.ltp - futures.prevClose) / futures.prevClose) * 100;
    const oiChgAbs = futures.oi - baseline.futOi;
    const oiChgPct = (oiChgAbs / baseline.futOi) * 100;
    const cls = classifyFuturesBuildup(priceChgPct, oiChgPct);
    shell.futures = { buildup: cls.buildup, tone: cls.tone, priceChgPct, oiChgPct, oiChgAbs };
  }

  // ── PCR velocity (over the common strike window) ──
  const baseMap = new Map<number, StrikeFoot>();
  for (const s of baseline.strikes) baseMap.set(s.strike, s);
  let ceNow = 0, peNow = 0, ceBase = 0, peBase = 0;
  let absDeltaOi = 0, volume = 0;
  for (const s of strikes) {
    const b = baseMap.get(s.strike);
    if (!b) continue;
    ceNow += s.ceOI; peNow += s.peOI;
    ceBase += b.ceOI; peBase += b.peOI;
    absDeltaOi += Math.abs(s.ceOI - b.ceOI) + Math.abs(s.peOI - b.peOI);
    volume += s.ceVol + s.peVol;
  }
  const pcrNow = ceNow > 0 ? peNow / ceNow : null;
  const pcrBase = ceBase > 0 ? peBase / ceBase : null;
  const pcr = pcrDirection(pcrNow, pcrBase);
  shell.pcr = { now: pcrNow, delta: pcr.delta, direction: pcr.direction };

  // ── Writer-vs-buyer (churn) ratio ──
  const ratio = volume > 0 ? absDeltaOi / volume : null;
  shell.churn = { ratio, label: classifyChurn(ratio).label, absDeltaOi, volume };

  // ── Fresh walls ──
  shell.freshWalls = computeFreshWalls(baseline.strikes, strikes, spot);

  // ── Verdict ──
  shell.verdict = composeVerdict(shell.futures, shell.pcr, shell.freshWalls, shell.churn.label);

  return shell;
}

// ─── Baseline factory ───

/**
 * Build a day-baseline from the current scan (called when no baseline
 * exists for this symbol yet on this IST date).
 */
export function makeBaseline(
  futures: { oi: number; ltp: number; prevClose: number } | null,
  strikes: StrikeFoot[],
  nowMs: number,
): FootprintBaseline {
  return {
    ts: nowMs,
    futOi: futures && futures.oi > 0 ? futures.oi : null,
    futLtp: futures && futures.ltp > 0 ? futures.ltp : null,
    futPrevClose: futures && futures.prevClose > 0 ? futures.prevClose : null,
    strikes: strikes.map(s => ({ ...s })),
  };
}
