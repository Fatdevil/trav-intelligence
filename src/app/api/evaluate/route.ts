import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AGENT_EVALUATOR_PROMPT } from '@/lib/ai/prompts';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // För ATG certifikat
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function GET() {
  try {
    // 1. Hämta alla ouvärderade system från Minnesbanken
    const pendingLogs = await prisma.aI_PredictionLog.findMany({
      where: { hasBeenEvaluated: false },
      take: 5 // Ta max 5 åt gången för att inte slå i API-limits
    });

    if (pendingLogs.length === 0) {
      return NextResponse.json({ message: "Inga nya system att utvärdera." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const insightsGenerated = [];

    for (const log of pendingLogs) {
      // 2. Hämta riktiga tävlingsresultatet från ATG
      const atgRes = await fetch(`https://www.atg.se/services/racinginfo/v1/api/games/${log.eventId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!atgRes.ok) {
        console.error(`Kunde inte hitta ATG data för event ${log.eventId}`);
        continue;
      }

      const gameData = await atgRes.json();
      
      // Har tävlingen fått ett resultat än?
      if (!gameData.races || gameData.status !== "results") {
        console.error(`Tävling ${log.eventId} saknar färdiga resultat.`);
        continue; // Hoppa över, löps inte än eller är ej helt klart
      }

      // 3. Extrahera vinnarna!
      const actualWinners = gameData.races.map((r: any) => {
        const winner = r.starts?.find((s: any) => s.result && (s.result.place === 1 || s.result.finishOrder === 1));
        return `Lopp ${r.number}: Vinnare blev häst nr ${winner?.number || 'Okänd'} (${winner?.horse?.name || 'Okänd'})`;
      });

      // 4. Fråga Utvärderaren (AI)
      const evaluationQuery = `
      ${AGENT_EVALUATOR_PROMPT}
      
      -- DÅTID (Vad AI:n trodde innan loppet) --
      TIDIGARE ANALYS:
      ${log.aiRawResponse}
      
      -- FRAMTID (Vad som faktiskt hände) --
      FAKTISKA VINNARE:
      ${actualWinners.join('\n')}
      
      DU MÅSTE svara med:
      CATEGORY: [Kategori]
      INSIGHT: [Lärdom]
      CONFIDENCE: [0.0 - 1.0]
      `;

      const result = await model.generateContent(evaluationQuery);
      const text = result.response.text();

      // Enkel parsning av formatet
      const categoryMatch = text.match(/CATEGORY:\s*(.*)/i);
      const insightMatch = text.match(/INSIGHT:\s*(.*)/i);
      const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

      if (categoryMatch && insightMatch && confidenceMatch) {
         // 5. Spara lärdomen (CoreInsight) in i Prisma!
         const newInsight = await prisma.coreInsight.create({
           data: {
             category: categoryMatch[1].trim(),
             insightText: insightMatch[1].trim(),
             confidence: parseFloat(confidenceMatch[1].trim())
           }
         });
         insightsGenerated.push(newInsight);

         // 6. Markera som utvärderad
         await prisma.aI_PredictionLog.update({
           where: { id: log.id },
           data: { hasBeenEvaluated: true }
         });
      }
    }

    return NextResponse.json({
      message: `Utvärderade ${insightsGenerated.length} system framgångsrikt.`,
      insights: insightsGenerated
    });

  } catch (error) {
    console.error("Evaluation loop error:", error);
    return NextResponse.json({ error: "Ett internt fel uppstod vid utvärdering" }, { status: 500 });
  }
}
