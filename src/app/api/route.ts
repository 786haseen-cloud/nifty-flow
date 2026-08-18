import { NextResponse } from 'next/server';
import {
  generateDemoGlobalIndices,
  generateDemoGIFTNifty,
  generateDemoExpiryInfo,
  generateDemoNews,
  generateDemoVIX,
  generateDemoInstrument,
  generateDemo3DayComparison,
  generateDemoNiftyDivergence,
} from '@/lib/demo-data';

export async function GET() {
  try {
    const globalIndices = generateDemoGlobalIndices();
    const giftNifty = generateDemoGIFTNifty();
    const expiryInfo = generateDemoExpiryInfo();
    const news = generateDemoNews();
    const vix = generateDemoVIX();
    const nifty = generateDemoInstrument('NIFTY', 'Nifty 50', 'index', 24350);
    const dayComparison = generateDemo3DayComparison();
    const divergence = generateDemoNiftyDivergence();

    return NextResponse.json({
      globalIndices,
      giftNifty,
      expiryInfo,
      news,
      vix,
      nifty,
      dayComparison,
      divergence,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get overview data' }, { status: 500 });
  }
}
