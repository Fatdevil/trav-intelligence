import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// Tillåt edge runtimes för streaming
export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { systemData, bankroll } = await req.json();

    // Initiera Anthropic. Fallback för frånvarande API-nyckel?
    if (!process.env.ANTHROPIC_API_KEY) {
       return new Response(
         "### [SYNDICATE BUILDER OFFLINE]\n\n" +
         "> [!WARNING]\n" +
         "> **ANTHROPIC_API_KEY** saknas i .env filen.\n\n" +
         "Lägg till din API-nyckel för att Låsa upp God-Tier Opus-Intelligens.\n\n" +
         "I smyg genererad simulering baserad på LightGBM-matrisen: Spika i V86-3 och V86-7. Helgardera resten.", { status: 200 }
       );
    }

    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `
Du är "The Chief Analyst" (Kvantitativ Spelchef) kapabel att skapa professionella trav-syndikat.
Du har fått in "Edge-matrisen" från vår Machine Learning Modell (V2 Moonshot). Din uppgift är att skriva en Omgångssyntes och föreslå ett V86/V75 Trav-system baserat EXAKT på dessa LightGBM-data. 

Målet är att spendera ca ${bankroll} kr. Systemet måste ha 2 spikar. Spelformen innebär att man väljer antal hästar per lopp, och raderna multipliceras. (1 Rad = 0.25 kr i V86, 0.50 kr i V75). Leta efter asymmetriska Edges: hög modelldatatilltro men lågt odds? Eller hög edge?

DATA:
${JSON.stringify(systemData, null, 2)}

TONALITET: Sträng, stensäker, kvantitativ, cynisk mot "pöbeln" som spelar på fel favoriter. Kortfattad men elegant strukturerad. Formattera snitsigt med Markdown (rubriker, bolding). Använd GitHub alerts som > [!TIP] eller > [!WARNING] för kritiska insikter.

Din struktur:
# 🏦 Kvantitativ Omgångssyntes
Mullrande Inledning om kvällens förutsättningar. 
## 🎯 Spikarna (The Asymmetrical Alpha)
(Varför litar vi på V2-modellen här över massan?)
## 🔒 Låsen
(Vilka lopp vi isolerar risken i)
## 💣 Skrälldrag / Edge-explosioner
(Vilka låg-procentare har monstruös Edge?)
## 🎫 Systemramen
Skriv hur raden ska lämnas in.
    `;

    const result = await streamText({
      model: anthropic('claude-3-5-sonnet-latest'),
      prompt: prompt,
      temperature: 0.1, // Låg temp = extrem logik, minimala hallucinationer
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("[Syndicate API Error]", error);
    return new Response("Ett externt kommunikationsfel uppstod med Chef-analytikern.", { status: 500 });
  }
}
