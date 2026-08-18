import { NextResponse } from 'next/server';
import { generateDemoInstrument, generateDemoVIX, generateDemo3DayComparison, generateDemoGlobalIndices, generateDemoExpiryInfo } from '@/lib/demo-data';
import { generateHolisticSignal } from '@/lib/signal-engine';
import type { SignalMode } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { instrument, mode } = body as { instrument: string; mode: SignalMode };

    const instrData = generateDemoInstrument(instrument || 'NIFTY');
    const vixData = generateDemoVIX();
    const dayComp = generateDemo3DayComparison();
    const globalIndices = generateDemoGlobalIndices();
    const expiryInfo = generateDemoExpiryInfo();
    const niftyExpiry = expiryInfo.find(e => e.symbol === 'NIFTY');

    const signal = generateHolisticSignal(instrData, {
      instrument: instrData,
      vix: vixData,
      dayComparison: dayComp,
      globalIndices,
      daysToExpiry: niftyExpiry?.daysToExpiry ?? 5,
      stockSentiment: (Math.random() - 0.5) * 2,
    }, mode || 'aggressive');

    return NextResponse.json({
      signal: {
        ...signal,
        timestamp: signal.timestamp.toISOString(),
      },
      vixValue: vixData.value,
      pcrValue: instrData.pcr,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to generate signal' }, { status: 500 });
  }
}
