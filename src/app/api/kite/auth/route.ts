/**
 * Kite Auth — Generate access_token from request_token
 * Call this after Zerodha login redirect
 *
 * Usage: GET /api/kite/auth?request_token=xxxxx
 * Returns: { accessToken, refreshToken } → save to .env
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateSession } from '@/lib/kite-api';

export async function GET(req: NextRequest) {
  const requestToken = req.nextUrl.searchParams.get('request_token');

  if (!requestToken) {
    return NextResponse.json({
      error: 'Missing request_token',
      help: 'Visit https://kite.zerodha.com/connect/login?api_key=YOUR_KITE_API_KEY to login, then pass the request_token from the redirect URL',
      loginUrl: `https://kite.zerodha.com/connect/login?api_key=${process.env.KITE_API_KEY || 'YOUR_API_KEY'}`,
    }, { status: 400 });
  }

  const session = await generateSession(requestToken);

  if (!session) {
    return NextResponse.json({ error: 'Failed to generate session. Check KITE_API_KEY and KITE_API_SECRET in .env' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    instructions: [
      '1. Copy the accessToken below',
      '2. Add it to your .env file: KITE_ACCESS_TOKEN=xxx',
      '3. Redeploy: vercel deploy --prebuilt --prod',
      '4. Your dashboard will now show LIVE NSE data!',
      '',
      '⚠️ Access tokens expire daily at midnight IST.',
      'Re-login each morning and repeat this process.',
    ],
  });
}
