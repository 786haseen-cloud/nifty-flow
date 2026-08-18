import { NextResponse } from 'next/server';
import {
  generateDemoInstitutionalFlow,
  generateDemoBigTrades,
  generateDemoNiftyDivergence,
  generateDemo3DayComparison,
} from '@/lib/demo-data';

export async function GET() {
  try {
    const institutionalFlow = generateDemoInstitutionalFlow();
    const bigTrades = generateDemoBigTrades();
    const divergence = generateDemoNiftyDivergence();
    const dayComparison = generateDemo3DayComparison();

    return NextResponse.json({
      institutionalFlow,
      bigTrades: bigTrades.map((t) => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
      })),
      divergence,
      dayComparison,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get institutional data' }, { status: 500 });
  }
}
