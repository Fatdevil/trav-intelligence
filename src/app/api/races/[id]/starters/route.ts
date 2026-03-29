import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET /api/races/[id]/starters — Startfält med features och edge-data
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: raceId } = await params;
    const db = getDb();

    // Hämta loppet
    const race = db.prepare(`
      SELECT id, race_number, track_name, distance, start_type, prize_money, num_starters, race_date
      FROM races WHERE id = ?
    `).get(raceId) as any;

    if (!race) {
      return NextResponse.json({ error: 'Loppet hittades inte.' }, { status: 404 });
    }

    // Hämta startfält
    const starters = db.prepare(`
      SELECT rs.id AS starter_id, rs.post_position, rs.driver_name, rs.trainer_name,
             rs.km_time, rs.odds_final, rs.odds_pre_race, rs.final_position, rs.scratch,
             h.horse_name
      FROM race_starters rs
      JOIN horses h ON rs.horse_id = h.id
      WHERE rs.race_id = ? AND rs.scratch = 0
      ORDER BY rs.post_position ASC
    `).all(raceId) as any[];

    // Hämta features per starter (EAV → objekt)
    const featureRows = db.prepare(`
      SELECT starter_id, feature_name, feature_value FROM features WHERE race_id = ?
    `).all(raceId) as any[];

    const featuresByStarter: Record<string, Record<string, number>> = {};
    featureRows.forEach(f => {
      if (!featuresByStarter[f.starter_id]) featuresByStarter[f.starter_id] = {};
      featuresByStarter[f.starter_id][f.feature_name] = f.feature_value;
    });

    // Hämta value bets för detta lopp
    const valueBets = db.prepare(`
      SELECT starter_id, model_prob, market_prob, decimal_odds, edge, expected_value, kelly_stake
      FROM value_bets WHERE race_id = ?
    `).all(raceId) as any[];

    const vbByStarter: Record<string, any> = {};
    valueBets.forEach(vb => { vbByStarter[vb.starter_id] = vb; });

    // Assembla
    const horses = starters.map(s => {
      const feat = featuresByStarter[s.starter_id] || {};
      const vb = vbByStarter[s.starter_id] || null;

      return {
        post: s.post_position,
        name: s.horse_name,
        driver: s.driver_name,
        trainer: s.trainer_name,
        kmTime: s.km_time
          ? `1:${(s.km_time % 60).toFixed(1).replace('.', ',')}`
          : feat['avg_km_time_last5']
            ? `1:${(feat['avg_km_time_last5'] % 60).toFixed(1).replace('.', ',')}`
            : '—',
        driverForm: feat['driver_win_rate_last30']
          ? `${(feat['driver_win_rate_last30'] * 100).toFixed(0)}%`
          : '—',
        classChange: feat['class_change'] || 0,
        modelProb: vb ? Math.round(vb.model_prob * 100) : 0,
        marketProb: vb ? Math.round(vb.market_prob * 100) : (s.odds_final > 1 ? Math.round((1 / s.odds_final) * 100) : 0),
        odds: s.odds_final || s.odds_pre_race || 0,
        edge: vb ? vb.edge : 0,
        ev: vb ? vb.expected_value : 0,
        scratch: !!s.scratch,
        finalPosition: s.final_position,
        features: feat,
      };
    });

    return NextResponse.json({
      race: {
        id: race.id,
        num: race.race_number,
        distance: `${race.distance} m ${race.start_type}`,
        trackName: race.track_name,
        raceDate: race.race_date?.split('T')[0] || '',
        prize: race.prize_money,
        starters: race.num_starters,
      },
      horses,
    });
  } catch (error: any) {
    console.error('Starters API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
