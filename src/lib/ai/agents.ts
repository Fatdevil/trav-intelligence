process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { GameData } from '../services/atg';
import { GoogleGenerativeAI } from "@google/generative-ai";
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
  const contextData = JSON.stringify({
    weather: weatherInfo,
    races: gameData.races.map(r => ({
      race: r.raceId,
      distance: r.distance,
      horses: r.horses.map(h => `${h.num}. ${h.name} (${h.odds} i odds) Kusk: ${h.driver}. Skor: ${h.shoes}`)
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

    // Låt Huvuddomaren analysera experternas svar utifrån vald risk
    const masterPrompt = `${MASTER_JUDGE_PROMPT}\n\nSTRATEGI VALD: ${strategy === 'safe' ? 'Låg Risk' : strategy === 'jackpot' ? 'Hög Risk/Miljonjakt' : 'Ren EV-Matematik'}\n\nRAPPORTER FRÅN EXPERTERNA:\n${agentsLog.join('\n\n')}\n\nObservera: Du måste avgöra systemets A-B-C rank utifrån dessa samlade spetskompetenser!`;
    
    const master = await model.generateContent(masterPrompt);
    const masterDecision = master.response.text();

    return {
      agentsLog,
      masterDecision
    };
  } catch (error) {
    console.error("AI Error:", error);
    return {
      agentsLog: ["Ett fel uppstod vid anrop till Gemini."],
      masterDecision: "API-nyckeln eller nätverket nekade anropet."
    };
  }
}
