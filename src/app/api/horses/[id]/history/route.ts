import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/horses/[id]/history — Häst-historik för formkurvor
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: horseId } = await params;
    
    // Hämta senaste 15 starter för hästen
    const history: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        rs.final_position,
        rs.km_time,
        rs.odds_final,
        rs.galloped,
        r.race_date,
        r.track_name,
        r.distance,
        r.race_number,
        r.race_type
      FROM race_starters rs
      JOIN races r ON rs.race_id = r.id
      WHERE rs.horse_id = $1 
        AND rs.scratch = false 
        AND rs.final_position > 0
      ORDER BY r.race_date DESC
      LIMIT 15
    `, horseId);

    // Häst-info
    const horse: any[] = await prisma.$queryRawUnsafe(
      'SELECT horse_name, birth_year, gender, record_time, career_earnings FROM horses WHERE id = $1',
      horseId
    );

    const formData = history.reverse().map((h: any) => ({
      date: new Date(h.race_date).toISOString().split('T')[0],
      position: h.final_position,
      kmTime: h.km_time,
      odds: h.odds_final,
      track: h.track_name,
      distance: h.distance,
      galloped: h.galloped,
      raceType: h.race_type,
    }));

    return NextResponse.json({
      horse: horse[0] ? {
        name: horse[0].horse_name,
        birthYear: horse[0].birth_year,
        gender: horse[0].gender,
        recordTime: horse[0].record_time,
        careerEarnings: horse[0].career_earnings,
      } : null,
      history: formData,
      starts: formData.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
