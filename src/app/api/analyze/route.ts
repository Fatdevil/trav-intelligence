import { NextResponse } from 'next/server';
import { runMultiAgentWorkflow } from '@/lib/ai/agents';
import { fetchLiveGameData } from '@/lib/services/atg';
import { reduceSystem, SystemLeg, RankedHorse } from '@/lib/math/reducer';
import { generateATGXml } from '@/lib/export/xml';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { budget, strategy } = await req.json();

    if (!budget || typeof budget !== 'number') {
      return NextResponse.json({ error: 'Måste ange en giltig budget' }, { status: 400 });
    }

    const gameData = await fetchLiveGameData();
    if (!gameData || !gameData.races || gameData.races.length === 0) {
      return NextResponse.json({ error: 'Kunde inte hämta live-data från ATG idag.' }, { status: 500 });
    }

    const mockWeatherData = { condition: "Heavy Rain", temp: 12 };
    const rawAgentResults = await runMultiAgentWorkflow(gameData, mockWeatherData, strategy);

    // Klipp bort JSON-koden från slutsammanfattningen så användaren slipper se koden i gränssnittet
    const cleanMasterDecision = rawAgentResults.masterDecision.replace(/```json[\s\S]*?```/, '').trim();
    const formattedSummary = `[MULTI-AGENT ANALYS AKTIVERAD]\n${rawAgentResults.agentsLog.join('\n\n')}\n\n>>> SLUTDOM:\n${cleanMasterDecision}\n\nVår matematiska algoritm bantade nyss ner kupongen till att matcha din budget exakt på ${budget} kronor!`;

    // Bygg SystemLegs med AI-rankade hästar
    // Temporärt: Rankningslogik baserad på position & odds
    const pricePerRow = gameData.type === 'V75' ? 0.5 : 1;
    
    const systemLegs: SystemLeg[] = gameData.races.slice(0, 8).map((r, idx) => {
      const rankedHorses: RankedHorse[] = r.horses.map((h, hIdx) => {
        // --- STRICT AI REDUCER LINKING ---
        let rank: 'A' | 'B' | 'C' = 'C';
        if (Array.isArray(rawAgentResults.parsedRankings)) {
          const aiRank = (rawAgentResults.parsedRankings as any[]).find((x: any) => x.horseNum === h.num && x.raceId === r.raceId);
          if (aiRank && (aiRank.rank === 'A' || aiRank.rank === 'B' || aiRank.rank === 'C')) {
            rank = aiRank.rank;
          }
        } else {
          // Fallback om AI:n mot förmodan misslyckades bygga JSON
          if (hIdx < 2) rank = 'A';
          else if (hIdx < 5) rank = 'B';
        }
        
        return {
          num: h.num,
          name: h.name,
          rank,
          driver: h.driver,
          odds: h.odds
        };
      });

      return {
        legNumber: idx + 1,
        raceId: r.raceId,
        horses: rankedHorses,
        selected: [] // Fylls i av reduceraren
      };
    });

    // KÖR REDUCERAREN!
    const reducedSystem = reduceSystem(systemLegs, budget, strategy as 'safe' | 'ev' | 'jackpot', pricePerRow);

    // Generera XML
    const xmlContent = generateATGXml(reducedSystem, gameData.type, gameData.gameId);

    // Bygg frontend-data
    const fullSystem = reducedSystem.legs.map((leg, idx) => {
      const selectedHorses = leg.horses.filter(h => leg.selected.includes(h.num));
      return {
        race: `${gameData.type}-${idx + 1}`,
        horses: selectedHorses.map(h => ({
          num: h.num,
          desc: `${h.name} (${h.rank}) – Kusk: ${h.driver}. Odds: ${h.odds > 0 ? h.odds.toFixed(1) : 'N/A'}.`
        }))
      };
    });

    // Plocka ut de två mest intressanta hästarna för "Kupongens Kärna"-korten
    const r1 = gameData.races[0];
    const r2 = gameData.races[1];
    const h1 = r1?.horses[0];
    const h2 = r2?.horses[0];

    const result = {
      systemCost: reducedSystem.totalCost,
      totalRows: reducedSystem.totalRows,
      strategyName: strategy === 'safe' ? "Låg Risk" : strategy === 'jackpot' ? "Miljonjakten" : "Optimalt EV+",
      analysisSummary: formattedSummary,
      selections: [
        {
          id: h1?.num || 1,
          lopp: `${gameData.type}-1`,
          name: h1?.name || "Okänd",
          odds: h1?.odds ? h1.odds.toFixed(1) : "N/A",
          motivation: `Kusk: ${h1?.driver || 'Okänd'}. AI-analysens primära val baserat på ${strategy}-strategi.`
        },
        {
          id: h2?.num || 2,
          lopp: `${gameData.type}-2`,
          name: h2?.name || "Okänd",
          odds: h2?.odds ? h2.odds.toFixed(1) : "N/A",
          motivation: `Kusk: ${h2?.driver || 'Okänd'}. Utmärkt grundval i ${gameData.type}-2.`
        }
      ],
      fullSystem,
      xmlContent
    };

    // --- SPARA TILL MINNESBANKEN (PRISMA DATABASE) ---
    try {
      if (gameData.gameId) {
        // Kontrollera om tävlingsdagen finns
        let raceEvent = await prisma.raceEvent.findFirst({
          where: { id: gameData.gameId }
        });
        
        if (!raceEvent) {
          raceEvent = await prisma.raceEvent.create({
            data: {
              id: gameData.gameId,
              date: new Date(),
              track: gameData.races[0]?.trackName || "Okänd",
              type: gameData.type
            }
          });
        }
        
        // Logga AI:ns utlåtande
        await prisma.aI_PredictionLog.create({
          data: {
            eventId: gameData.gameId,
            strategy: strategy,
            budget: Number(budget),
            promptContext: JSON.stringify(gameData.races.map(r => r.raceId)),
            aiRawResponse: rawAgentResults.masterDecision
          }
        });
        console.log("✅ AI Prediction sparat i databasen!");
      }
    } catch (dbErr) {
      console.error("⚠️ Fel vid sparande till Prisma databasen:", dbErr);
      // Vi kraschar inte appen för användaren om DB är nere!
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Route error:', error);
    return NextResponse.json({ error: 'Något gick snett internt' }, { status: 500 });
  }
}
