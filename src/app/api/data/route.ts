import { NextResponse } from 'next/server';
import { generateDemoInstrument } from '@/lib/demo-data';
import { INDICES } from '@/lib/types';

export async function GET() {
  try {
    const instruments = INDICES.map(idx =>
      generateDemoInstrument(idx.symbol, idx.name, 'index', idx.symbol === 'NIFTY' ? 24350 : idx.symbol === 'SENSEX' ? 80100 : idx.symbol === 'BANKNIFTY' ? 51800 : 23200)
    );
    return NextResponse.json({ instruments, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Failed to generate data' }, { status: 500 });
  }
}
