import { NextResponse } from 'next/server';
import { generateDemoVIX } from '@/lib/demo-data';

export async function GET() {
  try {
    const vix = generateDemoVIX();
    return NextResponse.json({ vix, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get VIX data' }, { status: 500 });
  }
}
