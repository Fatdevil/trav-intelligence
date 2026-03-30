"use client";
import { useState, useEffect } from "react";
import RaceChat from "./RaceChat";
import HorseRow from "./HorseRow";
import { useAutoIngest } from "@/hooks/useAutoIngest";
import "./dashboard.css";

interface Horse {
  post: number; name: string; driver: string; trainer: string;
  kmTime: string; driverForm?: string; classChange?: number;
  modelProb: number; marketProb: number; odds: number;
  scratch: boolean; edge?: number; ev?: number;
  aiScore?: number | null; tier?: string | null;
  starterId?: string;
}

interface Race {
  id: string | number; num: number; distance: string;
  trackName?: string; raceDate?: string;
  prize: string | null; starters: number;
  horses: Horse[]; summary?: string;
}

export default function TravDashboard() {
  const [races, setRaces] = useState<Race[]>([]);
  const [activeRace, setActiveRace] = useState<Race | null>(null);
  const [view, setView] = useState("lopp");
  const [loading, setLoading] = useState(true);
  const [valueBets, setValueBets] = useState<any[]>([]);
  const [vbCounts, setVbCounts] = useState<{guld: number, bev: number}>({guld: 0, bev: 0});
  const [raceComments, setRaceComments] = useState<any[]>([]);
  const [expandedBet, setExpandedBet] = useState<number | null>(null);
  const [eventInfo, setEventInfo] = useState<{track: string, type: string, date: string}>({track: '', type: '', date: ''});
  const { status: ingestStatus, message: ingestMsg, formattedTime, isPolling, manualIngest, togglePolling } = useAutoIngest();

  // Hämta lopp
  useEffect(() => {
    fetch('/api/races')
      .then(res => res.json())
      .then(data => {
        if (data.races && data.races.length > 0) {
          if (data.trackName || data.raceType || data.raceDate) {
            const d = data.raceDate ? new Date(data.raceDate + 'T00:00:00') : null;
            const formatted = d ? d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
            setEventInfo({ track: data.trackName || '', type: data.raceType || '', date: formatted });
          }
          const enriched = data.races.map((r: any) => ({
            ...r,
            horses: r.horses.map((h: any) => ({
              ...h,
              modelProb: h.modelProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
              marketProb: h.marketProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
            })),
          }));
          setRaces(enriched);
          setActiveRace(enriched[0]);
        }
      })
      .catch(err => console.error('Failed to load races:', err));

    fetch('/api/race-comments')
      .then(res => res.json())
      .then(data => { if (data.comments) setRaceComments(data.comments); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeRace?.id) return;
    fetch(`/api/races/${activeRace.id}/starters`)
      .then(res => res.json())
      .then(data => { if (data.horses) setActiveRace(prev => prev ? { ...prev, horses: data.horses } : prev); })
      .catch(() => {});
  }, [activeRace?.id]);

  const edgeBets = races.flatMap(r =>
    r.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5)
      .map(h => ({ ...h, raceNum: r.num, raceId: r.id, edge: h.modelProb - h.marketProb, ev: ((h.modelProb / 100) * (h.odds - 1)) - ((1 - h.modelProb / 100)) }))
  ).sort((a, b) => b.edge - a.edge);

  useEffect(() => {
    fetch('/api/value-bets')
      .then(res => res.json())
      .then(data => {
        if (data.bets) { setValueBets(data.bets); setVbCounts({guld: data.guldtipsCount || 0, bev: data.bevakningCount || 0}); }
      })
      .catch(() => {});
  }, []);

  const getEdgeColor = (edge: number) => edge >= 7 ? "var(--gold)" : edge >= 4 ? "var(--gold-dim)" : "#5C5C5C";

  // ── Loading Screen ──
  if (loading || !activeRace) {
    return (
      <div className="dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "14px", letterSpacing: "0.1em", color: "var(--gold)", marginBottom: "12px" }}>
            {loading ? '⟳ LADDAR LOPPDATA...' : 'INGA LOPP HITTADES'}
          </div>
          <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} className="skeleton" style={{
                width: "40px", height: "12px",
                animationDelay: `${i * 0.15}s`
              }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Main Dashboard ──
  return (
    <div className="dashboard">
      {/* ═══ TOPBAR ═══ */}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div className="logo">Trav Edge</div>
          
          {eventInfo.type && (
            <div className="eventBadge">
              <span className="eventType">{eventInfo.type}</span>
              <span style={{ color: '#8A8A9A', fontSize: '12px' }}>{eventInfo.track}</span>
              <span style={{ color: '#5C5C6C', fontSize: '11px' }}>·</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'capitalize' }}>{eventInfo.date}</span>
            </div>
          )}
          
          <div style={{ display: "flex", gap: "4px" }}>
            {(["lopp", "edge", "chef"] as const).map(v => (
              <button key={v} className={`navBtn ${view === v ? 'navBtnActive' : ''}`} onClick={() => setView(v)}>
                {v === "lopp" ? "Lopp-Matris" : v === "edge" ? "Edge-Signaler" : "Opus-Syntes"}
              </button>
            ))}
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {ingestMsg && (
            <span style={{
              fontSize: "10px", letterSpacing: "0.04em", maxWidth: "200px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: ingestStatus === 'success' ? '#4CAF50' : ingestStatus === 'error' ? 'var(--red)' : 'var(--gold)',
            }}>{ingestMsg}</span>
          )}
          {formattedTime && !ingestMsg && (
            <span style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.04em" }}>Synkad {formattedTime}</span>
          )}
          <button className="syncBtn" onClick={() => manualIngest(1)} disabled={ingestStatus === 'loading'}>
            {ingestStatus === 'loading' ? '⟳ Synkar...' : '↻ Synka'}
          </button>
          <button onClick={togglePolling} title={isPolling ? 'Auto-synk aktiv' : 'Auto-synk pausad'}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", padding: "4px" }}>
            {isPolling ? '🟢' : '⏸️'}
          </button>
        </div>
      </div>

      {/* ═══ LOPP VIEW ═══ */}
      {view === "lopp" && (
        <div className="raceLayout">
          {/* Sidebar */}
          <div className="sidebar">
            <div className="sidebarTitle">Lopp · {eventInfo.type || 'V86'}</div>
            {races.map(r => {
              const isActive = activeRace.id === r.id;
              const raceEdge = r.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5);
              const hasGold = r.horses.some(h => h.tier === 'GULDTIPS');
              
              return (
                <button key={r.id} className={`raceBtn ${isActive ? 'raceBtnActive' : ''}`}
                  onClick={() => setActiveRace(r)}>
                  <div className="raceBtnNum">
                    Lopp {r.num} {hasGold && '⭐'}
                  </div>
                  <div className="raceBtnTrack">{r.trackName} · {r.distance}</div>
                  <div className="raceBtnStarters">{r.starters} startande</div>
                  {raceEdge.length > 0 && (
                    <div><span className="signalBadge">{raceEdge.length} SIGNALER</span></div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Main race content */}
          <div className="mainContent">
            {/* Race header */}
            <div className="raceHeader">
              <div>
                <div className="raceTitle">Lopp {activeRace.num}</div>
                <div className="raceSubtitle">
                  {activeRace.distance} · Prissumma {activeRace.prize} · {activeRace.starters} startande
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "11px", color: "var(--text-ghost)", letterSpacing: "0.06em", marginBottom: "4px" }}>EDGE-SIGNALER</div>
                <div style={{ fontSize: "24px", color: "var(--gold)", fontWeight: 500 }}>
                  {activeRace.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5).length}
                </div>
              </div>
            </div>

            {/* Column headers */}
            <div className="horseGridHeader">
              <span></span><span></span>
              <span>Häst / Kusk</span>
              <span style={{ textAlign: "center" }}>KM-TID</span>
              <span style={{ textAlign: "center" }}>AI SCORE</span>
              <span style={{ textAlign: "center" }}>SIGNAL</span>
              <span style={{ textAlign: "center" }}>MODELL</span>
              <span style={{ textAlign: "right" }}>ODDS</span>
            </div>

            {/* Horse Rows */}
            {activeRace.horses.map((h, i) => (
              <div key={h.post} className="slideIn" style={{ animationDelay: `${i * 0.03}s` }}>
                <HorseRow horse={h} />
              </div>
            ))}

            {/* AI Summary */}
            {activeRace.summary && (
              <div className="summaryCard fadeIn">
                <div style={{
                  fontSize: "10px", color: "var(--text-ghost)",
                  letterSpacing: "0.1em", marginBottom: "10px",
                  textTransform: "uppercase"
                }}>Modell · Statistisk Loppanalys L{activeRace.num}</div>
                <div style={{
                  fontSize: "13px", color: "var(--text-muted)",
                  lineHeight: "1.7", fontFamily: "var(--font-mono)"
                }}>{activeRace.summary}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ EDGE VIEW ═══ */}
      {view === "edge" && (
        <div style={{ padding: "24px 28px", maxWidth: "900px" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", color: "var(--text-primary)", marginBottom: "6px" }}>
            Edge-Signaler
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-ghost)", marginBottom: "16px", letterSpacing: "0.04em" }}>
            AI-modellens identifierade undervärderade hästar
          </div>

          {/* Tier summary */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
            <div style={{ background: "var(--gold-bg)", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", padding: "10px 16px", flex: 1 }}>
              <div style={{ fontSize: "10px", color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Guldtips</div>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--gold)" }}>{vbCounts.guld}</div>
              <div style={{ fontSize: "9px", color: "#8A7A5A", marginTop: "2px" }}>Bevisad positiv ROI</div>
            </div>
            <div style={{ background: "rgba(90,90,120,0.08)", border: "1px solid rgba(90,90,120,0.3)", borderRadius: "4px", padding: "10px 16px", flex: 1 }}>
              <div style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Bevakning</div>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--text-muted)" }}>{vbCounts.bev}</div>
              <div style={{ fontSize: "9px", color: "var(--text-ghost)", marginTop: "2px" }}>Edge finns — för systemspel</div>
            </div>
          </div>

          {/* Edge bet headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "80px 30px 50px 1fr 80px 80px 70px 70px",
            gap: "0", padding: "6px 0", borderBottom: "1px solid var(--border)",
            fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase"
          }}>
            <span>SIGNAL</span><span>L.</span><span>SP.</span><span>Häst</span>
            <span style={{ textAlign: "center" }}>MODELL</span>
            <span style={{ textAlign: "center" }}>MARKNAD</span>
            <span style={{ textAlign: "center" }}>EDGE</span>
            <span style={{ textAlign: "right" }}>ODDS</span>
          </div>

          {(raceComments.length > 0 ? raceComments : valueBets).map((item: any, i: number) => {
            const vb = item;
            const isExpanded = expandedBet === i;
            const tier = vb.tier || null;
            const horseName = vb.horseName;
            const edgeVal = raceComments.length > 0 ? (vb.edge * 100).toFixed(1) : vb.edge;
            const oddsVal = raceComments.length > 0 ? vb.odds?.toFixed(2) : Number(vb.odds).toFixed(2);
            const modelPct = raceComments.length > 0 ? (vb.modelProb * 100).toFixed(1) : vb.modelProb;
            const marketPct = raceComments.length > 0 ? (vb.marketProb * 100).toFixed(1) : vb.marketProb;
            const tags = vb.tags || [];
            const comment = vb.comment || '';
            const signals = vb.signals || [];

            return (
              <div key={i} className="slideIn" style={{ animationDelay: `${i * 0.05}s` }}
                onClick={() => setExpandedBet(isExpanded ? null : i)}>
                <div className="horseRow" style={{
                  gridTemplateColumns: "80px 30px 50px 1fr 80px 80px 70px 70px",
                  borderLeft: tier === 'GULDTIPS' ? "2px solid var(--gold)" : "2px solid #3A3A46",
                  paddingLeft: "8px",
                  background: tier === 'GULDTIPS' ? "rgba(212,168,67,0.04)" : "transparent",
                  cursor: "pointer",
                }}>
                  <div>
                    <span style={{
                      fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em",
                      padding: "3px 8px", borderRadius: "2px",
                      ...(tier === 'GULDTIPS'
                        ? { background: "var(--gold-bg)", color: "var(--gold)", border: "1px solid rgba(212,168,67,0.3)" }
                        : tier === 'BEVAKNING'
                        ? { background: "rgba(90,90,120,0.1)", color: "var(--text-dim)", border: "1px solid rgba(90,90,120,0.2)" }
                        : { background: "rgba(60,60,80,0.08)", color: "#5A5A6A", border: "1px solid rgba(60,60,80,0.15)" }
                      )
                    }}>
                      {tier === 'GULDTIPS' ? 'GULD' : tier === 'BEVAKNING' ? 'BEV.' : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-ghost)" }}>{vb.raceNumber}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>sp. {vb.postPosition}</div>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: tier === 'GULDTIPS' ? "var(--text-primary)" : "var(--text-muted)" }}>{horseName}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-ghost)", marginTop: "2px" }}>{vb.driverName}</div>
                    {tags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "5px" }}>
                        {tags.slice(0, 4).map((tag: string, ti: number) => (
                          <span key={ti} style={{
                            fontSize: "9px", padding: "2px 6px", borderRadius: "8px",
                            background: tag.includes('TOPP') || tag.includes('storform') || tag.includes('Snabb')
                              ? "var(--green-bg)" : tag.includes('svag') || tag.includes('Bakspår')
                              ? "var(--red-bg)" : "rgba(120,120,140,0.10)",
                            color: tag.includes('TOPP') || tag.includes('storform') || tag.includes('Snabb')
                              ? "#66BB6A" : tag.includes('svag') || tag.includes('Bakspår')
                              ? "#EF5350" : "var(--text-muted)",
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: "13px", color: "var(--gold)", fontWeight: 500 }}>{modelPct}%</div>
                  <div style={{ textAlign: "center", fontSize: "13px", color: "var(--text-dim)" }}>{marketPct}%</div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: "12px", fontWeight: 500,
                      color: tier === 'GULDTIPS' ? "var(--gold)" : "var(--text-muted)",
                      background: tier === 'GULDTIPS' ? "var(--gold-bg)" : "rgba(90,90,120,0.08)",
                      padding: "2px 8px", borderRadius: "2px"
                    }}>+{edgeVal}%</span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>{oddsVal}</div>
                </div>

                {/* Expanded */}
                {isExpanded && comment && (
                  <div className="fadeIn" style={{
                    padding: "12px 16px", marginLeft: "10px",
                    borderLeft: tier === 'GULDTIPS' ? "2px solid var(--gold)" : "2px solid #3A3A46",
                    borderBottom: "1px solid var(--border-soft)",
                    background: "rgba(20,20,32,0.6)",
                  }}>
                    <div style={{ fontSize: "12px", color: "#B8B0A0", lineHeight: 1.6, marginBottom: "10px" }}>{comment}</div>
                    {signals.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {signals.map((s: any, si: number) => (
                          <div key={si} style={{
                            fontSize: "10px", padding: "4px 8px", borderRadius: "4px",
                            background: s.sentiment === 'positive' ? "var(--green-bg)" : s.sentiment === 'negative' ? "var(--red-bg)" : "rgba(100,100,120,0.08)",
                            color: s.sentiment === 'positive' ? "#81C784" : s.sentiment === 'negative' ? "var(--red)" : "var(--text-muted)",
                            border: `1px solid ${s.sentiment === 'positive' ? 'rgba(76,175,80,0.2)' : s.sentiment === 'negative' ? 'rgba(244,67,54,0.2)' : 'rgba(100,100,120,0.15)'}`,
                          }}>{s.emoji} {s.label}: {s.value}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {valueBets.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: "12px" }}>
              Inga edge-signaler hittades. Kör en datasynkning.
            </div>
          )}
        </div>
      )}

      {/* ═══ CHEF VIEW ═══ */}
      {view === "chef" && (
        <div style={{ padding: "24px 28px", maxWidth: "760px" }} className="fadeIn">
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", color: "var(--text-primary)", marginBottom: "4px" }}>
            Opus 4.6 · Kvantitativ Omgångssyntes
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-ghost)", marginBottom: "28px", letterSpacing: "0.04em" }}>
            LLM-driven sammanställning av LightGBM-matrisen
          </div>

          <div className="summaryCard">
            <div style={{ fontSize: "10px", color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
              Identificerade Primära Edge-Zoner
            </div>
            {edgeBets.slice(0, 3).map((h, i) => (
              <div key={i} className="slideIn" style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "10px 0", borderBottom: i < 2 ? "1px solid #1A1A24" : "none",
                animationDelay: `${i * 0.1}s`
              }}>
                <div style={{
                  width: "28px", height: "28px",
                  background: "var(--gold-bg)", border: "1px solid rgba(212,168,67,0.2)",
                  borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "10px", color: "var(--gold)", fontWeight: 500
                }}>L{h.raceNum}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{h.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-ghost)", marginTop: "2px" }}>
                    {h.driver} · sp. {h.post} · odds {h.odds.toFixed(2)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "13px", color: "var(--gold)", fontWeight: 500 }}>+{h.edge}% differens</div>
                  <div style={{ fontSize: "10px", color: "var(--text-ghost)", marginTop: "2px" }}>{h.modelProb}% vs {h.marketProb}%</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: "16px", background: "#0D1A12", border: "1px solid #1A2A1A",
            padding: "14px 18px", borderRadius: "4px",
            display: "flex", alignItems: "center", gap: "12px"
          }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4CAF50", flexShrink: 0 }} />
            <div style={{ fontSize: "11px", color: "#5C7A5C", lineHeight: "1.6" }}>
              Rapport baserad exklusivt på pre-race LightGBM-matris med 43 features. Analytisk validering krävs.
            </div>
          </div>
        </div>
      )}
      
      {/* Chat Bubble */}
      <RaceChat activeRace={activeRace} />
    </div>
  );
}
