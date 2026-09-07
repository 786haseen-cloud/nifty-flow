# Work Log

---
Task ID: 1
Agent: Main
Task: Implement Max Pain Gravity Meter on OI Walls tab

Work Log:
- Read and analyzed OI Walls tab component (823 lines) to understand layout structure
- Studied strike-flow API route and kite-api.ts batch quote mechanism
- Created new `/api/kite/max-pain-scan/route.ts` — batched endpoint that:
  - Phase 1: Gets all 19 spot prices in one `getQuotes` call
  - Phase 2: Collects all option instrument tokens across all symbols
  - Phase 3: ONE batched `getQuotes` for ALL option tokens (optimized vs 38 individual calls)
  - Phase 4: Computes max pain per symbol server-side
  - Returns: `{ symbols: [{ symbol, name, type, spot, maxPain, dist, distPct, totalCEOI, totalPEOI }], timestamp }`
- Added `MaxPainScanItem` and `GravitySignal` interfaces to oi-walls-tab.tsx
- Added `scanData`, `scanLoading`, `scanError`, `gravitySignal` state variables
- Added `fetchScan` callback with 120-second polling interval
- Added `computeGravitySignal()` logic:
  - STRONG: all 4 indices above MP + stock avg dist > 0.2%
  - MODERATE: 3+ indices above MP + stock avg positive
  - WEAK: 2+ indices above MP
  - DIVERGENT: fewer than 2
- Built UI section below PCR Sparkline with:
  - Circular signal strength indicator (color-coded border + label)
  - Index/stock progress bars (X/Y above max pain)
  - Green callout when STRONG signal fires with thesis explanation
  - Breakdown table: Symbol | Spot | Max Pain | Diff (+/- pts) | PCR
  - Indices section (bold, 4 rows) + F&O Stocks section (15 rows)
  - Color-coded dots and diff values per row
  - Footer note explaining the gravity thesis and best-use conditions
- Added `Gauge` and `ArrowDownToLine` icon imports from lucide-react
- Verified: no TypeScript errors in new code, all imports valid

Stage Summary:
- New file: `src/app/api/kite/max-pain-scan/route.ts`
- Modified: `src/components/dashboard/oi-walls-tab.tsx` (added ~200 lines)
- Placed on OI Walls tab (not new tab) as discussed with user
- Feature: batched scan of 4 indices + 15 stocks' max pain with composite gravity signal

---
Task ID: 2
Agent: Main
Task: India-market recalibration of PCR/Gamma/VIX factors (user approved with "go")

Work Log:
- Diagnosed structural CALL bias: US-calibrated thresholds gifted ~+1.75/day free bullish points in Indian market structure
- Recalibrated Factor 5 PCR Sentiment: >=1.5 +1.0 / 1.3-1.5 +0.5 / 0.7-1.3 neutral / 0.55-0.7 -0.5 / <0.55 -1.0 (Indian put-selling norm 1.1-1.3 = neutral)
- Recalibrated Factor 6 Gamma Regime: symmetric ±0.25 (was +0.5/0)
- Recalibrated Factor 11 VIX: low+stable = 0 (was +0.5), low+falling +0.5 (was +1.0), normal+falling 0 (was +0.5); bearish side unchanged
- Updated scoring-model comment block + computeVIXRegime docstring with India calibration notes
- Updated test-phase1-enhancements.ts: VIX low+falling expectation 1.0→0.5, added low+stable→neutral test
- Ran tests: 32/32 phase1, 9/9 signal-history, magnet-engine scenarios OK; tsc pre-existing 35 errors unchanged, zero in touched files
- Build passed; committed b6e8788 and pushed origin/main (Vercel auto-deploy)

Stage Summary:
- Typical day now ~+7.0 CALL MODERATE instead of +9.0 STRONG; STRONG requires genuine factor alignment
- Mild/moderate down days now produce PUT signals (basis/IV-skew/OI/charm flip negative and are no longer offset by free bullish points)
- Futures Basis left as-is (data-signed, flips bearish on real down days); carry-adjusted threshold noted as Phase-2 candidate

---
Task ID: 3
Agent: Main
Task: Update tracked stocks to Sep 2026 NIFTY50/SENSEX top-15 by index weight (user provided both weight lists)

