import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, system } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "No messages array provided" }, { status: 400 });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ reply: "Ingen API-nyckel konfigurerad i backenden för Sonnet." });
    }

    // Call Anthropic Messages API securely from server-side
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20240620", // Best approximation for "sonnet 4.6"
        max_tokens: 1000,
        system: system, // We allow the frontend to build the data-rich prompt
        messages: messages
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("Anthropic API Error:", data.error);
      return NextResponse.json({ reply: "Ett fel uppstod vid kommunikation med analysmotorn." }, { status: 500 });
    }

    const reply = data.content?.[0]?.text || "Ingen text returnerades från modellen.";
    return NextResponse.json({ reply });

  } catch (error) {
    console.error('Chat proxy error:', error);
    return NextResponse.json({ reply: "Ett nätverksfel uppstod i proxyn." }, { status: 500 });
  }
}
