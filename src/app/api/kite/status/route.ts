/**
 * Kite Status — Check if API is configured AND working
 * GET /api/kite/status
 *
 * Now actually tests the Kite connection instead of just checking env vars.
 */
import { NextResponse } from 'next/server';
import { isKiteConfigured } from '@/lib/kite-api';

const KITE_BASE = 'https://api.kite.trade';

export async function GET() {
  const configured = isKiteConfigured();

  const result: Record<string, any> = {
    configured,
    provider: 'Zerodha Kite',
    apiKeySet: !!process.env.KITE_API_KEY,
    accessTokenSet: !!process.env.KITE_ACCESS_TOKEN,
    accessTokenLength: process.env.KITE_ACCESS_TOKEN?.length || 0,
  };

  if (!configured) {
    result.mode = 'demo';
    result.loginUrl = `https://kite.zerodha.com/connect/login?api_key=${process.env.KITE_API_KEY || 'SET_YOUR_API_KEY_FIRST'}`;
    result.instructions = [
      'Kite API not configured yet.',
      'Go to Vercel → Project → Settings → Environment Variables',
      'Add KITE_API_KEY, KITE_API_SECRET, KITE_ACCESS_TOKEN',
      'Click Save → Redeploy',
    ];
    return NextResponse.json(result);
  }

  // Actually test the connection with a lightweight API call
  try {
    const token = process.env.KITE_ACCESS_TOKEN!.trim();
    const res = await fetch(`${KITE_BASE}/quote?i=${encodeURIComponent('NSE:NIFTY 50')}`, {
      headers: {
        'Authorization': `enctoken ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const text = await res.text();

    if (res.ok) {
      const data = JSON.parse(text);
      if (data.status === 'success' && data.data) {
        const niftyData = data.data['NSE:NIFTY 50'];
        result.mode = 'live';
        result.connectionTest = 'PASS';
        result.niftyLastPrice = niftyData?.last_price || null;
        result.message = 'Kite API connected and returning live data.';
      } else {
        result.mode = 'error';
        result.connectionTest = 'FAIL';
        result.kiteStatus = data.status;
        result.kiteError = data.message || 'Unknown Kite error';
        result.rawResponse = text.substring(0, 500);
        result.message = `Kite returned error: ${data.message || 'Unknown'}`;
      }
    } else {
      result.mode = 'error';
      result.connectionTest = 'FAIL';
      result.httpStatus = res.status;
      result.httpStatusText = res.statusText;
      result.kiteResponse = text.substring(0, 500);
      result.message = `Kite API returned HTTP ${res.status}. Token may be expired.`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.mode = 'error';
    result.connectionTest = 'FAIL';
    result.error = errMsg;
    result.message = `Connection test failed: ${errMsg}`;
  }

  return NextResponse.json(result);
}
