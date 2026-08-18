import { NextResponse } from 'next/server';
import { generateDemoDailySummaries } from '@/lib/demo-data';

export async function GET() {
  try {
    const summaries = generateDemoDailySummaries(5);
    return NextResponse.json({ summaries, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get daily log' }, { status: 500 });
  }
}