Work Log:
- Diffed user's new top-15 vs codebase: removed HINDUNILVR/MARUTI/TATAMOTORS; added M&M/ETERNAL/TITAN (ETERNAL already existed in demo/types lists but not in live STOCK_SPECS)
- kite-api.ts: added niftyWeight/sensexWeight to InstrumentSpec; rewrote STOCK_SPECS ordered by new NIFTY weight with Kite aliases (M&M→MAHINDRA, ETERNAL→ZOMATO, TITAN→TITAN COMPANY)
- types.ts: TOP_STOCKS weights + reorder; added TRACKED_SYMBOLS shared export (single source of truth for 4 indices + 15 stocks)
- trends/route.ts: deleted duplicated NIFTY_WEIGHTS map; uses spec.niftyWeight
- Synced 7 UI surfaces: alerts-tab, multi-timeframe-tab, journal-tab (incl LOT_SIZES), futures-basis-tab (SECTORS + Consumer color + demo prices), highest-bet-tracker (SECTORS groups), weighted-cash-flow (STOCK_CONFIG sensex weights), oi-walls-tab (demo prices/strike steps)
- highest-bet/route.ts: KITE_STOCK_NAMES aliases + demo fallbacks updated
- Verified M&M '&' symbol safety: getQuotes resolves via instruments CSV to numeric tokens (no URL encoding issue); trends route NSE cash equality match on 'M&M' works
- Sweep: zero HINDUNILVR/MARUTI/TATAMOTORS/TMCV refs left in src/; tsc error count 35→35 (all pre-existing); tests 32+9 pass; build clean

Stage Summary:
- Commit 9c0727e pushed origin/main (Vercel auto-deploy)
- All 19 tracked symbols now: NIFTY, BANKNIFTY, SENSEX, FINNIFTY + HDFCBANK, ICICIBANK, RELIANCE, BHARTIARTL, LT, SBIN, INFY, AXISBANK, KOTAKBANK, M&M, BAJFINANCE, ITC, TCS, ETERNAL, TITAN
- Weights centralized on InstrumentSpec for future weighted index-impact features

---
Task ID: 3
Agent: Main
Task: Phase 2 — Factor 12 (Participant Bias): FII/DII/Client/PropDesk daily institutional flow as basket-level signal factor

Work Log:
- Audited codebase for cash-flow / NSE / BSE usage — confirmed "Net Cash Flow — 15 Stocks" card is display-only, never feeds the magnet engine. No double-counting in scoring.
- Designed Factor 12 scoring logic: FII+PropDesk = smart money (primary direction, ±2.0 max at ±2500 Cr), Client = contrarian fade (±0.4 max at ±2000 Cr), DII = counterweight dampener (±0.5 max when opposing smart money).
- Built src/lib/participant-service.ts (260 lines):
  * Upstash Redis integration (same pattern as signal-history.ts)
  * Key: `participants:YYYY-MM-DD`, TTL 30 days (longer than signals — backtest data)
  * getMostRecentParticipantFlow() walks backwards day-by-day from IST today (max 14 days lookback)
  * getCachedParticipantBias() with 5-min in-memory cache (data changes once/day, cache saves ~3,800 Redis calls/day)
  * Graceful degradation: returns neutral 0 when no data / Redis unconfigured
  * computeParticipantBias() pure function — fully unit-testable
- Built src/app/api/participants/daily/route.ts:
  * POST — validates date + 4 numeric fields, stores in Upstash, invalidates bias cache
  * GET — returns last 7 days of history + current bias for the dashboard card
- Wired Factor 12 into src/lib/magnet-engine.ts:
  * Added `participantBias` and `participantBiasDetail` fields to MagnetResult interface
  * Added optional `participantBias` and `participantBiasDetail` to computeMagnet's enhancements param
  * Added Factor 12 block in computeSignal() after Factor 11 (VIX Regime), before pin multiplier
  * Updated scoring model comment header: 11 → 12 factors, max raw score ±15 → ±17
  * When participantBias = 0 (no data), factor is neutral — engine behaves exactly as Phase 1
- Updated src/app/api/kite/magnet-scan/route.ts:
  * Imports getCachedParticipantBias from participant-service
  * Fetches bias ONCE per scan (basket-level — same for all 19 symbols), before the symbol loop
  * Passes bias to computeMagnet via enhancements for every symbol
  * Exposes `participantBias: { weight, detail }` in the response for UI display
