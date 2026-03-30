import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/races — Hämtar loppdagens alla lopp med startfält
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get('date');
    
    const today = new Date().toISOString().split('T')[0];
    let latestDate: string;
    let isUpcoming = true;
    
    if (requestedDate) {
      // Specifikt datum begärt
      latestDate = requestedDate;
      isUpcoming = requestedDate >= today;
    } else {
      // Hitta kommande lopp (framtida datum), annars senaste historiska
      let targetRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT race_date FROM races WHERE CAST(race_date AS TEXT) >= $1 ORDER BY race_date ASC LIMIT 1`,
        today
      );
      
      if (targetRow.length === 0) {
        targetRow = await prisma.$queryRawUnsafe(
          'SELECT race_date FROM races ORDER BY race_date DESC LIMIT 1'
        );
        isUpcoming = false;
      }
      
      if (targetRow.length === 0) {
        return NextResponse.json({ races: [], message: 'Inga lopp i databasen.' });
      }
      
      const d = new Date(targetRow[0].race_date);
      latestDate = d.toISOString().split('T')[0];
    }

    // Hämta alla lopp från den dagen
    const races: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, race_number, track_name, distance, start_type, prize_money, num_starters, race_date, race_type
      FROM races
      WHERE CAST(race_date AS TEXT) LIKE $1
      ORDER BY race_number ASC
    `, `${latestDate}%`);

    // Hämta hästar per lopp + AI-predictions
    const formatted = await Promise.all(races.map(async (race: any) => {
      const starters: any[] = await prisma.$queryRawUnsafe(`
        SELECT rs.id AS starter_id, rs.post_position, rs.driver_name, rs.trainer_name,
               rs.km_time, rs.odds_final, rs.odds_pre_race, rs.final_position, rs.scratch,
               h.horse_name as horse_name,
               vb.model_prob, vb.edge, vb.expected_value, vb.tier
        FROM race_starters rs
        JOIN horses h ON rs.horse_id = h.id
        LEFT JOIN value_bets vb ON vb.starter_id = rs.id
        WHERE rs.race_id = $1 AND rs.scratch = false
        ORDER BY rs.post_position ASC
      `, race.id);

      // Beräkna AI Score (0-100 per lopp, normaliserat)
      const maxProb = Math.max(...starters.map((s: any) => s.model_prob || 0), 0.01);
      
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
          // AI Predictions
          aiScore: s.model_prob ? Math.round((s.model_prob / maxProb) * 100) : null,
          modelProb: s.model_prob ? Number((s.model_prob * 100).toFixed(1)) : null,
          edge: s.edge ? Number((s.edge * 100).toFixed(1)) : null,
          ev: s.expected_value ? Number(s.expected_value.toFixed(2)) : null,
          tier: s.tier || null,
        })),
      };
    }));

    return NextResponse.json({
      races: formatted,
      raceDate: latestDate,
      trackName: races[0]?.track_name || '',
      raceType: races[0]?.race_type || '',
      isUpcoming,
      count: formatted.length,
    });
  } catch (error: any) {
    console.error('Races API error:', error);
    return NextResponse.json({ error: error.message, races: [] }, { status: 200 });
  }
}
