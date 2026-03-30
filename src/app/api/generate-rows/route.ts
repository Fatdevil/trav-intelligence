import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// POST /api/generate-rows — AI Radgenerator
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const budget = body.budget || 500;
    const unitCost = body.unitCost || 2;
    const risk = body.risk || 'balanced';
    const gameType = body.gameType || null;

    // Risk config
    const riskConfig: Record<string, { max: number; spikThreshold: number }> = {
      conservative: { max: 2, spikThreshold: 0.25 },
      balanced:     { max: 4, spikThreshold: 0.20 },
      aggressive:   { max: 6, spikThreshold: 0.15 },
    };
    const config = riskConfig[risk] || riskConfig.balanced;

    // Get upcoming races with predictions
    const today = new Date().toISOString().split('T')[0];
    let dateFilter = `CAST(r.race_date AS TEXT) >= '${today}'`;
    
    // Check if there are upcoming races, else use latest
    const upcoming: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as cnt FROM races WHERE CAST(race_date AS TEXT) >= $1`, today
    );
    
    if (Number(upcoming[0]?.cnt) === 0) {
      const latest: any[] = await prisma.$queryRawUnsafe(
        'SELECT race_date FROM races ORDER BY race_date DESC LIMIT 1'
      );
      if (latest.length > 0) {
        const d = new Date(latest[0].race_date).toISOString().split('T')[0];
        dateFilter = `CAST(r.race_date AS TEXT) LIKE '${d}%'`;
      }
    }

    // Get all horses with model_prob
    const horses: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        r.race_number, r.track_name, r.race_type, r.distance,
        rs.post_position, rs.odds_final,
        h.horse_name,
        rs.driver_name,
        vb.model_prob, vb.edge
      FROM races r
      JOIN race_starters rs ON r.id = rs.race_id
      JOIN horses h ON rs.horse_id = h.id
      LEFT JOIN value_bets vb ON vb.starter_id = rs.id
      WHERE rs.scratch = false AND ${dateFilter}
      ${gameType ? `AND r.race_type = '${gameType}'` : ''}
      ORDER BY r.race_number, rs.post_position
    `);

    if (horses.length === 0) {
      return NextResponse.json({ error: 'Inga lopp hittade', rows: null });
    }

    // Group by race
    const raceMap: Record<number, any[]> = {};
    horses.forEach(h => {
      const rn = h.race_number;
      if (!raceMap[rn]) raceMap[rn] = [];
      raceMap[rn].push({
        post: h.post_position,
        name: h.horse_name,
        driver: h.driver_name,
        track: h.track_name,
        odds: h.odds_final || 100,
        modelProb: Number(h.model_prob) || 0.01,
        edge: Number(h.edge) || 0,
      });
    });

    const raceNumbers = Object.keys(raceMap).map(Number).sort((a, b) => a - b);

    // Greedy optimization
    const selections: Record<number, number[]> = {};
    
    // Step 1: Start with top horse per race
    for (const rn of raceNumbers) {
      const sorted = [...raceMap[rn]].sort((a, b) => b.modelProb - a.modelProb);
      selections[rn] = [sorted[0].post];
    }

    const totalRows = () => Object.values(selections).reduce((acc, v) => acc * v.length, 1);
    const totalCost = () => totalRows() * unitCost;

    // Step 2: Greedy — add horses with best EV/kr
    for (let iter = 0; iter < 50; iter++) {
      if (totalCost() >= budget) break;

      let bestGain = -1;
      let bestRace: number | null = null;
      let bestPost: number | null = null;

      for (const rn of raceNumbers) {
        if (selections[rn].length >= config.max) continue;
        
        const sorted = [...raceMap[rn]].sort((a, b) => b.modelProb - a.modelProb);
        const currentPosts = new Set(selections[rn]);

        for (const horse of sorted) {
          if (currentPosts.has(horse.post)) continue;

          const oldRows = totalRows();
          const newRows = oldRows * (selections[rn].length + 1) / selections[rn].length;
          const extraCost = (newRows - oldRows) * unitCost;

          if (totalCost() + extraCost > budget * 1.1) continue;

          const gain = horse.modelProb / Math.max(extraCost, 0.01);
          if (gain > bestGain) {
            bestGain = gain;
            bestRace = rn;
            bestPost = horse.post;
          }
        }
      }

      if (bestRace === null || bestPost === null) break;
      selections[bestRace].push(bestPost);
    }

    // Build response
    const raceResults = raceNumbers.map(rn => {
      const posts = selections[rn].sort((a, b) => a - b);
      const allHorses = raceMap[rn];
      const selected = posts.map(p => allHorses.find(h => h.post === p)).filter(Boolean);
      const coverage = Math.min(selected.reduce((s, h) => s + (h?.modelProb || 0), 0), 0.99);
      
      return {
        raceNumber: rn,
        track: allHorses[0]?.track || '',
        type: posts.length === 1 ? 'SPIK' : posts.length <= 2 ? 'HALVGARD' : 'GARDERING',
        coverage: Math.round(coverage * 100),
        horses: selected.map(h => ({
          post: h!.post,
          name: h!.name,
          driver: h!.driver,
          modelProb: Math.round(h!.modelProb * 1000) / 10,
          odds: h!.odds,
          edge: Math.round(h!.edge * 1000) / 10,
        })),
      };
    });

    const rows = totalRows();
    const cost = totalCost();
    const allProbs = raceResults.map(r => r.coverage / 100);
    const totalProb = allProbs.reduce((a, b) => a * b, 1);

    return NextResponse.json({
      rows: {
        selections: raceResults,
        totalRows: rows,
        cost,
        totalProbability: Math.round(totalProb * 10000) / 100,
        budget,
        risk,
        gameType: gameType || horses[0]?.race_type || 'V86',
        raceCount: raceNumbers.length,
        spiks: raceResults.filter(r => r.type === 'SPIK').length,
        garderat: raceResults.filter(r => r.type !== 'SPIK').length,
      }
    });
  } catch (error: any) {
    console.error('Generate rows error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
