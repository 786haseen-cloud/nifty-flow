/**
 * Shared helper for all /api/kite/* routes.
 * Extracts api_key + access_token from query params and sets the override in kite-api.ts
 * so all downstream functions (getInstruments, getQuotes, etc.) use the user-provided credentials.
 *
 * IMPORTANT: If the incoming credentials differ from the previously-cached ones, we
 * invalidate the in-memory instruments cache. This handles the common scenario where:
 *   1. Vercel cold-start instance had cached an empty instruments list (from an
 *      unauthenticated request, or an expired env-var token returning 403)
 *   2. The user's browser then sends a request with a fresh, valid access_token
 * Without cache invalidation, the user's valid request would keep getting the stale
 * empty list and the Strike Flow / Options Flow tabs would all show "No option
 * instruments found" even though the CSV download would now succeed.
 */
import { setKiteOverride, isKiteConfigured, invalidateInstrumentsCache } from './kite-api';

let _lastAppliedApiKey = '';
let _lastAppliedAccessToken = '';

/**
 * Call this at the top of every /api/kite/* GET handler.
 * Returns true if credentials are available (either from query params or env vars).
 */
export function applyKiteCredsFromRequest(url: string): boolean {
  try {
    const u = new URL(url, 'http://localhost');
    const apiKey = u.searchParams.get('api_key');
    const accessToken = u.searchParams.get('access_token');
    if (apiKey && accessToken) {
      // If the creds differ from the previously applied ones, bust the instruments
      // cache so we re-download the CSV with the new creds.
      if (apiKey !== _lastAppliedApiKey || accessToken !== _lastAppliedAccessToken) {
        invalidateInstrumentsCache();
        _lastAppliedApiKey = apiKey;
        _lastAppliedAccessToken = accessToken;
      }
      setKiteOverride(apiKey, accessToken);
    }
    return isKiteConfigured();
  } catch {
    return isKiteConfigured();
  }
}
