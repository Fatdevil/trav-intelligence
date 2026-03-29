import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/races — Hämtar senaste loppdagens alla lopp med startfält
export async function GET() {
  try {
    // Hitta senaste loppdatumet
    const latestRow: any[] = await prisma.$queryRawUnsafe(
      'SELECT race_date FROM races ORDER BY race_date DESC LIMIT 1'
    );
    if (latestRow.length === 0) {
      return NextResponse.json({ races: [], message: 'Inga lopp i databasen.' });
    }

    const d = new Date(latestRow[0].race_date);
    const latestDate = d.toISOString().split('T')[0];

    // Hämta alla lopp från den dagen
    const races: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, race_number, track_name, distance, start_type, prize_money, num_starters, race_date
      FROM races
      WHERE CAST(race_date AS TEXT) LIKE $1
      ORDER BY race_number ASC
    `, `${latestDate}%`);

    // Hämta hästar per lopp
    const formatted = await Promise.all(races.map(async (race: any) => {
      const starters: any[] = await prisma.$queryRawUnsafe(`
        SELECT rs.id AS starter_id, rs.post_position, rs.driver_name, rs.trainer_name,
               rs.km_time, rs.odds_final, rs.odds_pre_race, rs.final_position, rs.scratch,
               h.name as horse_name
        FROM race_starters rs
        JOIN horses h ON rs.horse_id = h.id
        WHERE rs.race_id = $1 AND rs.scratch = false
        ORDER BY rs.post_position ASC
      `, race.id);

      return {
        id: race.id,
        num: race.race_number,
        distance: `${race.distance} m ${race.start_type || ''}`.trim(),
        trackName: race.track_name,
        raceDate: latestDate,
        prize: race.prize_money ? `${Math.round(race.prize_money).toLocaleString('sv-SE')} kr` : null,
        starters: race.num_starters,
        horses: starters.map((s: any) => ({
          post: s.post_position,
          name: s.horse_name,
          driver: s.driver_name,
          trainer: s.trainer_name,
          kmTime: s.km_time ? `1:${(s.km_time % 60).toFixed(1).replace('.', ',')}` : '—',
          odds: s.odds_final || s.odds_pre_race || 0,
          scratch: !!s.scratch,
          finalPosition: s.final_position,
          starterId: s.starter_id,
        })),
      };
    }));

    return NextResponse.json({
      races: formatted,
      raceDate: latestDate,
      count: formatted.length,
    });
  } catch (error: any) {
    console.error('Races API error:', error);
    return NextResponse.json({ error: error.message, races: [] }, { status: 200 });
  }
}
