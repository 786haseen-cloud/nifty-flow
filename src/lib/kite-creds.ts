/**
 * Client-side Kite credentials helper.
 * Settings tab saves to localStorage; all API calls read from here.
 *
 * IMPORTANT: This file uses localStorage and must only be called from client code.
 * Server-side callers (API routes) get credentials from query params via kite-route-helper.ts.
 */

const LS_KEY = 'kite-api-credentials';

export interface KiteCredentials {
  apiKey: string;
  accessToken: string;
}

export function getKiteCreds(): KiteCredentials {
  if (typeof window === 'undefined') return { apiKey: '', accessToken: '' };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { apiKey: '', accessToken: '' };
}

export function setKiteCreds(apiKey: string, accessToken: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify({ apiKey, accessToken }));
}

export function clearKiteCreds(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_KEY);
}

export function hasKiteCreds(): boolean {
  const { apiKey, accessToken } = getKiteCreds();
  return !!(apiKey && accessToken);
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