- Built src/components/dashboard/participant-flow-card.tsx (290 lines):
  * 4 labeled Cr inputs (FII / DII / Client / PropDesk) + date picker
  * Save button → POST /api/participants/daily, then refetch
  * Pre-fills form with most recent entry for quick editing
  * 7-day history bar chart (FII red / DII green / Client blue / Prop orange)
  * Shows current Factor 12 contribution + bias detail string
  * Warning when Upstash not configured
- Integrated card into src/components/dashboard/trend-analysis-tab.tsx (Section 3.4, above the Magnet grid)
- Updated scripts/test-phase1-enhancements.ts:
  * Added participantBias + participantBiasDetail to base MagnetResult
  * Added Test 8 (Factor 12 — Participant Bias): 9 new test cases
    - Strong smart buying → bull bias (≥+1.5, ≤+2.0)
    - Strong smart selling → bear bias (≤-1.5, ≥-2.0)
    - No data → neutral 0
    - DII opposing FII dampens bias
    - Factor 12 lifts MODERATE → STRONG when institutions confirm
    - Factor 12 appears in reasons[] array with correct weight

Stage Summary:
- All 43 Phase 1 + 9 Phase 2 tests pass (52 total); signal-history tests 9/9; magnet-engine tests pass
- Production build succeeds; new /api/participants/daily route registered
- No new TypeScript errors in any touched file
- Factor 12 is OPT-IN: until user pastes data, behavior is identical to Phase 1 (zero-scored neutral)
- Storage cost: ~80 Upstash commands/day (negligible vs. signal-history's ~3,200)
- Files: src/lib/participant-service.ts (new), src/app/api/participants/daily/route.ts (new), src/components/dashboard/participant-flow-card.tsx (new), src/lib/magnet-engine.ts (edited), src/app/api/kite/magnet-scan/route.ts (edited), src/components/dashboard/trend-analysis-tab.tsx (edited), scripts/test-phase1-enhancements.ts (edited)
- Next: User starts pasting daily FII/DII/Client/PropDesk numbers from NSE website after market close. Factor 12 takes effect the next trading day. After 2-3 weeks of accumulated data, can backtest and tune the smart-money / contrarian / dampener thresholds.

---
Task ID: 4
Agent: Main
Task: CSV upload feature for Participant Flow card — auto-parse NSE reports instead of manual typing

Work Log:
- Examined both uploaded NSE CSV files to understand their formats:
  * fii-dii-nse-latest.csv: "FII/DII Activity" report (cash market) — has DII + FII/FPI rows with BUY/SELL/NET in ₹ Crores. Format: header row with embedded newlines, then data rows with quoted fields.
  * fao_participant_oi_07092026.csv: "Participant-wise OI in Equity Derivatives" — has Client/DII/FII/Pro rows with OI in *number of contracts* (not ₹ Cr). Snapshot, not flow.
- Built src/lib/participant-csv-parser.ts (285 lines):
  * Pure function — no I/O, takes filename + content string, returns structured ParsedParticipantCsv
  * Auto-detects format from filename hints + header inspection
  * parseFiiDiiCash() — extracts FII + DII net (₹ Cr) from FII/DII Activity report
  * parseFaoParticipantOi() — extracts Client/DII/FII/Pro long+short contracts (saved for future Phase 2b positioning factor; does NOT feed Factor 12 because contracts ≠ ₹ Cr)
  * Custom CSV parser handles quoted fields, embedded newlines, comma-thousand numbers, accounting-style negatives (123.45)
  * Date parsing: DD-MMM-YYYY (NSE format), YYYY-MM-DD, DD/MM/YYYY, and DDMMYYYY from filename
- Built src/app/api/participants/parse-csv/route.ts:
  * Accepts multipart/form-data with single `file` field
  * Max 1 MB (NSE CSVs typically < 10 KB)
  * Returns { ok, parsed: ParsedParticipantCsv }
- Updated src/components/dashboard/participant-flow-card.tsx:
  * Added CSV upload zone with drag-and-drop support
  * "Choose CSV file" button triggers hidden <input type="file">
  * On file select → POST to /api/participants/parse-csv → server parses → form fields auto-populated
  * Parse result summary panel shows what was detected + any warnings
  * User reviews the populated values, can edit, then clicks Save (existing flow)
  * Removed need to manually type 4 numbers — now 2 clicks (upload + save)
- Built scripts/test-csv-parser.ts to verify parser against the actual uploaded CSVs:
  * fii-dii-nse-latest.csv → correctly parsed FII +268.94 Cr, DII +597.67 Cr for 2026-09-07
  * fao_participant_oi_07092026.csv → correctly parsed positioning data (Client 14.4M L / 10.8M S contracts, etc.)
- Both formats auto-detected from filename + header inspection

Stage Summary:
- CSV parser correctly handles both NSE file formats the user uploaded
- File 1 (FII/DII cash) → FII +268.94 Cr, DII +597.67 Cr — feeds Factor 12
- File 2 (F&O participant OI) → positioning data saved for Phase 2b (FII/DII/Client/Pro in contracts, not ₹ Cr — cannot feed Factor 12 directly)
- Build succeeds, both new routes registered (/api/participants/daily + /api/participants/parse-csv)
- Type-check clean for all touched files
- Files: src/lib/participant-csv-parser.ts (new, 285 lines), src/app/api/participants/parse-csv/route.ts (new), src/components/dashboard/participant-flow-card.tsx (edited), scripts/test-csv-parser.ts (new)
- Next: User uploads FII/DII cash CSV → form auto-populates → clicks Save → Factor 12 takes effect next trading day. Phase 2b (positioning factor from F&O OI file) can be built later when we have 2-3 weeks of accumulated positioning data.

---
Task ID: 5
Agent: Main
Task: Phase 2b/2c/2e preparation — start accumulating positioning + option chain history

Work Log:
- Extended src/lib/participant-service.ts with two new storage layers:
  1. POSITIONING STORAGE (Phase 2b/2c prep)
     - New types: PositioningReportType, ParticipantPositioning
     - Key: participant_positioning:YYYY-MM-DD:fao_oi | fao_vol
     - TTL: 35 days (covers 5 weekly cycles + buffer for monthly comparisons)
     - Functions: saveParticipantPositioning, getParticipantPositioningByDate, getRecentPositioning
     - Cost: 2 writes/day when user uploads Reports 2 + 3
  2. OPTION CHAIN SNAPSHOT STORAGE (Phase 2e prep)
     - New types: OptionChainSnapshotStrike, OptionChainSnapshot
     - Key: optionchain:SYMBOL:YYYY-MM-DD
     - TTL: 60 days (2 monthly cycles for strike-level analysis)
     - Functions: saveOptionChainSnapshot, getOptionChainSnapshot
     - In-memory idempotency memo (Map<symbol, istDate>) prevents re-snapshotting on every poll
     - Cost: ~19 writes/day at EOD only

- Updated src/app/api/participants/parse-csv/route.ts:
  - When parsed CSV is fao_participant_oi or fao_participant_volume, also
    saves positioning data to Upstash (35-day TTL) — non-fatal if it fails
  - Returns positioningSaved: { reportType, date } | null in response
  - User receives feedback that positioning was auto-saved for Phase 2b/2c

- Updated src/app/api/kite/magnet-scan/route.ts:
  - Declares eodSnapshots Map before per-symbol loop
  - Inside loop, after computeMagnet, captures raw strikes (ceOI, ceLTP,
    peOI, peLTP per strike) + spot + strikeStep + expiry + dte per symbol
  - After loop, when IST time >= 15:25 (5 min before market close),
    flushes all snapshots to Upstash in parallel (fire-and-forget, non-blocking)
  - saveOptionChainSnapshot's idempotency memo ensures one snapshot per
    symbol per IST date — subsequent polls after 15:25 are no-ops

- Updated src/components/dashboard/participant-flow-card.tsx:
  - Added positioningSaved field to ParseCsvResponse type
  - When upload returns positioningSaved, success message updates to
    "OI snapshot auto-saved to Upstash for Phase 2b/2c history"
  - User gets clear feedback that positioning data is being accumulated

Stage Summary:
- Storage layers in place — no factor changes, no UI changes (just feedback)
- Positioning data (Reports 2+3) starts accumulating from today, 35-day TTL
- EOD option chain snapshots start today (during 15:25-15:40 IST window),
  60-day TTL, one per symbol per day, idempotent
- Free-tier budget: ~21 writes/day added (negligible vs 10k limit)
- Storage budget: ~3 KB/symbol/day × 19 symbols × 60 days = ~3.4 MB
  (out of 256 MB free tier = 1.3%)
- All 43 Phase 1+2 tests still pass; build succeeds
- After 2-3 weeks of accumulation, Phase 2b (futures positioning factor)
  can be built with proper historical comparisons
- After 4-6 weeks, Phase 2e (strike-level OI buildup patterns) can be built
