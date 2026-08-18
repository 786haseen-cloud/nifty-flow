import { NextResponse } from 'next/server';
import { generateDemoInstitutionalFlow } from '@/lib/demo-data';

export async function GET() {
  try {
    const summaries = Array.from({ length: 5 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (4 - i));
      return {
        date: date.toLocaleDateString('en-IN'),
        ...generateDemoInstitutionalFlow(),
      };
    });
    return NextResponse.json({ summaries, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Failed to get daily log' }, { status: 500 });
  }
}
