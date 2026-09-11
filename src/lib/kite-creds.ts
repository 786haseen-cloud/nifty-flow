/**
 * Client-side Kite credentials helper.
 * Settings tab saves to localStorage; all API calls read from here.
 *
 * Cross-device (paste-once-per-day): the token is ALSO stored on the server
 * (see /api/kite/creds-store + use-server-creds-sync.ts). Every device pulls
 * the newest token at boot and adopts it if its local copy is older —
 * last-writer-wins by the `savedAt` version stamp. One paste per day on any
 * single device covers laptop + office + phone.
 *
 * Legacy fallback: URL hash transfer (#kite-...) still works for manual copy.
 *
 * IMPORTANT: This file uses localStorage and must only be called from client code.
 * Server-side callers (API routes) get credentials from query params via kite-route-helper.ts.
 */

const LS_KEY = 'kite-api-credentials';

export interface KiteCredentials {
  apiKey: string;
  accessToken: string;
  /** Version stamp: Date.now() when these creds were pasted/synced.
   *  Missing (undefined) on pre-feature payloads → treated as 0, so the
   *  server store always wins on the first boot after this ships. */
  savedAt?: number;
}

export function getKiteCreds(): KiteCredentials {
  if (typeof window === 'undefined') return { apiKey: '', accessToken: '' };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
        savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
      };
    }
  } catch { /* ignore */ }
  return { apiKey: '', accessToken: '' };
}

export function setKiteCreds(apiKey: string, accessToken: string, savedAt?: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify({
    apiKey,
    accessToken,
    savedAt: savedAt && savedAt > 0 ? savedAt : Date.now(),
  }));
}

export function clearKiteCreds(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_KEY);
}

export function hasKiteCreds(): boolean {
  const { apiKey, accessToken } = getKiteCreds();
  return !!(apiKey && accessToken);
}

// ═══════════════════════════════════════════
// CROSS-DEVICE: URL hash transfer
// ═══════════════════════════════════════════

const HASH_PREFIX = '#kite-';

/**
 * Generate a shareable URL with credentials embedded in the hash fragment.
 * The hash is NOT sent to the server, so credentials stay client-side.
 * Format: #kite-base64(apiKey|accessToken)
 */
export function generateCredsUrl(): string {
  const { apiKey, accessToken } = getKiteCreds();
  if (!apiKey || !accessToken) return '';
  const payload = btoa(`${apiKey}|${accessToken}`);
  return `${window.location.origin}${window.location.pathname}${HASH_PREFIX}${payload}`;
}

/**
 * Check URL hash for embedded credentials on page load.
 * If found, save to localStorage and clear the hash (so it's not visible).
 * Returns true if credentials were loaded from hash.
 */
export function initCredsFromHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return false;

  try {
    const payload = hash.slice(HASH_PREFIX.length);
    const decoded = atob(payload);
    const sepIdx = decoded.indexOf('|');
    if (sepIdx < 1) return false;

    const apiKey = decoded.slice(0, sepIdx);
    const accessToken = decoded.slice(sepIdx + 1);

    if (apiKey && accessToken) {
      setKiteCreds(apiKey, accessToken);
      // Clear hash so credentials aren't visible in browser history
      window.history.replaceState(null, '', window.location.pathname);
      return true;
    }
  } catch { /* invalid hash, ignore */ }
  return false;
}

/**
 * Append credentials as query params to an API URL.
 * All /api/kite/* routes check for these params first, then fall back to env vars.
 */
export function withCreds(url: string): string {
  const { apiKey, accessToken } = getKiteCreds();
  if (!apiKey || !accessToken) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api_key=${encodeURIComponent(apiKey)}&access_token=${encodeURIComponent(accessToken)}`;
}
