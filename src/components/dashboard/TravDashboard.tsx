"use client";
import { useState, useEffect } from "react";
import RaceChat from "./RaceChat";
import { useAutoIngest } from "@/hooks/useAutoIngest";

interface Horse {
  post: number; name: string; driver: string; trainer: string;
  kmTime: string; driverForm?: string; classChange?: number;
  modelProb: number; marketProb: number; odds: number;
  scratch: boolean; edge?: number; ev?: number;
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
  const { status: ingestStatus, message: ingestMsg, formattedTime, isPolling, manualIngest, togglePolling } = useAutoIngest();

  // Hämta lopp från databasen
  useEffect(() => {
    fetch('/api/races')
      .then(res => res.json())
      .then(data => {
        if (data.races && data.races.length > 0) {
          // Berika hästar med edge-beräkning
          const enriched = data.races.map((r: any) => ({
            ...r,
            horses: r.horses.map((h: any) => ({
              ...h,
              modelProb: h.modelProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
              marketProb: h.marketProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
              driverForm: h.driverForm || '—',
              classChange: h.classChange || 0,
            })),
          }));
          setRaces(enriched);
          setActiveRace(enriched[0]);
        }
      })
      .catch(err => console.error('Failed to load races:', err));

    // Fetch feature-based comments
    fetch('/api/race-comments')
      .then(res => res.json())
      .then(data => {
        if (data.comments) setRaceComments(data.comments);
      })
      .catch(err => console.error('Failed to load comments:', err))
      .finally(() => setLoading(false));
  }, []);

  // Hämta detaljerad data för aktivt lopp (features + edge)
  useEffect(() => {
    if (!activeRace?.id) return;
    fetch(`/api/races/${activeRace.id}/starters`)
      .then(res => res.json())
      .then(data => {
        if (data.horses) {
          setActiveRace(prev => prev ? { ...prev, horses: data.horses } : prev);
        }
      })
      .catch(err => console.error('Failed to load starters:', err));
  }, [activeRace?.id]);

