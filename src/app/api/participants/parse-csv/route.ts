/**
 * Participant CSV Parse API
 * POST /api/participants/parse-csv
 *
 * Accepts a multipart/form-data upload with a single `file` field (the CSV
 * from NSE's website). Auto-detects the file format and returns parsed
 * values so the client can populate the input form for review before
 * saving to Upstash.
 *
 * ─── Request ───
 *   Content-Type: multipart/form-data
 *   Body: file=<csv file>
 *
 * ─── Response ───
 *   {
 *     ok: true,
 *     parsed: ParsedParticipantCsv
 *   }
 *
 * Or on error:
 *   { ok: false, error: "..." }
 *
 * ─── Limits ───
 *   - Max file size: 1 MB (NSE CSVs are typically < 10 KB)
 *   - Accepted extensions: .csv, .txt (NSE sometimes serves CSV as .txt)
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseParticipantCsv, type ParsedParticipantCsv } from '@/lib/participant-csv-parser';
import { saveParticipantPositioning } from '@/lib/participant-service';

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'No `file` field in form data. Expected multipart/form-data with a `file` field.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: `File too large: ${file.size} bytes. Max ${MAX_FILE_SIZE} bytes (1 MB).` },
        { status: 413 }
      );
    }

    // Read file content as UTF-8 text
    const content = await file.text();
    if (!content || content.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'File is empty' },
        { status: 400 }
      );
    }

    const filename = file.name || 'upload.csv';
    const parsed: ParsedParticipantCsv = parseParticipantCsv(filename, content);

    // ── Phase 2b/2c prep: persist positioning data (Reports 2 + 3) ──
    // When the parsed CSV is an F&O participant OI or Volume report, also
    // save the positioning data to Upstash (35-day TTL) so we have history
    // for Phase 2b (futures positioning factor) and 2c (option footprint).
    // Failure here is non-fatal — the parse result is still returned for
    // the user to review.
    let positioningSaved: { reportType: string; date: string } | null = null;
    if (
      parsed.date &&
      parsed.positioning &&
      (parsed.format === 'fao_participant_oi' || parsed.format === 'fao_participant_volume')
    ) {
      try {
        const reportType = parsed.format === 'fao_participant_oi' ? 'fao_oi' : 'fao_vol';
        const saved = await saveParticipantPositioning({
          date: parsed.date,
          reportType,
          positioning: parsed.positioning,
        });
        if (saved) {
          positioningSaved = { reportType, date: parsed.date };
        }
      } catch (err) {
        console.warn('[participants/parse-csv] saveParticipantPositioning failed (non-fatal):', err);
      }
    }

    return NextResponse.json({ ok: true, parsed, positioningSaved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[participants/parse-csv] error:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
