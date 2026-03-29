process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { GameData } from '../services/atg';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from "@google/generative-ai";

const prisma = new PrismaClient();
import {
  AGENT_EXPLAINER_PROMPT,
  AGENT_GOSSIP_PROMPT,
} from './prompts';

// Initialisera Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Hämta modellens value bets från databasen
 * Dessa matas in i AI:n så den kan FÖRKLARA varför modellen valde dem.
 */
async function getModelValueBets(): Promise<string> {
  try {
    const bets: any[] = await prisma.$queryRawUnsafe(`
      SELECT horse_name, track_name, race_number, decimal_odds, edge, driver_name, post_position, model_prob, market_prob
      FROM value_bets 
      WHERE tier = 'GULDTIPS'
      ORDER BY edge DESC
      LIMIT 20
    `);

    if (bets.length === 0) return "Inga GULDTIPS finns i databasen just nu.";

    return bets.map((b: any) => {
      const edgePct = (b.edge * 100).toFixed(1);
      const modelPct = (b.model_prob * 100).toFixed(1);
      const marketPct = (b.market_prob * 100).toFixed(1);
      return `GULDTIPS: ${b.horse_name} (Lopp ${b.race_number}, ${b.track_name}) | Odds: ${b.decimal_odds} | Edge: +${edgePct}% | Modell: ${modelPct}% vs Marknad: ${marketPct}% | Kusk: ${b.driver_name} | Spår: ${b.post_position}`;
    }).join('\n');
  } catch (e) {
    console.error("Value bets fetch error:", e);
    return "Kunde inte hämta value bets — databasen kan vara tom.";
  }
}

/**
 * Hämta BEVAKNING-bets
 */
async function getWatchlistBets(): Promise<string> {
  try {
    const bets: any[] = await prisma.$queryRawUnsafe(`
      SELECT horse_name, track_name, race_number, decimal_odds, edge
      FROM value_bets 
      WHERE tier = 'BEVAKNING'
      ORDER BY edge DESC
      LIMIT 10
    `);

    if (bets.length === 0) return "Inga BEVAKNING-bets.";

    return bets.map((b: any) =>
      `BEVAKNING: ${b.horse_name} (Lopp ${b.race_number}) | Odds: ${b.decimal_odds} | Edge: +${(b.edge * 100).toFixed(1)}%`
    ).join('\n');
  } catch (e) {
    return "Kunde inte hämta BEVAKNING-bets.";
  }
}

export async function runMultiAgentWorkflow(gameData: GameData, weatherInfo: any, strategy: string) {
  
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  // Skvaller-agenten behåller Google Search-superkraften
  const searchModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} }] as any
  });

  const currentDate = new Date().toISOString().split('T')[0];
  
  // Kontextdata från ATG
  const contextData = JSON.stringify({
    today: currentDate,
    weather: weatherInfo,
    races: gameData.races.map(r => ({
      race: r.raceId,
      distance: r.distance,
      trackInfo: `${r.trackName} - ${r.trackCondition}`,
      start: r.startMethod,
      horses: r.horses.map(h => `${h.num}. ${h.name} (${h.age}år ${h.sex}, Intjänat: ${h.money}kr). Odds: ${h.odds.toFixed(1)}. Kusk: ${h.driver}. Tränare: ${h.trainer}. Utrustning: ${h.shoes} / ${h.sulky}`)
    }))
  });

  try {
    // === STEG 1: Hämta LGBM:s value bets + features ===
    const [valueBetsData, watchlistData] = await Promise.all([
      getModelValueBets(),
      getWatchlistBets()
    ]);

    // === STEG 2: Kör Förklararen + Skvaller parallellt ===
    const explainerPrompt = `${AGENT_EXPLAINER_PROMPT}

--- MODELLENS VALUE BETS (LightGBM, verifierat +9.57% ROI) ---
${valueBetsData}

--- BEVAKNING ---
${watchlistData}

--- STARTLISTOR & VÄDER ---
${contextData}`;

    const gossipPrompt = `${AGENT_GOSSIP_PROMPT}

--- MODELLENS GULDTIPS (sök live-info om dessa hästar) ---
${valueBetsData}

--- STARTLISTOR ---
${contextData}`;

    const [explainerResult, gossipResult] = await Promise.all([
      model.generateContent(explainerPrompt),
      searchModel.generateContent(gossipPrompt)
    ]);

    const explainerReport = explainerResult.response.text();
    const gossipReport = gossipResult.response.text();

    // --- RAG: Minnesbank (lärdomar från tidigare lopp) ---
    let pastLessons = "Inga historiska lärdomar finns sparade än.";
    try {
      const rawInsights = await prisma.coreInsight.findMany({
        where: { confidence: { gt: 0.4 } },
        orderBy: { confidence: 'desc' },
        take: 100
      });

      if (rawInsights.length > 0) {
        const contextString = contextData.toLowerCase();
        const scoredInsights = rawInsights.map(insight => {
          let score = insight.confidence;
          const words = insight.category.toLowerCase().split(' ').concat(insight.insightText.toLowerCase().split(' '));
          words.forEach(word => {
            if (word.length > 3 && contextString.includes(word)) {
              score += 0.5;
            }
          });
          return { ...insight, score };
        });
        scoredInsights.sort((a, b) => b.score - a.score);
        const topRelevant = scoredInsights.slice(0, 5);
        pastLessons = topRelevant.map((i: any) => `[${i.category}] ${i.insightText} (Relevans: ${i.score.toFixed(1)})`).join('\n');
      }
    } catch (e) { console.error("RAG fetch fail", e) }

    // === SAMMANSTÄLLNING ===
    // Förklararen fungerar som huvuddomare — ingen separat judge behövs
    const agentsLog = [
      "🧠 Förklararen (LGBM-analys):\n" + explainerReport,
      "🔍 Skvaller-Agenten:\n" + gossipReport,
    ];

    // Masterbeslutet ÄR Förklararens rapport + skvaller
    const masterDecision = `# Trav Edge AI-Analys

## Baserat på LightGBM-modellen (verifierat +9.57% ROI i out-of-sample)

${explainerReport}

---
${gossipReport}

---
### 📚 Historiska lärdomar som påverkar analysen
${pastLessons}`;

    return {
      agentsLog,
      masterDecision,
      parsedRankings: null // Vi använder GULDTIPS/BEVAKNING från modellen istället
    };
  } catch (error) {
    console.error("AI Error:", error);
    return {
      agentsLog: ["Ett fel uppstod vid anrop till Gemini."],
      masterDecision: "API-nyckeln eller nätverket nekade anropet.",
      parsedRankings: null
    };
  }
}
