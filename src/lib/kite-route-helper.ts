/**
 * Shared helper for all /api/kite/* routes.
 * Extracts api_key + access_token from query params and sets the override in kite-api.ts
 * so all downstream functions (getInstruments, getQuotes, etc.) use the user-provided credentials.
 */
import { setKiteOverride, isKiteConfigured } from './kite-api';

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
      setKiteOverride(apiKey, accessToken);
    }
    return isKiteConfigured();
  } catch {
    return isKiteConfigured();
  }
}
