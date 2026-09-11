/**
 * Kite creds server store — the paste-once-per-day hub.
 *
 * POST   /api/kite/creds-store   { apiKey, accessToken }  → save (called by Settings "Save & Test")
 * GET    /api/kite/creds-store   → full creds + savedAt (called by device boot-sync)
 * DELETE /api/kite/creds-store   → clear (called by Settings "Clear Credentials")
 *
 * Every device pulls the newest token here at boot and adopts it if its
 * localStorage copy is older (last-writer-wins by savedAt). This is what
 * makes "paste at 09:14 on the laptop → office works without re-pasting"
 * possible. See src/hooks/use-server-creds-sync.ts for the client side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStoredCredsSync, saveStoredCreds, clearStoredCreds, maskCreds } from '@/lib/kite-creds-store';
import { invalidateInstrumentsCache } from '@/lib/kite-api';

export async function GET() {
  const stored = getStoredCredsSync();
  if (!stored) {
    return NextResponse.json({ configured: false });
  }
  return NextResponse.json({
    configured: true,
    // Full creds — devices need the real token to function (they send it as
    // query params on every poll). Personal single-user dashboard: the URL
    // is the trust boundary.
    apiKey: stored.apiKey,
    accessToken: stored.accessToken,
    // Masked copies (apiKeyMasked/tokenMasked/savedAt) for direct UI display
    ...maskCreds(stored),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
    if (!apiKey || !accessToken) {
      return NextResponse.json({ ok: false, error: 'apiKey and accessToken are required' }, { status: 400 });
    }
    const savedAt = typeof body?.savedAt === 'number' && body.savedAt > 0 ? body.savedAt : undefined;
    const entry = saveStoredCreds(apiKey, accessToken, savedAt);
    // New token → old instruments cache may belong to a different session.
    // Cheap insurance so the next instruments download uses the new creds.
    invalidateInstrumentsCache();
    console.log(`[creds-store] Saved creds (savedAt=${entry.savedAt}) — all devices will converge on this token`);
    return NextResponse.json({ ok: true, configured: true, savedAt: entry.savedAt });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Invalid JSON body' }, { status: 400 });
  }
}

export async function DELETE() {
  clearStoredCreds();
  invalidateInstrumentsCache();
  console.log('[creds-store] Cleared — all devices will fall back to localStorage/env creds');
  return NextResponse.json({ ok: true, configured: false });
}
