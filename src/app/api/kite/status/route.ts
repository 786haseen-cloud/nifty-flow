/**
 * Kite Status — Check if API is configured and connected
 * GET /api/kite/status
 */
import { NextResponse } from 'next/server';
import { isKiteConfigured } from '@/lib/kite-api';

export async function GET() {
  const configured = isKiteConfigured();

  return NextResponse.json({
    configured,
    provider: 'Zerodha Kite',
    apiKeySet: !!process.env.KITE_API_KEY,
    accessTokenSet: !!process.env.KITE_ACCESS_TOKEN,
    loginUrl: configured ? null : `https://kite.zerodha.com/connect/login?api_key=${process.env.KITE_API_KEY || 'SET_YOUR_API_KEY_FIRST'}`,
    instructions: configured
      ? ['✅ Kite API is configured. Dashboard will use LIVE NSE data.']
      : [
          '❌ Kite API not configured yet.',
          'Steps to connect:',
          '1. Go to https://developers.kite.trade',
          '2. Create an app → get API Key + Secret',
          '3. Add KITE_API_KEY and KITE_API_SECRET to .env',
          '4. Visit: /api/kite/auth?request_token=xxx after login',
          '5. Add generated KITE_ACCESS_TOKEN to .env',
          '6. Redeploy',
        ],
  });
}
