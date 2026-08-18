import { NextResponse } from 'next/server';
import {
  generateDemoInstitutionalFlow,
  generateDemoBigTrades,
  generateDemoTimeSeries,
  generateDemoOIBuildupEvents,
} from '@/lib/demo-data';

export async function GET() {
  try {
    const institutionalFlow = generateDemoInstitutionalFlow();
    const bigTrades = generateDemoBigTrades();
    const timeSeries = generateDemoTimeSeries();
    const oiBuildupEvents = generateDemoOIBuildupEvents();

    return NextResponse.json({
      institutionalFlow,
      bigTrades: bigTrades.map((t) => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
      })),
      timeSeries,
      oiBuildupEvents,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get institutional data' }, { status: 500 });
  }
}
