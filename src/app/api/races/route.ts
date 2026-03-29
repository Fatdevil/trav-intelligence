import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET /api/races — Hämtar senaste loppdagens alla lopp med startfält
export async function GET() {
  try {
    const db = getDb();

    // Hitta senaste loppdatumet
    const latest = db.prepare('SELECT race_date FROM races ORDER BY race_date DESC LIMIT 1').get() as any;
    if (!latest) {
      return NextResponse.json({ races: [], message: 'Inga lopp i databasen.' });
    }

    const latestDate = latest.race_date.split('T')[0];

    // Hämta alla lopp från den dagen
    const races = db.prepare(`
      SELECT id, race_number, track_name, distance, start_type, prize_money, num_starters, race_date
      FROM races
      WHERE race_date LIKE ?
      ORDER BY race_number ASC
    `).all(`${latestDate}%`) as any[];

    // Hämta hästar per lopp
    const formatted = races.map(race => {
      const starters = db.prepare(`
        SELECT rs.id AS starter_id, rs.post_position, rs.driver_name, rs.trainer_name,
               rs.km_time, rs.odds_final, rs.odds_pre_race, rs.final_position, rs.scratch,
               h.horse_name
        FROM race_starters rs
        JOIN horses h ON rs.horse_id = h.id
        WHERE rs.race_id = ? AND rs.scratch = 0
        ORDER BY rs.post_position ASC
      `).all(race.id) as any[];

      return {
        id: race.id,
        num: race.race_number,
        distance: `${race.distance} m ${race.start_type}`,
        trackName: race.track_name,
        raceDate: latestDate,
        prize: race.prize_money ? `${Math.round(race.prize_money).toLocaleString('sv-SE')} kr` : null,
        starters: race.num_starters,
        horses: starters.map(s => ({
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
    });

    return NextResponse.json({
      races: formatted,
      raceDate: latestDate,
      count: formatted.length,
    });
  } catch (error: any) {
    console.error('Races API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
