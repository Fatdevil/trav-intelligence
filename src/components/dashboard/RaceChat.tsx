"use client";
import { useState, useRef, useEffect, useMemo } from "react";

const AMBER = "#D4A843";
const AMBER_DIM = "rgba(212,168,67,0.12)";
const BG = "#0D0F14";
const BG2 = "#12141A";
const BG3 = "#181B22";
const BORDER = "#1E2028";
const TEXT = "#C4BCB0";
const TEXT2 = "#6B6B7A";
const TEXT3 = "#3A3A46";

function buildDynamicSuggestions(race: any): string[] {
  if (!race?.horses?.length) return [
    "Vilka signaler ser du i detta lopp?",
    "Vilken hast har bast form just nu?",
  ];

  const topEdge = [...race.horses]
    .filter((h: any) => !h.scratch)
    .sort((a: any, b: any) => (b.modelProb - b.marketProb) - (a.modelProb - a.marketProb))[0];

  const topDriver = [...race.horses]
    .filter((h: any) => !h.scratch)
    .sort((a: any, b: any) => parseFloat(b.driverForm || '0') - parseFloat(a.driverForm || '0'))[0];

  const suggestions: string[] = [];
  if (topEdge) suggestions.push(`Varfor har ${topEdge.name} hogre modellsannolikhet an marknaden?`);
  if (topDriver) suggestions.push(`Hur har ${topDriver.driver} presterat senaste manaden?`);
  suggestions.push(`Vilka hastar i lopp ${race.num} ar undervaerderade?`);
  if (race.distance?.includes('volt')) suggestions.push("Vilka hastar gynnas av voltstart i detta falt?");
  else suggestions.push("Hur paverkar sparplaceringarna chanserna i detta lopp?");

  return suggestions.slice(0, 3);
}

function buildAutoSummary(race: any): string {
  if (!race?.horses?.length) return "";

  const active = race.horses.filter((h: any) => !h.scratch);
  const withEdge = active
    .map((h: any) => ({ ...h, edge: (h.modelProb || 0) - (h.marketProb || 0) }))
    .filter((h: any) => h.edge >= 5)
    .sort((a: any, b: any) => b.edge - a.edge);

  if (withEdge.length === 0) return "Inga tydliga edge-kandidater identifierade i detta lopp.";

  const parts = withEdge.slice(0, 3).map((h: any) =>
    `${h.name} (sp.${h.post}): modell ${h.modelProb}% vs marknad ${h.marketProb}% = +${h.edge}pp edge`
  );

  return `Edge-kandidater: ${parts.join('. ')}. Ovriga hastar saknar tydlig statistisk undervaardering.`;
}

function buildSystemPrompt(race: any) {
  if (!race) return "Du ar ett analytiskt stod for travexperter. Svara kortfattat och faktabaserat pa svenska.";

  const horseData = race.horses.map((h: any) =>
    `Sp.${h.post} ${h.name} (${h.driver}): km-tid ${h.kmTime || '?'}, kuskform ${h.driverForm || '?'}, klasshopp ${(h.classChange || 0) > 0 ? "+" : ""}${h.classChange || 0}, modell ${h.modelProb}% vs marknad ${h.marketProb}%, odds ${h.odds}${h.scratch ? " — STRUKEN" : ""}`
  ).join("\n");

  const autoSummary = buildAutoSummary(race);

  return `Du ar ett analytiskt stod for en professionell travexpert. Svara alltid pa svenska. Var kortfattad, faktabaserad och direkt — undvik utfyllnadsfraser. Du har tillgang till statistik fran LightGBM-modellen men saknar realtidsinfo om skobyte, varmning och sparrnoteringar — paminn om detta nar relevant.

Aktuellt lopp: Lopp ${race.num} · ${race.distance} · ${race.prize || 'Okant pris'}

Startfalt och statistik:
${horseData}

AI-analys av loppet: ${autoSummary}

Svara baserat pa denna statistik. Om experten fragar om data du inte har (varmning, skobyte, speltrender), sag det rakt ut och foresla vad hen bor verifiera pa plats.`;
}

