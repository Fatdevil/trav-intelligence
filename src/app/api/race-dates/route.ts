import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/race-dates — Returnerar alla tillgängliga loppdagar med speltyp
export async function GET() {
  try {
    const dates: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        CAST(race_date AS TEXT) as race_date,
        race_type,
        COUNT(*) as race_count,
        SUM(num_starters) as total_starters
      FROM races
      WHERE race_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY CAST(race_date AS TEXT), race_type
      ORDER BY race_date ASC
    `);

    const grouped: Record<string, { date: string; games: { type: string; races: number; starters: number }[] }> = {};
    
    for (const row of dates) {
      const d = row.race_date.split('T')[0].split(' ')[0];
      if (!grouped[d]) grouped[d] = { date: d, games: [] };
      grouped[d].games.push({
        type: row.race_type || 'LOPP',
        races: Number(row.race_count),
        starters: Number(row.total_starters),
      });
    }

    return NextResponse.json({
      dates: Object.values(grouped),
    });
  } catch (error: any) {
    console.error('Race dates error:', error);
    return NextResponse.json({ error: error.message, dates: [] }, { status: 200 });
  }
}
