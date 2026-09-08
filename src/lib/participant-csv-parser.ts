/**
 * Participant CSV Parser — auto-detects NSE report format and extracts
 * FII / DII / Client / PropDesk net values in ₹ Crore.
 *
 * ─── Supported file formats ────────────────────────────────────────────
 *
 * 1. NSE "FII/DII Activity" report (cash market)
 *    - Headers: CATEGORY, DATE, BUY VALUE (₹ Crores), SELL VALUE (₹ Crores), NET VALUE (₹ Crores)
 *    - Rows: DII, FII/FPI
 *    - Output: fii, dii populated; client, propdesk = 0
 *    - Sample filename: fii-dii-nse-latest.csv
 *
 * 2. NSE "Participant-wise OI in Equity Derivatives" report (F&O positions)
 *    - Headers: Client Type, Future Index Long, ... Total Short Contracts
 *    - Rows: Client, DII, FII, Pro, TOTAL
 *    - Output: store raw long/short contract counts per participant for
 *      future Phase 2b (positioning factor). Does NOT feed Factor 12
 *      directly (contracts ≠ ₹ Cr).
 *    - Sample filename: fao_participant_oi_07092026.csv
 *
 * 3. (Future) NSE "Participant-wise Trading Volume" report
 *    - Has all 4 participant types with buy/sell/value in ₹ Cr
 *    - Output: fii, dii, client, propdesk all populated
 *
 * ─── API ──────────────────────────────────────────────────────────────
 *
 *   parseParticipantCsv(filename, content) → ParsedParticipantCsv
 *
 * The function is pure — takes a filename (for hint) and string content,
 * returns a structured result. No I/O. Safe to call from API route or tests.
 */

// ─── Types ───

export type CsvFormat =
  | 'fii_dii_cash'      // NSE FII/DII Activity report
  | 'fao_participant_oi' // NSE F&O participant OI snapshot
  | 'fao_participant_volume' // NSE F&O participant trading volume
  | 'cm_participant_volume' // NSE Cash Market participant volume (Client/Pro ₹ Cr)
  | 'unknown';

export interface ParsedParticipantCsv {
  /** Detected format. */
  format: CsvFormat;
  /** Trading date extracted from CSV (YYYY-MM-DD) or null if not found. */
  date: string | null;
  /** FII net in ₹ Cr (signed). 0 if not in this file format. */
  fii: number;
  /** DII net in ₹ Cr (signed). 0 if not in this file format. */
  dii: number;
  /** Client (retail) net in ₹ Cr. 0 if not in this file format. */
  client: number;
  /** Proprietary desk net in ₹ Cr. 0 if not in this file format. */
  propdesk: number;
  /** Raw positioning data (for Phase 2b) — only populated for fao_participant_oi. */
  positioning?: {
    client: { longContracts: number; shortContracts: number };
    dii: { longContracts: number; shortContracts: number };
    fii: { longContracts: number; shortContracts: number };
    pro: { longContracts: number; shortContracts: number };
  };
  /** Human-readable summary of what was parsed. */
  summary: string;
  /** Any warnings (e.g. partial data, format quirks). */
  warnings: string[];
}

// ─── Helpers ───

/**
 * Parse a number that may be:
 *   - "1,234.56"  (Indian/Intl comma-thousand)
 *   - "1234.56"
 *   - "(1,234.56)"  (negative in accounting format)
 *   - "-1234.56"
 * Returns 0 if unparseable.
 */
