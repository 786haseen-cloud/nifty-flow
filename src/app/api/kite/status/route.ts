/**
 * Kite Status — Check if API is configured AND working
 * GET /api/kite/status?api_key=xxx&access_token=xxx
 *
 * Tests multiple Kite endpoints to pinpoint the exact issue.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isKiteConfigured, setKiteOverride } from '@/lib/kite-api';

const KITE_BASE = 'https://api.kite.trade';
const NIFTY_TOKEN = 256265;

export async function GET(request: NextRequest) {
  // Extract creds from query params
  let apiKey = '';
  let accessToken = '';
  try {
    const u = new URL(request.url);
    apiKey = u.searchParams.get('api_key') || '';
    accessToken = u.searchParams.get('access_token') || '';
    if (apiKey && accessToken) setKiteOverride(apiKey, accessToken);
  } catch {}

  const configured = isKiteConfigured();

  const result: Record<string, any> = {
    configured,
    provider: 'Zerodha Kite',
    apiKeySet: !!process.env.KITE_API_KEY || !!apiKey,
    accessTokenSet: !!process.env.KITE_ACCESS_TOKEN || !!accessToken,
    accessTokenLength: (accessToken || process.env.KITE_ACCESS_TOKEN || '').length,
  };

  if (!configured) {
    result.mode = 'demo';
    return NextResponse.json(result);
  }

  const token = accessToken || process.env.KITE_ACCESS_TOKEN || '';
  const key = apiKey || process.env.KITE_API_KEY || '';
  const headers = {
    'Authorization': `token ${key}:${token}`,
    'X-Kite-Version': '3',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Test 1: /user/margins (no instrument param — pure auth test)
  let marginsOk = false;
  try {
    const mRes = await fetch(`${KITE_BASE}/user/margins`, { headers });
    const mText = await mRes.text();
    result.marginsTest = { status: mRes.status, preview: mText.substring(0, 300) };
    marginsOk = mRes.ok;
  } catch (e: any) {
    result.marginsTest = { error: e.message };
  }

  if (!marginsOk) {
    result.mode = 'error';
    result.connectionTest = 'FAIL';
    result.message = 'Token is invalid or expired. /user/margins rejected it.';
    result.fix = 'Get a fresh access token from kite.zerodha.com/connect/login and update the token in Settings tab.';
    return NextResponse.json(result);
  }

  // Test 2: /quote with instrument TOKEN (no encoding issues)
  let tokenQuoteOk = false;
  try {
    const qRes = await fetch(`${KITE_BASE}/quote?i=${NIFTY_TOKEN}`, { headers });
    const qText = await qRes.text();
    result.tokenQuoteTest = { status: qRes.status, preview: qText.substring(0, 500) };
    tokenQuoteOk = qRes.ok;
  } catch (e: any) {
    result.tokenQuoteTest = { error: e.message };
  }

  if (tokenQuoteOk) {
    let lastPrice = null;
    try {
      const data = JSON.parse(result.tokenQuoteTest.preview);
      lastPrice = data?.data?.[String(NIFTY_TOKEN)]?.last_price;
    } catch {}
    result.mode = 'live';
    result.connectionTest = 'PASS';
    result.niftyLastPrice = lastPrice;
    result.message = 'Kite API connected successfully!';
    result.tokenFormat = 'instrument_token';
  } else {
    result.mode = 'error';
    result.connectionTest = 'FAIL';
    result.message = 'Token works for margins but quotes failed. Unusual — check raw responses above.';
  }

  return NextResponse.json(result);
}
