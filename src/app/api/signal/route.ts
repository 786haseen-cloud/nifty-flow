import { NextResponse } from 'next/server';
import { generateDemoInstrument, generateDemoVIX } from '@/lib/demo-data';
import { generateHolisticSignal } from '@/lib/signal-engine';
import type { SignalMode } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { instrument, mode } = body as { instrument: string; mode: SignalMode };

    const instrData = generateDemoInstrument(instrument || 'NIFTY');
    const vixData = generateDemoVIX();

    const signal = generateHolisticSignal(instrData, vixData, mode || 'aggressive');

    return NextResponse.json({
      signal: {
        id: `sig_${Date.now()}`,
        timestamp: new Date().toISOString(),
        instrument: instrData.symbol,
        signalType: signal.signalType,
        mode: mode || 'aggressive',
        confidence: signal.confidence,
        strike: signal.strike,
        optionType: signal.optionType,
        premium: signal.premium,
        stopLoss: signal.stopLoss,
        target: signal.target,
        reasoning: signal.reasoning,
        vixValue: vixData.value,
        pcrValue: instrData.pcr,
      },
      context: signal.context,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate signal' }, { status: 500 });
  }
}
