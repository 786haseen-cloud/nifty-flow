/**
 * Shared helper for all /api/kite/* routes.
 * Extracts api_key + access_token from query params and sets the override in kite-api.ts
 * so all downstream functions (getInstruments, getQuotes, etc.) use the user-provided credentials.
 *
 * CRITICAL DESIGN: Module-level credential override is cleared when no URL creds are
 * provided. This prevents a previous request's URL creds from poisoning subsequent
 * requests that rely on env vars.
 *
 * Flow per request:
 *   - URL has api_key + access_token → set override (URL creds used for this + future requests)
 *   - URL has NO creds → CLEAR override (env vars used via kiteHeaders fallback)
 *
 * Cache invalidation: when URL creds change from previous request, instruments cache
 * is busted to force re-download with the new creds.
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
      // URL creds provided → set override for this request chain
      if (apiKey !== _lastAppliedApiKey || accessToken !== _lastAppliedAccessToken) {
        invalidateInstrumentsCache();
        _lastAppliedApiKey = apiKey;
        _lastAppliedAccessToken = accessToken;
      }
      setKiteOverride(apiKey, accessToken);
    } else {
      // No URL creds → CLEAR override so env vars are used.
      // Without this, a previous request's URL creds would persist in the
      // module-level _overrideApiKey/_overrideAccessToken and poison all
      // subsequent requests that expect to use env vars.
      setKiteOverride('', '');
      _lastAppliedApiKey = '';
      _lastAppliedAccessToken = '';
    }
    return isKiteConfigured();
  } catch {
    return isKiteConfigured();
  }
}
