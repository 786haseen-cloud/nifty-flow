import { NextResponse } from 'next/server';
import { generateDemoInstitutionalFlow } from '@/lib/demo-data';
import { toIST } from '@/lib/ist';

export async function GET() {
  try {
    const summaries = Array.from({ length: 5 }, (_, i) => {
      const ist = toIST(new Date());
      ist.setDate(ist.getUTCDate() - (4 - i));
      const day = ist.getUTCDate();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${day} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
      return {
        date: dateStr,
        ...generateDemoInstitutionalFlow(),
      };
    });
    return NextResponse.json({ summaries, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Failed to get daily log' }, { status: 500 });
  }
}
