import { NextResponse } from 'next/server';
import { generateAllDemoInstruments } from '@/lib/demo-data';

export async function GET() {
  try {
    const instruments = generateAllDemoInstruments();
    return NextResponse.json({ instruments, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate data' }, { status: 500 });
  }
}
