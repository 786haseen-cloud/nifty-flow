/**
 * Server-side Kite credentials store.
 *
 * PURPOSE — "paste once per day, works on every device"
 * -----------------------------------------------------
 * Previously creds lived ONLY in each browser's localStorage, so the daily
 * token had to be pasted separately on the laptop AND again at the office.
 * Now Settings' "Save & Test" also persists the creds HERE, on the server.
 * Any device that opens the dashboard pulls the newest token at boot
 * (see use-server-creds-sync.ts), so one paste per day covers all devices.
 *
 * Storage tiers (best-effort, in order):
 *   1. In-memory module cache   — always works on the server
 *   2. db/kite-creds.json file  — survives server restarts; silently
 *                                 skipped on read-only filesystems
 *
 * ISOMORPHISM NOTE: this module is pulled into the CLIENT bundle through
 * kite-api.ts (client components import kite-api for helpers). Therefore
 * `fs` is loaded via a runtime-guarded require — never on the browser,
 * where getStoredCredsSync() simply returns null (clients use localStorage
 * + query params instead).
 *
 * There is no TTL: Kite tokens self-expire at ~6 AM IST the next day, and
 * the user pastes a fresh one every morning anyway. The savedAt timestamp
 * is what devices use for last-writer-wins convergence.
 *
 * SECURITY NOTE: this is a single-user personal dashboard. GET returns the
 * full creds so other devices can adopt them — the dashboard URL itself is
 * the trust boundary (creds already transit as query params on every poll).
 *
 * SERVER CAPABILITIES ONLY: saveStoredCreds/clearStoredCreds are meant for
 * API routes; in the browser they are silent no-ops.
 */

export interface StoredCreds {
  apiKey: string;
  accessToken: string;
  /** Date.now() when these creds were pasted — the sync version clock. */
  savedAt: number;
}

const STORE_FILE = process.cwd() + '/db/kite-creds.json';

// ─── fs via runtime-guarded require ───
// A static `import fs from 'fs'` here breaks the Next.js client bundle
// (module-not-found in the browser build). eval('require') defeats the
// bundler's static analysis; the browser branch below never reaches it.

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadFs(): any | null {
  if (typeof window !== 'undefined') return null; // browser — no filesystem
  try {
    // eslint-disable-next-line no-eval
    return eval('require')('fs');
  } catch {
    return null;
  }
}

// ─── In-memory mirror (module singleton, survives across route invocations
// on the same server instance) ───

let _cached: StoredCreds | null = null;
let _fileLoaded = false;

/**
 * Lazy-load the store from disk exactly once per process. Uses a SYNC read
 * so callers in synchronous contexts (kiteHeaders fallback) get a valid
 * answer on the very first call without awaiting anything.
 */
function loadFromFileOnce(): void {
  if (_fileLoaded) return;
  _fileLoaded = true;
  const fs = loadFs();
  if (!fs) return;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StoredCreds;
      if (parsed && typeof parsed.apiKey === 'string' && typeof parsed.accessToken === 'string' && parsed.apiKey && parsed.accessToken) {
        _cached = {
          apiKey: parsed.apiKey,
          accessToken: parsed.accessToken,
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
        };
      }
    }
  } catch (err) {
    console.warn('[kite-creds-store] Failed to load store file (continuing with memory only):', err instanceof Error ? err.message : err);
  }
}

/**
 * Get the currently stored creds, or null if none saved yet.
 * Synchronous — reads the memory mirror (hydrated from the file on first call).
 * Returns null in the browser by design (client uses localStorage).
 */
export function getStoredCredsSync(): StoredCreds | null {
  if (typeof window !== 'undefined') return null;
  loadFromFileOnce();
  return _cached;
}

/**
 * Persist new creds to the store (memory + file). The file write is
 * best-effort — on read-only filesystems we still keep the in-memory copy,
 * which is enough because the browser client always re-sends its creds.
 * No-op in the browser.
 */
export function saveStoredCreds(apiKey: string, accessToken: string, savedAt?: number): StoredCreds | null {
  if (typeof window !== 'undefined') return null;
  const entry: StoredCreds = {
    apiKey: apiKey.trim(),
    accessToken: accessToken.trim(),
    savedAt: typeof savedAt === 'number' && savedAt > 0 ? savedAt : Date.now(),
  };
  _cached = entry;

  const fs = loadFs();
  if (fs) {
    try {
      const dir = STORE_FILE.slice(0, STORE_FILE.lastIndexOf('/'));
      if (dir) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(entry, null, 2), 'utf8');
    } catch (err) {
      console.warn('[kite-creds-store] File write failed (memory-only mode):', err instanceof Error ? err.message : err);
    }
  }
  return entry;
}

/** Clear the store (memory + file). Used by the dashboard's Disconnect. No-op in the browser. */
export function clearStoredCreds(): void {
  if (typeof window !== 'undefined') return;
  _cached = null;
  const fs = loadFs();
  if (!fs) return;
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (err) {
    console.warn('[kite-creds-store] File delete failed:', err instanceof Error ? err.message : err);
  }
}

/** Masked preview for the Settings UI — never exposes the raw token. */
export function maskCreds(c: StoredCreds): { apiKeyMasked: string; tokenMasked: string; savedAt: number } {
  const mask = (s: string) => (s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`);
  return { apiKeyMasked: mask(c.apiKey), tokenMasked: mask(c.accessToken), savedAt: c.savedAt };
}
