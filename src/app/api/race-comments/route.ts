import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { generateHorseComment, HorseComment } from '@/lib/ai/commentGenerator';

const prisma = new PrismaClient();

/**
 * GET /api/race-comments?raceId=xxx
 * Returnerar feature-baserade kommentarer för ALLA hästar i ett lopp.
 * Kostar 0 kr — ingen AI-anrop, ren data.
 * 
 * Om inget raceId anges: returnerar kommentarer för senaste 50 value bets.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raceId = searchParams.get('raceId');

    if (raceId) {
      // === MODE 1: Alla hästar i ett specifikt lopp ===
      const starters: any[] = await prisma.$queryRawUnsafe(`
        SELECT rs.id, rs.post_position, rs.odds_final,
               h.name as horse_name,
               rs.driver_name,
               r.race_date, r.track_name, r.race_number
        FROM race_starters rs
        JOIN horses h ON rs.horse_id = h.id
        JOIN races r ON rs.race_id = r.id
        WHERE rs.race_id = ?
        ORDER BY rs.post_position
      `, raceId);

      if (starters.length === 0) {
        return NextResponse.json({ error: 'Inget lopp hittades', comments: [] }, { status: 404 });
      }

      // Hämta features + modellprediktioner för varje starter
      const comments: HorseComment[] = [];
      
      for (const starter of starters) {
        // Hämta features
        const features: any[] = await prisma.$queryRawUnsafe(`
          SELECT feature_name, feature_value FROM features WHERE starter_id = ?
        `, starter.id);
        
        const featureMap: Record<string, number> = {};
        features.forEach((f: any) => { featureMap[f.feature_name] = f.feature_value; });

        // Hämta modellpredikter om de finns
        const preds: any[] = await prisma.$queryRawUnsafe(`
          SELECT calibrated_prob FROM predictions WHERE starter_id = ? ORDER BY created_at DESC LIMIT 1
        `, starter.id);
        
        // Kolla om det finns value bet-data
        const vb: any[] = await prisma.$queryRawUnsafe(`
          SELECT model_prob, edge, tier FROM value_bets WHERE starter_id = ?
        `, starter.id);

        const modelProb = vb.length > 0 ? vb[0].model_prob : (preds.length > 0 ? preds[0].calibrated_prob : null);
        const odds = starter.odds_final || 99;

        if (modelProb !== null) {
          const comment = generateHorseComment(
            starter.horse_name,
            starter.post_position,
            odds,
            modelProb,
            featureMap
          );
          comments.push(comment);
        }
      }

      return NextResponse.json({
        raceId,
        trackName: starters[0]?.track_name || '',
        raceNumber: starters[0]?.race_number || 0,
        horseCount: comments.length,
        comments: comments.sort((a, b) => b.edge - a.edge), // Sorterade på edge
      });

    } else {
      // === MODE 2: Senaste value bets med kommentarer ===
      const valueBets: any[] = await prisma.$queryRawUnsafe(`
        SELECT vb.starter_id, vb.horse_name, vb.driver_name, vb.post_position,
               vb.decimal_odds, vb.model_prob, vb.market_prob, vb.edge,
               vb.track_name, vb.race_number, vb.tier
        FROM value_bets vb
        ORDER BY vb.edge DESC
        LIMIT 50
      `);

      const comments: HorseComment[] = [];
      
      for (const vb of valueBets) {
        // Hämta features för denna starter
        const features: any[] = await prisma.$queryRawUnsafe(`
          SELECT feature_name, feature_value FROM features WHERE starter_id = ?
        `, vb.starter_id);
        
        const featureMap: Record<string, number> = {};
        features.forEach((f: any) => { featureMap[f.feature_name] = f.feature_value; });

        const comment = generateHorseComment(
          vb.horse_name,
          vb.post_position,
          vb.decimal_odds,
          vb.model_prob,
          featureMap
        );
        comments.push(comment);
      }

      return NextResponse.json({
        totalBets: comments.length,
        guldtips: comments.filter(c => c.tier === 'GULDTIPS').length,
        bevakning: comments.filter(c => c.tier === 'BEVAKNING').length,
        comments,
      });
    }
  } catch (error) {
    console.error('Race comments error:', error);
    return NextResponse.json({ error: 'Fel vid generering av kommentarer' }, { status: 500 });
  }
}
