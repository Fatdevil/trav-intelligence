process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { GameData } from '../services/atg';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from "@google/generative-ai";

const prisma = new PrismaClient();
import {
  AGENT_TACTICIAN_PROMPT,
  AGENT_TRACK_EXPERT_PROMPT,
  AGENT_EV_HUNTER_PROMPT,
  AGENT_SENTIMENT_PROMPT,
  AGENT_MARKET_PROMPT,
  MASTER_JUDGE_PROMPT
} from './prompts';

// Initialisera Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function runMultiAgentWorkflow(gameData: GameData, weatherInfo: any, strategy: string) {
  
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  // Skvaller-agenten får en superkraft: Live Google Search!
  const searchModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} }] as any
  });

  // Vi bygger ett tajt data-objekt för att skicka till AI:n
  const currentDate = new Date().toISOString().split('T')[0];
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

  const promptTactician = `${AGENT_TACTICIAN_PROMPT}\n\nHär är dagens data:\n${contextData}`;
  const promptTrack = `${AGENT_TRACK_EXPERT_PROMPT}\n\nHär är dagens data:\n${contextData}`;
  const promptEV = `${AGENT_EV_HUNTER_PROMPT}\n\nHär är dagens data:\n${contextData}`;
  const promptSentiment = `${AGENT_SENTIMENT_PROMPT}\n\nHär är dagens data:\n${contextData}`;
  const promptMarket = `${AGENT_MARKET_PROMPT}\n\nHär är dagens data:\n${contextData}`;

  try {
    // Kör alla 5 agenter parallellt för maximal snabbhet
    const [tact, track, ev, sent, market] = await Promise.all([
      model.generateContent(promptTactician),
      model.generateContent(promptTrack),
      model.generateContent(promptEV),
      searchModel.generateContent(promptSentiment), // Denna agent söker nu skarpt på nätet!
      model.generateContent(promptMarket)
    ]);

    const tacticianReport = "🏇 Taktikern: " + tact.response.text();
    const trackReport = "🌧️ Ban-Experten: " + track.response.text();
    const evHunterReport = "📉 Skrälljägaren: " + ev.response.text();
    const sentimentReport = "🔥 Skvaller-Agenten: " + sent.response.text();
    const marketReport = "📈 Kvant-Agenten: " + market.response.text();

    const agentsLog = [tacticianReport, trackReport, evHunterReport, sentimentReport, marketReport];

    // --- RAG: SMART KONTEXTUELL MINNESBANK (Vectorless Search) ---
    let pastLessons = "Inga historiska lärdomar finns sparade än.";
    try {
      // 1. Hämta de 100 mest säkra insikterna
      const rawInsights = await prisma.coreInsight.findMany({
        where: { confidence: { gt: 0.4 } },
        orderBy: { confidence: 'desc' },
        take: 100
      });

      if (rawInsights.length > 0) {
         // 2. Beräkna "Relevance Score" genom att matcha ord i lärdomen mot dagens kontext
         const contextString = contextData.toLowerCase();
         const scoredInsights = rawInsights.map(insight => {
           let score = insight.confidence; // Grundtrygghet
           const words = insight.category.toLowerCase().split(' ').concat(insight.insightText.toLowerCase().split(' '));
           
           words.forEach(word => {
             if (word.length > 3 && contextString.includes(word)) {
               score += 0.5; // Bonus för varje matchande nyckelord t.ex. "Jägersro", "Voltstart", "Tung", Hästnamn
             }
           });
           return { ...insight, score };
         });

         // 3. Sortera på högsta relevans och plocka Top 5 (De som betyder mest IDAG)
         scoredInsights.sort((a, b) => b.score - a.score);
         const topRelevant = scoredInsights.slice(0, 5);
         
         pastLessons = topRelevant.map((i: any) => `[KATEGORI: ${i.category}] LÄRDOM: ${i.insightText} (Bedömd Relevans för idag: ${i.score.toFixed(1)})`).join('\n');
      }
    } catch (e) { console.error("Prisma Smarta RAG fetch fail", e) }

    // Låt Huvuddomaren analysera experternas svar utifrån vald risk OCH det inlästa minnet!
    const masterPrompt = `${MASTER_JUDGE_PROMPT}\n\nSTRATEGI VALD: ${strategy === 'safe' ? 'Låg Risk' : strategy === 'jackpot' ? 'Hög Risk/Miljonjakt' : 'Ren EV-Matematik'}\n\n-- MINNESBANKEN (DINA TIDIGARE LÄRDOMAR) --\n${pastLessons}\n\nRAPPORTER FRÅN EXPERTERNA:\n${agentsLog.join('\n\n')}\n\nObservera: Du måste avgöra systemets A-B-C rank utifrån dessa samlade spetskompetenser OCH dina tidigare lärdomar!`;
    
    const master = await model.generateContent(masterPrompt);
    const masterDecision = master.response.text();

    // --- PARSE AUTOMATIC JSON RANKING ---
    let parsedRankings = null;
    const jsonMatch = masterDecision.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        parsedRankings = JSON.parse(jsonMatch[1].trim());
      } catch (err) {
        console.error("Master Judge JSON Parse Error", err);
      }
    }

    return {
      agentsLog,
      masterDecision,
      parsedRankings
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