export default function RaceChat({ activeRace }: { activeRace?: any }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevRaceId = useRef(null);

  useEffect(() => {
    if (activeRace?.id !== prevRaceId.current) {
      setMessages([]);
      setStreamText("");
      prevRaceId.current = activeRace?.id;
    }
  }, [activeRace?.id]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  async function send(text?: string) {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    setInput("");

    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);
    setStreamText("");

    try {
      // NOTE: Directed through our secure backend proxy to prevent leaking keys
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemPrompt(activeRace),
          messages: newMessages,
        }),
      });

      const data = await response.json();
      const reply = data.reply || "Kunde inte hämta svar.";

      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setStreamText("");
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Något gick fel. Försök igen." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const hasEdge = activeRace?.horses?.some((h: any) => !h.scratch && (h.modelProb - h.marketProb) >= 5);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .chat-btn{transition:all 0.2s;cursor:pointer;border:none}
        .chat-btn:hover{transform:scale(1.05)}
        .chat-btn:active{transform:scale(0.97)}
        .msg-enter{animation:msgIn 0.18s ease-out}
        @keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .suggest-chip{cursor:pointer;transition:all 0.15s;border:none;text-align:left}
        .suggest-chip:hover{background:rgba(212,168,67,0.15)!important;border-color:rgba(212,168,67,0.4)!important}
        .suggest-chip:active{transform:scale(0.98)}
        .send-btn{transition:all 0.15s;cursor:pointer;border:none}
        .send-btn:hover{opacity:0.8}
        .send-btn:active{transform:scale(0.95)}
        .chat-input:focus{outline:none;border-color:rgba(212,168,67,0.4)!important}
        .close-btn{cursor:pointer;border:none;transition:opacity 0.15s}
        .close-btn:hover{opacity:0.7}
        .typing-dot{animation:blink 1.2s infinite}
        .typing-dot:nth-child(2){animation-delay:0.2s}
        .typing-dot:nth-child(3){animation-delay:0.4s}
        @keyframes blink{0%,80%,100%{opacity:0.2}40%{opacity:1}}
      `}</style>

      {/* Chat window */}
      {open && (
        <div style={{
          position: "fixed",
          bottom: "88px",
          right: "20px",
          width: "min(380px, calc(100vw - 40px))",
          height: "min(520px, calc(100vh - 140px))",
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          zIndex: 1000,
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          fontFamily: "'IBM Plex Mono', monospace",
        }}>

          {/* Header */}
          <div style={{
            padding: "12px 14px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: BG2,
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "7px", height: "7px", borderRadius: "50%",
                background: "#4CAF50", boxShadow: "0 0 5px #4CAF50"
              }} />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "#E8DEC8" }}>
                  Analysera · Lopp {activeRace?.num ?? "—"}
                </div>
                <div style={{ fontSize: "10px", color: TEXT3, marginTop: "1px", letterSpacing: "0.04em" }}>
                  SONNET 4.6
                </div>
              </div>
            </div>
            <button className="close-btn" onClick={() => setOpen(false)} style={{
              background: "none", color: TEXT2,
              fontSize: "18px", lineHeight: 1, padding: "2px 6px",
              borderRadius: "4px",
            }}>×</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            scrollbarWidth: "none",
          }}>
            {messages.length === 0 && !loading && (
              <div>
                <div style={{
                  fontSize: "12px", color: TEXT2, marginBottom: "12px", lineHeight: "1.6"
                }}>
                  Fråga om {activeRace ? `lopp ${activeRace.num}` : "loppet"} — hästar, kuskar, statistik eller strategi.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {buildDynamicSuggestions(activeRace).map((s: string, i: number) => (
                    <button key={i} className="suggest-chip" onClick={() => send(s)} style={{
                      padding: "8px 10px",
                      background: BG3,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "6px",
                      fontSize: "11px",
                      color: TEXT2,
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="msg-enter" style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "9px 12px",
                  borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                  background: m.role === "user" ? AMBER_DIM : BG3,
                  border: `1px solid ${m.role === "user" ? "rgba(212,168,67,0.25)" : BORDER}`,
                  fontSize: "12px",
                  color: m.role === "user" ? AMBER : TEXT,
                  lineHeight: "1.65",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="msg-enter" style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  padding: "10px 14px",
                  background: BG3,
                  border: `1px solid ${BORDER}`,
                  borderRadius: "10px 10px 10px 2px",
                  display: "flex", gap: "4px", alignItems: "center",
                }}>
                  {[0,1,2].map(i => (
                    <div key={i} className="typing-dot" style={{
                      width: "5px", height: "5px", borderRadius: "50%",
                      background: TEXT2,
                    }} />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: "10px 12px",
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            gap: "8px",
            alignItems: "flex-end",
            background: BG2,
            flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Fråga om loppet..."
              rows={1}
              style={{
                flex: 1,
                background: BG3,
                border: `1px solid ${BORDER}`,
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "12px",
                color: TEXT,
                fontFamily: "'IBM Plex Mono', monospace",
                resize: "none",
                lineHeight: "1.5",
                maxHeight: "80px",
                overflowY: "auto",
              }}
              onInput={e => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 80) + "px";
              }}
            />
            <button
              className="send-btn"
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                width: "34px", height: "34px",
                borderRadius: "6px",
                background: input.trim() && !loading ? AMBER : BG3,
                border: `1px solid ${input.trim() && !loading ? AMBER : BORDER}`,
                color: input.trim() && !loading ? "#0D0F14" : TEXT3,
                fontSize: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >↑</button>
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        className="chat-btn"
        onClick={() => setOpen(o => !o)}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          background: open ? BG3 : AMBER,
          border: open ? `1px solid ${BORDER}` : "none",
          color: open ? TEXT2 : "#0D0F14",
          fontSize: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1001,
          boxShadow: open ? "none" : "0 4px 20px rgba(212,168,67,0.35)",
        }}
      >
        {open ? "×" : "◎"}
      </button>

      {/* Edge pulse indicator on button when not open */}
      {!open && hasEdge && (
        <div style={{
          position: "fixed",
          bottom: "62px",
          right: "16px",
          width: "10px", height: "10px",
          borderRadius: "50%",
          background: AMBER,
          zIndex: 1002,
          boxShadow: `0 0 8px ${AMBER}`,
          animation: "blink 2s infinite",
        }} />
      )}
    </>
  );
}