function parseNumber(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  let negative = false;
  // Accounting-style negative: (123.45) → -123.45
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip commas, spaces, ₹ symbol, "Cr" suffix
  s = s.replace(/[,₹\s]/g, '').replace(/cr$/i, '');
  // Strip leading +/-
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/**
 * Parse a date string in DD-MMM-YYYY format (e.g. "07-Sep-2026") → YYYY-MM-DD.
 * Returns null if unparseable.
 */
function parseNseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/["']/g, '');
  // Try DD-MMM-YYYY (e.g. "07-Sep-2026")
  const m1 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = monthMap[m1[2].toLowerCase()];
    if (mon) return `${m1[3]}-${mon}-${day}`;
  }
  // Try YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // Try DD/MM/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) {
    return `${m3[3]}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extract a date from a filename like "fao_participant_oi_07092026.csv"
 * (DDMMYYYY pattern) → "2026-09-07".
 */
function dateFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{2})(\d{2})(\d{4})/);
  if (m) {
    const day = m[1];
    const month = m[2];
    const year = m[3];
    // Validate month 01-12
    const monNum = parseInt(month, 10);
    if (monNum >= 1 && monNum <= 12) {
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

/**
 * Simple CSV parser that handles:
 *   - Quoted fields (including newlines within quotes)
 *   - Comma delimiters
 *   - Header row detection
 * Returns a 2D array of strings (rows × cols), all trimmed.
 */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        // Handle \r\n
        if (ch === '\r' && content[i + 1] === '\n') i++;
        current.push(field.trim());
        if (current.some(c => c.length > 0)) {
          rows.push(current);
        }
        current = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  // Last field
  if (field.length > 0 || current.length > 0) {
    current.push(field.trim());
    if (current.some(c => c.length > 0)) {
      rows.push(current);
    }
  }
  return rows;
}

// ─── Format detection ───

function detectFormat(filename: string, rows: string[][]): CsvFormat {
  const fn = filename.toLowerCase();
  // Hint from filename
  if (fn.includes('fii') && fn.includes('dii')) return 'fii_dii_cash';
  // CM (capital market / cash segment) participant volume — check BEFORE the
  // generic participant hints. NSE archive filename: cm_participant_08092026.csv
  if (fn.includes('cm_participant') || (fn.includes('cash') && fn.includes('participant'))) {
    return 'cm_participant_volume';
  }
  // Distinguish OI vs Volume from filename first
  if (fn.includes('fao') && (fn.includes('participant_oi') || fn.includes('oi_'))) return 'fao_participant_oi';
  if (fn.includes('fao') && (fn.includes('participant_vol') || fn.includes('vol_') || fn.includes('volume'))) {
    return 'fao_participant_volume';
  }

  // Inspect content — title row first (most reliable for F&O files since
  // both OI and Volume files share identical column structure)
  const titleRow = rows[0]?.join(' ').toLowerCase() ?? '';
  if (titleRow.includes('trading volume') && titleRow.includes('equity derivatives')) {
    return 'fao_participant_volume';
  }
  if (titleRow.includes('open interest') && titleRow.includes('equity derivatives')) {
    return 'fao_participant_oi';
  }
  // Cash market participant volume: "Participant wise Trading Volume - Capital Market Segment as on ..."
  if (titleRow.includes('trading volume') && titleRow.includes('capital market')) {
    return 'cm_participant_volume';
  }

  // Fall back to header inspection
  const header = rows.find(r => r.length > 0) ?? [];
  const headerStr = header.join(' ').toLowerCase();

  if (headerStr.includes('category') && headerStr.includes('buy value') && headerStr.includes('sell value')) {
    return 'fii_dii_cash';
  }
  if (headerStr.includes('client type') && headerStr.includes('future index long') && headerStr.includes('total long contracts')) {
    // Ambiguous — default to OI (the more commonly downloaded report)
    return 'fao_participant_oi';
  }
  if (headerStr.includes('client type') && headerStr.includes('net value') && !headerStr.includes('future index long')) {
    // Cash segment volume: "Client Type, Buy Value, Sell Value, Net Value"
    return 'cm_participant_volume';
  }
  if (headerStr.includes('client type') && (headerStr.includes('buy value') || headerStr.includes('buyqty'))) {
    return 'fao_participant_volume';
  }

  return 'unknown';
}

// ─── Parsers per format ───

function parseFiiDiiCash(rows: string[][]): Omit<ParsedParticipantCsv, 'format'> {
  let date: string | null = null;
  let fii = 0;
  let dii = 0;
  const warnings: string[] = [];

  // First row is header (with embedded newlines from NSE)
  // Data rows: "DII","07-Sep-2026","11,817.69","11,220.02","597.67"
  for (const row of rows) {
    if (row.length < 5) continue;
    const category = row[0].toLowerCase().trim();
    // Extract date from row[1] if not yet captured
    if (!date) {
      date = parseNseDate(row[1]);
    }
    if (category === 'dii') {
      // NET VALUE is the last column
      dii = parseNumber(row[row.length - 1]);
    } else if (category === 'fii' || category === 'fii/fpi' || category === 'fii / fpi') {
      fii = parseNumber(row[row.length - 1]);
    }
  }

  if (fii === 0 && dii === 0) {
    warnings.push('No FII or DII rows found — check CSV format');
  }

  const summary = `FII/DII cash market report parsed: FII ${fii >= 0 ? '+' : ''}${fii.toFixed(2)} Cr, DII ${dii >= 0 ? '+' : ''}${dii.toFixed(2)} Cr. Client and PropDesk not in this file (set to 0).`;
  return {
    date,
    fii,
    dii,
    client: 0,
    propdesk: 0,
    summary,
    warnings,
  };
}

function parseFaoParticipantOi(rows: string[][]): Omit<ParsedParticipantCsv, 'format'> {
  // Row 0: title line
  // Row 1: header — Client Type, Future Index Long, Future Index Short, ... Total Long, Total Short
  // Row 2-5: Client, DII, FII, Pro
  // Row 6: TOTAL

  const warnings: string[] = [];
  // Find header row (starts with "Client Type" or contains "Future Index Long")
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('client type') || rowStr.includes('future index long')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      date: null,
      fii: 0, dii: 0, client: 0, propdesk: 0,
      summary: 'Could not find header row in F&O participant OI file',
      warnings: ['Header row not found'],
    };
  }

  // Extract date from title row (row 0) — "as on Sep 07, 2026"
  let date: string | null = null;
  const titleRow = rows[0]?.join(' ') ?? '';
  const dateMatch = titleRow.match(/as on\s+([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (dateMatch) {
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = monthMap[dateMatch[1].toLowerCase()];
    if (mon) {
      date = `${dateMatch[3]}-${mon}-${dateMatch[2].padStart(2, '0')}`;
    }
  }

  // Find column indices for Total Long Contracts and Total Short Contracts
  // (these are the rightmost two columns in NSE's standard format)
  const header = rows[headerIdx];
  let totalLongIdx = header.length - 2;
  let totalShortIdx = header.length - 1;
  // Try to find by name (more robust)
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase().replace(/\s+/g, ' ').trim();
    if (h.includes('total long contracts')) totalLongIdx = i;
    if (h.includes('total short contracts')) totalShortIdx = i;
  }

  const positioning: ParsedParticipantCsv['positioning'] = {
    client: { longContracts: 0, shortContracts: 0 },
    dii: { longContracts: 0, shortContracts: 0 },
    fii: { longContracts: 0, shortContracts: 0 },
    pro: { longContracts: 0, shortContracts: 0 },
  };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;
    const cat = row[0].toLowerCase().trim();
    const long = parseNumber(row[totalLongIdx]);
    const short = parseNumber(row[totalShortIdx]);

    if (cat === 'client') positioning.client = { longContracts: long, shortContracts: short };
    else if (cat === 'dii') positioning.dii = { longContracts: long, shortContracts: short };
    else if (cat === 'fii') positioning.fii = { longContracts: long, shortContracts: short };
    else if (cat === 'pro') positioning.pro = { longContracts: long, shortContracts: short };
  }

  // Note: contracts ≠ ₹ Cr. We do NOT populate fii/dii/client/propdesk with
  // rupee values from this file. Caller can use the positioning data for
  // future Phase 2b factors.
  warnings.push(
    'F&O participant OI file contains contract counts, not ₹ Crore. ' +
    'FII/DII/Client/PropDesk flow values are NOT populated. ' +
    'Use the FII/DII cash market report for Factor 12 inputs. ' +
    'Positioning data (long/short contracts) saved for future Phase 2b.'
  );

  const summary = `F&O participant OI snapshot parsed. Positioning saved for future use (does not feed Factor 12). ` +
    `Client: ${positioning.client.longContracts.toLocaleString()}L / ${positioning.client.shortContracts.toLocaleString()}S contracts. ` +
    `FII: ${positioning.fii.longContracts.toLocaleString()}L / ${positioning.fii.shortContracts.toLocaleString()}S. ` +
    `DII: ${positioning.dii.longContracts.toLocaleString()}L / ${positioning.dii.shortContracts.toLocaleString()}S. ` +
    `Pro: ${positioning.pro.longContracts.toLocaleString()}L / ${positioning.pro.shortContracts.toLocaleString()}S. ` +
    `For Factor 12, also upload the FII/DII cash market CSV.`;

  return {
    date,
    fii: 0,
    dii: 0,
    client: 0,
    propdesk: 0,
    positioning,
    summary,
    warnings,
  };
}

/**
 * Parse the NSE "Participant wise Trading Volume — Capital Market Segment"
 * report (cash market trades in ₹). This is the 4th report that completes
 * Factor 12 inputs: it provides real Client and Pro (PropDesk) net values
 * in ₹ — no more manual guessing.
 *
 * Expected layout (typical NSE archive):
 *   Row 0: "Participant wise Trading Volume - Capital Market Segment as on Sep 08, 2026"
 *   Row 1: "Values in Rs. Lakhs"          ← unit hint (may be absent)
 *   Row 2: Client Type, Buy Value, Sell Value, Net Value
 *   Rows:  Client, NRI, DII, Pro, TOTAL
 *
 * Unit handling: NSE historically publishes this report in ₹ LAKHS.
 * 1 Crore = 100 Lakhs → if the unit row says Lakhs, divide by 100.
 * If it says Crore, use as-is. If no unit row found, assume ₹ Cr and warn.
 */
function parseCmParticipantVolume(rows: string[][]): Omit<ParsedParticipantCsv, 'format'> {
  const warnings: string[] = [];

  // Find header row ("Client Type" + "Net Value", no derivatives columns)
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('client type') && rowStr.includes('net value')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      date: null,
      fii: 0, dii: 0, client: 0, propdesk: 0,
      summary: 'Could not find header row in Cash Market participant volume file',
      warnings: ['Header row with "Client Type ... Net Value" not found'],
    };
  }

  // Unit detection — scan rows ABOVE the header for a unit hint
  // (NSE puts "Values in Rs. Lakhs" between title and header)
  let divisor = 1;
  let unitLabel = '₹ Cr (assumed)';
  for (let i = 0; i < headerIdx; i++) {
    const rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('lakhs') || rowStr.includes('lakh')) {
      divisor = 100;
      unitLabel = '₹ Lakhs (converted to Cr)';
      break;
    }
    if (rowStr.includes('crore') || rowStr.includes('₹ cr') || rowStr.includes('rs. cr')) {
      divisor = 1;
      unitLabel = '₹ Cr';
      break;
    }
  }
  if (divisor === 1 && unitLabel.includes('assumed')) {
    warnings.push('No unit row found ("Values in Rs. Lakhs/Crore") — assuming ₹ Crore. Verify Client/Pro magnitudes look sane.');
  }

  // Extract date from title row — "as on Sep 08, 2026"
  let date: string | null = null;
  const titleRow = rows.slice(0, headerIdx).map(r => r.join(' ')).join(' ');
  const dateMatch = titleRow.match(/as on\s+([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (dateMatch) {
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = monthMap[dateMatch[1].toLowerCase()];
    if (mon) {
      date = `${dateMatch[3]}-${mon}-${dateMatch[2].padStart(2, '0')}`;
    }
  }

  // Net value column — find by name, else last column
  const header = rows[headerIdx];
  let netIdx = header.length - 1;
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase().replace(/\s+/g, ' ').trim();
    if (h.includes('net value') || h === 'net') netIdx = i;
  }

  let client = 0;
  let propdesk = 0;
  let diiCheck: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;
    const cat = row[0].toLowerCase().trim();
    const net = parseNumber(row[netIdx]) / divisor;
    if (cat === 'client') client = net;
    else if (cat === 'pro') propdesk = net;
    else if (cat === 'dii') diiCheck = net;
    // NRI / TOTAL rows ignored — NRI flow is tiny and not tracked by Factor 12
  }

  if (client === 0 && propdesk === 0) {
    warnings.push('No Client or Pro rows found — check CSV format');
  }

  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const summary =
    `Cash market participant volume parsed (units: ${unitLabel}). ` +
    `Client ${fmt(client)} Cr, Pro/PropDesk ${fmt(propdesk)} Cr. ` +
    (diiCheck !== null ? `Cross-check: DII ${fmt(diiCheck)} Cr in this file (form uses the FII/DII activity report value). ` : '') +
    `Now upload the FII/DII Activity report for FII/DII net values, then Save.`;

  warnings.push(
    'This file has no FII row — FII net must come from the FII/DII Activity report. ' +
    'Upload both files, then Save once.'
  );

  return {
    date,
    fii: 0,
    dii: 0,
    client: Math.round(client * 100) / 100,
    propdesk: Math.round(propdesk * 100) / 100,
    summary,
    warnings,
  };
}

// ─── Main entry point ───

export function parseParticipantCsv(filename: string, content: string): ParsedParticipantCsv {
  const rows = parseCsv(content);
  const format = detectFormat(filename, rows);

  switch (format) {
    case 'fii_dii_cash': {
      const parsed = parseFiiDiiCash(rows);
      // Fallback date from filename if CSV didn't yield one
      if (!parsed.date) {
        parsed.date = dateFromFilename(filename);
      }
      return { format, ...parsed };
    }
    case 'fao_participant_oi': {
      const parsed = parseFaoParticipantOi(rows);
      if (!parsed.date) {
        parsed.date = dateFromFilename(filename);
      }
      return { format, ...parsed };
    }
    case 'fao_participant_volume': {
      // Volume file has identical column structure to OI file — same parser
      // extracts long/short contract counts per participant. The semantic
      // difference (volume = trades during day, OI = positions at close) is
      // captured in the `format` field for downstream consumers.
      const parsed = parseFaoParticipantOi(rows);
      // Override the summary to mention "trading volume" instead of "OI snapshot"
      if (parsed.positioning) {
        const p = parsed.positioning;
        parsed.summary = `F&O participant trading volume parsed. Activity data (today's total trades) saved for future use. ` +
          `Client: ${p.client.longContracts.toLocaleString()}L / ${p.client.shortContracts.toLocaleString()}S contracts traded. ` +
          `FII: ${p.fii.longContracts.toLocaleString()}L / ${p.fii.shortContracts.toLocaleString()}S. ` +
          `DII: ${p.dii.longContracts.toLocaleString()}L / ${p.dii.shortContracts.toLocaleString()}S. ` +
          `Pro: ${p.pro.longContracts.toLocaleString()}L / ${p.pro.shortContracts.toLocaleString()}S. ` +
          `For Factor 12 (₹ Cr flow), also upload the FII/DII cash market CSV.`;
      }
      // Update warning text
      parsed.warnings = parsed.warnings.map(w =>
        w.includes('F&O participant OI file contains contract counts')
          ? 'F&O participant volume file contains contract counts (trading activity), not ₹ Crore. ' +
            'FII/DII/Client/PropDesk flow values are NOT populated. ' +
            'Use the FII/DII cash market report for Factor 12 inputs. ' +
            'Volume data (long/short contracts traded today) saved for future Phase 2c (activity factor).'
          : w
      );
      if (!parsed.date) {
        parsed.date = dateFromFilename(filename);
      }
      return { format, ...parsed };
    }
    case 'cm_participant_volume': {
      // Cash market participant volume — real Client + Pro (PropDesk) net
      // values in ₹ Cr. Completes Factor 12 inputs (FII/DII come from the
      // FII/DII Activity report).
      const parsed = parseCmParticipantVolume(rows);
      if (!parsed.date) {
        parsed.date = dateFromFilename(filename);
      }
      return { format, ...parsed };
    }
    case 'unknown':
    default:
      return {
        format: 'unknown',
        date: null,
        fii: 0, dii: 0, client: 0, propdesk: 0,
        summary: `Could not detect CSV format. Filename: ${filename}. First row: ${rows[0]?.join(', ') ?? '(empty)'}`,
        warnings: ['Unknown CSV format. Supported: NSE FII/DII Activity, NSE F&O Participant OI, NSE F&O Participant Volume, NSE Cash Market Participant Volume'],
      };
  }
}
