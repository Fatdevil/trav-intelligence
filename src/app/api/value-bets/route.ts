import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET /api/value-bets — Edge-bets sorterat på högst edge
export async function GET() {
  try {
    const db = getDb();

    const bets = db.prepare(`
      SELECT id, horse_name, driver_name, track_name, race_number, race_date,
             post_position, model_prob, market_prob, decimal_odds, edge, expected_value, kelly_stake, tier
      FROM value_bets
      ORDER BY 
        CASE WHEN tier = 'GULDTIPS' THEN 0 ELSE 1 END,
        edge DESC
      LIMIT 50
    `).all() as any[];

    const formatted = bets.map(vb => ({
      id: vb.id,
      horseName: vb.horse_name,
      driverName: vb.driver_name,
      trackName: vb.track_name,
      raceNumber: vb.race_number,
      raceDate: vb.race_date?.split('T')[0] || '',
      postPosition: vb.post_position,
      modelProb: Math.round(vb.model_prob * 100),
      marketProb: Math.round(vb.market_prob * 100),
      odds: vb.decimal_odds,
      edge: Math.round(vb.edge * 100),
      ev: vb.expected_value,
      kelly: vb.kelly_stake,
      tier: vb.tier || 'BEVAKNING',
      tierLabel: vb.tier === 'GULDTIPS' 
        ? 'Guldtips - Bevisad positiv ROI' 
        : 'Bevakning - Edge finns',
    }));

    const guldCount = formatted.filter(b => b.tier === 'GULDTIPS').length;

    return NextResponse.json({
      bets: formatted,
      count: formatted.length,
      guldtipsCount: guldCount,
      bevakningCount: formatted.length - guldCount,
    });
  } catch (error: any) {
    console.error('Value-bets API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