  const edgeBets = races.flatMap(r =>
    r.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5)
      .map(h => ({ ...h, raceNum: r.num, raceId: r.id, edge: h.modelProb - h.marketProb, ev: ((h.modelProb / 100) * (h.odds - 1)) - ((1 - h.modelProb / 100)) }))
  ).sort((a, b) => b.edge - a.edge);

  // Fetch value bets with tiers from API
  useEffect(() => {
    fetch('/api/value-bets')
      .then(res => res.json())
      .then(data => {
        if (data.bets) {
          setValueBets(data.bets);
          setVbCounts({guld: data.guldtipsCount || 0, bev: data.bevakningCount || 0});
        }
      })
      .catch(() => {});
  }, []);

  const getEdgeColor = (edge: number) => {
    if (edge >= 7) return "#D4A843";
    if (edge >= 4) return "#9A7B2E";
    return "#5C5C5C";
  };

  const getEdgeBg = (edge: number) => {
    if (edge >= 7) return "rgba(212,168,67,0.12)";
    if (edge >= 4) return "rgba(154,123,46,0.08)";
    return "transparent";
  };

  if (loading || !activeRace) {
    return (
      <div style={{
        background: "#0F1117", minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "'IBM Plex Mono', monospace", color: "#4A4A5A"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "14px", letterSpacing: "0.1em", color: "#D4A843", marginBottom: "8px" }}>
            {loading ? '⟳ LADDAR LOPPDATA...' : 'INGA LOPP HITTADES'}
          </div>
          <div style={{ fontSize: "11px" }}>
            {loading ? 'Hämtar från databasen' : 'Kör en datahämtning via ↻ Synka'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "#0F1117",
      minHeight: "100vh",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      color: "#C8C0B0",
      fontSize: "13px",
      position: "relative"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600&display=swap');
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0F1117}
        ::-webkit-scrollbar-thumb{background:#2A2A35;border-radius:2px}
        .race-btn{background:none;border:none;cursor:pointer;transition:all 0.15s;font-family:inherit}
        .race-btn:hover{background:rgba(212,168,67,0.06)}
        .horse-row{transition:background 0.1s;cursor:default}
        .horse-row:hover{background:rgba(255,255,255,0.03)}
        .nav-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;transition:all 0.15s;padding:6px 16px;border-radius:2px}
        .nav-btn:hover{background:rgba(255,255,255,0.05)}
        .edge-row{transition:background 0.12s;cursor:pointer}
        .edge-row:hover{background:rgba(212,168,67,0.06)}
      `}</style>

      {/* Topbar */}
      <div style={{
        borderBottom: "1px solid #1E1E2A",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "52px",
        position: "sticky",
        top: 0,
        background: "#0F1117",
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "18px",
            fontWeight: 600,
            color: "#D4A843",
            letterSpacing: "0.02em"
          }}>
            Trav Edge
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {["lopp", "edge", "chef"].map(v => (
              <button key={v} className="nav-btn" onClick={() => setView(v)} style={{
                color: view === v ? "#D4A843" : "#6B6B7A",
                borderBottom: view === v ? "1px solid #D4A843" : "1px solid transparent",
                borderRadius: 0,
                fontSize: "11px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}>
                {v === "lopp" ? "Lopp-Matris" : v === "edge" ? "Edge-Signaler" : "Opus-Syntes"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {ingestMsg && (
            <span style={{
              fontSize: "10px",
              color: ingestStatus === 'success' ? '#4CAF50' : ingestStatus === 'error' ? '#E57373' : '#D4A843',
              letterSpacing: "0.04em",
              maxWidth: "200px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>{ingestMsg}</span>
          )}
          {formattedTime && !ingestMsg && (
            <span style={{ fontSize: "10px", color: "#4A4A5A", letterSpacing: "0.04em" }}>
              Synkad {formattedTime}
            </span>
          )}
          <button
            onClick={() => manualIngest(1)}
            disabled={ingestStatus === 'loading'}
            style={{
              background: ingestStatus === 'loading' ? '#1A1A24' : 'rgba(212,168,67,0.1)',
              border: '1px solid rgba(212,168,67,0.3)',
              color: ingestStatus === 'loading' ? '#6B6B7A' : '#D4A843',
              padding: '6px 14px',
              borderRadius: '3px',
              fontSize: '10px',
              fontFamily: "'IBM Plex Mono', monospace",
              cursor: ingestStatus === 'loading' ? 'wait' : 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            {ingestStatus === 'loading' ? '⟳ Synkar...' : '↻ Synka'}
          </button>
          <button
            onClick={togglePolling}
            title={isPolling ? 'Auto-synk aktiv (var 5 min)' : 'Auto-synk pausad'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '10px',
              color: isPolling ? '#4CAF50' : '#4A4A5A',
              fontFamily: "'IBM Plex Mono', monospace",
              padding: '4px',
              letterSpacing: '0.04em',
            }}
          >
            {isPolling ? 'AUTO' : 'MANU'}
          </button>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: ingestStatus === 'loading' ? '#D4A843' : ingestStatus === 'error' ? '#E57373' : "#4CAF50",
            boxShadow: ingestStatus === 'loading' ? '0 0 6px #D4A843' : ingestStatus === 'error' ? '0 0 6px #E57373' : "0 0 6px #4CAF50",
            transition: 'all 0.3s',
          }} />
        </div>
      </div>

      {view === "lopp" && (
        <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>

          {/* Race list sidebar */}
          <div style={{
            width: "200px",
            borderRight: "1px solid #1E1E2A",
            flexShrink: 0,
            overflowY: "auto",
            padding: "8px 0",
          }}>
            {races.map(r => {
              const raceEdge = r.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5);
              const isActive = activeRace.id === r.id;
              return (
                <button key={r.id} className="race-btn" onClick={() => setActiveRace(r)} style={{
                  width: "100%",
                  padding: "12px 16px",
                  textAlign: "left",
                  borderLeft: isActive ? "2px solid #D4A843" : "2px solid transparent",
                  background: isActive ? "rgba(212,168,67,0.06)" : "none",
                  color: isActive ? "#E8DEC8" : "#8A8A9A",
                }}>
                  <div style={{ fontSize: "11px", color: isActive ? "#D4A843" : "#5C5C6A", letterSpacing: "0.06em", marginBottom: "3px" }}>
                    LOPP {r.num}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 500 }}>{r.distance}</div>
                  <div style={{ fontSize: "11px", marginTop: "3px", color: "#5C5C6A" }}>
                    {r.starters} startande
                  </div>
                  {raceEdge.length > 0 && (
                    <div style={{ marginTop: "6px", display: "flex", gap: "4px" }}>
                      <span style={{
                        fontSize: "10px",
                        background: "rgba(212,168,67,0.15)",
                        color: "#D4A843",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: "0.04em"
                      }}>
                        {raceEdge.length} SIGNALER
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Main race view */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

            {/* Race header */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", marginBottom: "24px",
              paddingBottom: "16px", borderBottom: "1px solid #1E1E2A"
            }}>
              <div>
                <div style={{ fontSize: "22px", fontFamily: "'Playfair Display', serif", color: "#E8DEC8", fontWeight: 600 }}>
                  Lopp {activeRace.num}
                </div>
                <div style={{ marginTop: "4px", color: "#6B6B7A", fontSize: "12px", letterSpacing: "0.04em" }}>
                  {activeRace.distance} · Prissumma {activeRace.prize} · {activeRace.starters} startande
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "11px", color: "#5C5C6A", letterSpacing: "0.06em", marginBottom: "4px" }}>STATISTISKA EDGE-SIGNALER</div>
                <div style={{ fontSize: "24px", color: "#D4A843", fontWeight: 500 }}>
                  {activeRace.horses.filter(h => !h.scratch && (h.modelProb - h.marketProb) >= 5).length}
                </div>
              </div>
            </div>

            {/* Column headers */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "28px 28px 1fr 70px 70px 60px 70px 80px",
              gap: "0",
              padding: "6px 0",
              marginBottom: "4px",
              borderBottom: "1px solid #1E1E2A",
              fontSize: "10px",
              color: "#4A4A5A",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              <span></span><span></span>
              <span>Häst / Kusk</span>
              <span style={{ textAlign: "center" }}>KM-TID</span>
              <span style={{ textAlign: "center" }}>KUSK 30D</span>
              <span style={{ textAlign: "center" }}>KLASS</span>
              <span style={{ textAlign: "center" }}>MODELL</span>
              <span style={{ textAlign: "right" }}>ODDS</span>
            </div>

            {/* Horses */}
            {activeRace.horses.map(h => {
              const edge = h.modelProb - h.marketProb;
              const hasEdge = !h.scratch && edge >= 5;
              return (
                <div key={h.post} className="horse-row" style={{
                  display: "grid",
                  gridTemplateColumns: "28px 28px 1fr 70px 70px 60px 70px 80px",
                  gap: "0",
                  padding: "11px 0",
                  borderBottom: "1px solid #181820",
                  background: hasEdge ? getEdgeBg(edge) : "transparent",
                  borderLeft: hasEdge ? `2px solid ${getEdgeColor(edge)}` : "2px solid transparent",
                  paddingLeft: "0",
                  opacity: h.scratch ? 0.35 : 1,
                  alignItems: "center",
                }}>
                  {/* Post */}
                  <div style={{
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: "#1A1A24", border: "0.5px solid #2A2A35",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", color: "#6B6B7A", fontWeight: 500
                  }}>{h.post}</div>

                  {/* Edge dot */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {hasEdge && (
                      <div style={{
                        width: "6px", height: "6px", borderRadius: "50%",
                        background: getEdgeColor(edge),
                        boxShadow: edge >= 7 ? `0 0 6px ${getEdgeColor(edge)}` : "none"
                      }} />
                    )}
                  </div>

                  {/* Name */}
                  <div style={{ paddingRight: "12px" }}>
                    <div style={{
                      fontSize: "13px", fontWeight: 500,
                      color: hasEdge ? "#E8DEC8" : "#A0A0B0",
                      textDecoration: h.scratch ? "line-through" : "none"
                    }}>{h.name}</div>
                    <div style={{ fontSize: "11px", color: "#5C5C6A", marginTop: "2px" }}>
                      {h.driver} · {h.trainer}
                    </div>
                  </div>

                  {/* Km-tid */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "12px", color: "#9A9AAA", fontWeight: 500 }}>{h.kmTime}</div>
                  </div>

                  {/* Driver form */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{
                      fontSize: "12px", fontWeight: 500,
                      color: parseFloat(h.driverForm || '0') >= 30 ? "#D4A843" : "#6B6B7A"
                    }}>{h.driverForm || '—'}</div>
                  </div>

                  {/* Class change */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{
                      fontSize: "12px", fontWeight: 500,
                      color: (h.classChange || 0) > 0 ? "#5B9E6A" : (h.classChange || 0) < 0 ? "#9E5B5B" : "#5C5C6A"
                    }}>
                      {(h.classChange || 0) > 0 ? `+${h.classChange}` : (h.classChange || 0) === 0 ? "—" : h.classChange}
                    </div>
                  </div>

                  {/* Model prob */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "12px", fontWeight: 500, color: hasEdge ? "#D4A843" : "#6B6B7A" }}>
                      {h.modelProb}%
                    </div>
                    <div style={{ fontSize: "10px", color: "#4A4A5A", marginTop: "2px" }}>
                      mkt {h.marketProb}%
                    </div>
                  </div>

                  {/* Odds */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "#C8C0B0" }}>{h.odds.toFixed(2)}</div>
                    {hasEdge && (
                      <div style={{
                        fontSize: "10px", color: getEdgeColor(edge),
                        marginTop: "2px", letterSpacing: "0.04em"
                      }}>+{edge}% d-edge</div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* AI summary */}
            <div style={{
              marginTop: "24px",
              padding: "16px 18px",
              background: "#141420",
              border: "1px solid #1E1E2A",
              borderRadius: "4px",
            }}>
              <div style={{
                fontSize: "10px", color: "#5C5C6A",
                letterSpacing: "0.1em", marginBottom: "10px",
                textTransform: "uppercase"
              }}>Modell · Statistisk Loppanalys L{activeRace.num}</div>
              <div style={{
                fontSize: "13px", color: "#9A9AAA",
                lineHeight: "1.7", fontFamily: "'IBM Plex Mono', monospace"
              }}>
                {activeRace.summary}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "edge" && (
        <div style={{ padding: "24px 28px", maxWidth: "900px" }}>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "20px", color: "#E8DEC8",
            marginBottom: "6px"
          }}>Edge-Signaler</div>
          <div style={{ fontSize: "11px", color: "#5C5C6A", marginBottom: "16px", letterSpacing: "0.04em" }}>
            AI-modellens identifierade undervarderade hastar
          </div>

          {/* Tier summary badges */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
            <div style={{
              background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.3)",
              borderRadius: "4px", padding: "10px 16px", flex: 1,
            }}>
              <div style={{ fontSize: "10px", color: "#D4A843", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Guldtips</div>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "#D4A843" }}>{vbCounts.guld}</div>
              <div style={{ fontSize: "9px", color: "#8A7A5A", marginTop: "2px" }}>Bevisad positiv ROI</div>
            </div>
            <div style={{
              background: "rgba(90,90,120,0.08)", border: "1px solid rgba(90,90,120,0.3)",
              borderRadius: "4px", padding: "10px 16px", flex: 1,
            }}>
              <div style={{ fontSize: "10px", color: "#6B6B7A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>Bevakning</div>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "#8A8A9A" }}>{vbCounts.bev}</div>
              <div style={{ fontSize: "9px", color: "#5C5C6A", marginTop: "2px" }}>Edge finns - for systemspel</div>
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "80px 30px 50px 1fr 80px 80px 70px 70px",
            gap: "0",
            padding: "6px 0",
            borderBottom: "1px solid #1E1E2A",
            fontSize: "10px", color: "#4A4A5A",
            letterSpacing: "0.08em", textTransform: "uppercase"
          }}>
            <span>SIGNAL</span>
            <span>L.</span><span>SP.</span><span>Hast</span>
            <span style={{ textAlign: "center" }}>MODELL</span>
            <span style={{ textAlign: "center" }}>MARKNAD</span>
            <span style={{ textAlign: "center" }}>EDGE</span>
            <span style={{ textAlign: "right" }}>ODDS</span>
          </div>

          {(raceComments.length > 0 ? raceComments : valueBets).map((item: any, i: number) => {
            const vb = raceComments.length > 0 ? item : item;
            const isExpanded = expandedBet === i;
            const tier = vb.tier || null;
            const horseName = vb.horseName || vb.horseName;
            const edgeVal = raceComments.length > 0 ? (vb.edge * 100).toFixed(1) : vb.edge;
            const oddsVal = raceComments.length > 0 ? vb.odds?.toFixed(2) : Number(vb.odds).toFixed(2);
            const modelPct = raceComments.length > 0 ? (vb.modelProb * 100).toFixed(1) : vb.modelProb;
            const marketPct = raceComments.length > 0 ? (vb.marketProb * 100).toFixed(1) : vb.marketProb;
            const tags = vb.tags || [];
            const comment = vb.comment || '';
            const signals = vb.signals || [];

            return (
              <div key={i} onClick={() => setExpandedBet(isExpanded ? null : i)} style={{ cursor: 'pointer' }}>
                {/* Main row */}
                <div className="edge-row" style={{
                  display: "grid",
                  gridTemplateColumns: "80px 30px 50px 1fr 80px 80px 70px 70px",
                  gap: "0",
                  padding: "13px 0",
                  borderBottom: isExpanded ? "none" : "1px solid #181820",
                  borderLeft: tier === 'GULDTIPS' ? "2px solid #D4A843" : "2px solid #3A3A46",
                  paddingLeft: "8px",
                  background: tier === 'GULDTIPS' ? "rgba(212,168,67,0.04)" : "transparent",
                }}>
                  {/* Tier badge */}
                  <div>
                    <span style={{
                      fontSize: "9px", fontWeight: 600,
                      letterSpacing: "0.06em",
                      padding: "3px 8px", borderRadius: "2px",
                      ...(tier === 'GULDTIPS' 
                        ? { background: "rgba(212,168,67,0.15)", color: "#D4A843", border: "1px solid rgba(212,168,67,0.3)" }
                        : tier === 'BEVAKNING'
                        ? { background: "rgba(90,90,120,0.1)", color: "#6B6B7A", border: "1px solid rgba(90,90,120,0.2)" }
                        : { background: "rgba(60,60,80,0.08)", color: "#5A5A6A", border: "1px solid rgba(60,60,80,0.15)" }
                      )
                    }}>
                      {tier === 'GULDTIPS' ? 'GULD' : tier === 'BEVAKNING' ? 'BEV.' : '—'}
                    </span>
                  </div>

                  <div style={{ fontSize: "12px", color: "#5C5C6A" }}>{vb.raceNumber}</div>
                  <div style={{ fontSize: "12px", color: "#6B6B7A" }}>sp. {vb.postPosition}</div>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: tier === 'GULDTIPS' ? "#E8DEC8" : "#9A9AAA" }}>{horseName}</div>
                    <div style={{ fontSize: "11px", color: "#5C5C6A", marginTop: "2px" }}>{vb.driverName}</div>
                    {/* Tags */}
                    {tags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "5px" }}>
                        {tags.slice(0, 4).map((tag: string, ti: number) => (
                          <span key={ti} style={{
                            fontSize: "9px", padding: "2px 6px", borderRadius: "8px",
                            background: tag.includes('TOPP') || tag.includes('storform') || tag.includes('Snabb')
                              ? "rgba(76,175,80,0.12)" 
                              : tag.includes('svag') || tag.includes('Bakspår') || tag.includes('Överspelad') || tag.includes('Utan vinst')
                              ? "rgba(244,67,54,0.10)"
                              : "rgba(120,120,140,0.10)",
                            color: tag.includes('TOPP') || tag.includes('storform') || tag.includes('Snabb')
                              ? "#66BB6A" 
                              : tag.includes('svag') || tag.includes('Bakspår') || tag.includes('Överspelad') || tag.includes('Utan vinst')
                              ? "#EF5350"
                              : "#8A8A9A",
                            letterSpacing: "0.02em"
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: "13px", color: "#D4A843", fontWeight: 500 }}>{modelPct}%</div>
                  <div style={{ textAlign: "center", fontSize: "13px", color: "#6B6B7A" }}>{marketPct}%</div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: "12px", fontWeight: 500,
                      color: tier === 'GULDTIPS' ? "#D4A843" : "#8A8A9A",
                      background: tier === 'GULDTIPS' ? "rgba(212,168,67,0.12)" : "rgba(90,90,120,0.08)",
                      padding: "2px 8px", borderRadius: "2px"
                    }}>+{edgeVal}%</span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "13px", color: "#C8C0B0", fontWeight: 500 }}>{oddsVal}</div>
                </div>

                {/* Expanded comment card */}
                {isExpanded && comment && (
                  <div style={{
                    padding: "12px 16px",
                    marginLeft: "10px",
                    borderLeft: tier === 'GULDTIPS' ? "2px solid #D4A843" : "2px solid #3A3A46",
                    borderBottom: "1px solid #181820",
                    background: "rgba(20,20,32,0.6)",
                  }}>
                    <div style={{ fontSize: "12px", color: "#B8B0A0", lineHeight: 1.6, marginBottom: "10px" }}>
                      {comment}
                    </div>
                    {/* Signal details */}
                    {signals.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {signals.map((s: any, si: number) => (
                          <div key={si} style={{
                            fontSize: "10px", padding: "4px 8px", borderRadius: "4px",
                            background: s.sentiment === 'positive' ? "rgba(76,175,80,0.08)" : s.sentiment === 'negative' ? "rgba(244,67,54,0.08)" : "rgba(100,100,120,0.08)",
                            color: s.sentiment === 'positive' ? "#81C784" : s.sentiment === 'negative' ? "#E57373" : "#9A9AAA",
                            border: `1px solid ${s.sentiment === 'positive' ? 'rgba(76,175,80,0.2)' : s.sentiment === 'negative' ? 'rgba(244,67,54,0.2)' : 'rgba(100,100,120,0.15)'}`,
                          }}>
                            {s.emoji} {s.label}: {s.value}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {valueBets.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#4A4A5A", fontSize: "12px" }}>
              Inga edge-signaler hittades. Kor en datasynkning.
            </div>
          )}
        </div>
      )}

      {view === "chef" && (
        <div style={{ padding: "24px 28px", maxWidth: "760px" }}>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "20px", color: "#E8DEC8", marginBottom: "4px"
          }}>Opus 4.6 · Kvantitativ Omgångssyntes</div>
          <div style={{ fontSize: "11px", color: "#5C5C6A", marginBottom: "28px", letterSpacing: "0.04em" }}>
            LLM-driven sammanställning av LightGBM-matrisen
          </div>

          <div style={{
            background: "#141420", border: "1px solid #1E1E2A",
            padding: "20px 22px", borderRadius: "4px", marginBottom: "20px"
          }}>
            <div style={{ fontSize: "10px", color: "#D4A843", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
              Identificerade Primära Edge-Zoner
            </div>
            {edgeBets.slice(0, 3).map((h, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "10px 0",
                borderBottom: i < 2 ? "1px solid #1A1A24" : "none"
              }}>
                <div style={{
                  width: "28px", height: "28px",
                  background: "rgba(212,168,67,0.1)",
                  border: "1px solid rgba(212,168,67,0.2)",
                  borderRadius: "2px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "10px", color: "#D4A843", fontWeight: 500
                }}>L{h.raceNum}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: "#E8DEC8" }}>{h.name}</div>
                  <div style={{ fontSize: "11px", color: "#5C5C6A", marginTop: "2px" }}>{h.driver} · sp. {h.post} · odds {h.odds.toFixed(2)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "13px", color: "#D4A843", fontWeight: 500 }}>+{h.edge}% differens</div>
                  <div style={{ fontSize: "10px", color: "#5C5C6A", marginTop: "2px" }}>{h.modelProb}% vs {h.marketProb}%</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: "#141420", border: "1px solid #1E1E2A",
            padding: "20px 22px", borderRadius: "4px", marginBottom: "20px"
          }}>
            <div style={{ fontSize: "10px", color: "#5C5C6A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "14px" }}>
              Analysesammanfattning
            </div>
            <div style={{ fontSize: "13px", color: "#9A9AAA", lineHeight: "1.8" }}>
              Denna omgång präglas av hög volatilitet där tre statistiskt motiverade edge-kandidater framträder. Springfield Lady (L6) projiceras som omgångens mest potenta felskattning. Zarina Brick (L1) och Titus Sisu (L2) uppvisar fundamentalt starka indikatorer baserat på positiv klassdynamik och kusk-ROIs.
              <br /><br />
              Den kollektiva marknaden övervärderar systematiskt spelfavoriter som Vivid Wise As (L4, -7% edge) och det finns statistiska hålrum att blanka dessa om experterna identifierar negativa externa varningstecken. 
              <br /><br />
              Innan taktiska beslut formaliseras i de identifierade värdezonerna L1, L2, och L6 måste analytiker verifiera hästarnas balans, utrustning och värmningsintryck via bankanalen.
            </div>
          </div>

          <div style={{
            background: "#0D1A12", border: "1px solid #1A2A1A",
            padding: "14px 18px", borderRadius: "4px",
            display: "flex", alignItems: "center", gap: "12px"
          }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4CAF50", flexShrink: 0 }} />
            <div style={{ fontSize: "11px", color: "#5C7A5C", lineHeight: "1.6" }}>
              Rapport baserad exklusivt på pre-race LightGBM-matris. Utan realtidsinformation som skobytesfrekvens, värmningsparametrar eller spärrnoteringar. Analytisk validering krävs.
            </div>
          </div>
        </div>
      )}
      
      {/* Race Chat Bubble */}
      <RaceChat activeRace={activeRace} />
    </div>
  );
}
