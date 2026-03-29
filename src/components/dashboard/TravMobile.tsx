import { useState, useEffect } from "react";
import RaceChat from "./RaceChat";
import { useAutoIngest } from "@/hooks/useAutoIngest";

const AMBER = "#D4A843";
const AMBER_DIM = "rgba(212,168,67,0.12)";
const BG = "#0D0F14";
const BG2 = "#12141A";
const BG3 = "#181B22";
const BORDER = "#1E2028";
const TEXT = "#C4BCB0";
const TEXT2 = "#6B6B7A";
const TEXT3 = "#3A3A46";

export default function TravMobile() {
  const [tab, setTab] = useState("lopp");
  const [races, setRaces] = useState<any[]>([]);
  const [activeRace, setActiveRace] = useState<any | null>(null);
  const [expandedHorse, setExpandedHorse] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { status: ingestStatus, formattedTime, isPolling, manualIngest } = useAutoIngest();

  useEffect(() => {
    fetch('/api/races')
      .then(res => res.json())
      .then(data => {
        if (data.races && data.races.length > 0) {
          const enriched = data.races.map((r: any) => ({
            ...r,
            horses: r.horses.map((h: any) => ({
              ...h,
              modelProb: h.modelProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
              marketProb: h.marketProb || (h.odds > 1 ? Math.round((1 / h.odds) * 100) : 0),
              driverForm: typeof h.driverForm === 'string' ? parseFloat(h.driverForm) || 0 : (h.driverForm || 0),
              classChange: h.classChange || 0,
            })),
          }));
          setRaces(enriched);
          setActiveRace(enriched[0]);
        }
      })
      .catch(err => console.error('Failed to load races:', err))
      .finally(() => setLoading(false));
  }, []);

  const allEdgeBets = races.flatMap(r =>
    (r.horses || []).filter((h: any) => !h.scratch && (h.modelProb - h.marketProb) >= 5)
      .map((h: any) => ({ ...h, raceNum: r.num, raceId: r.id, edge: h.modelProb - h.marketProb }))
  ).sort((a: any, b: any) => b.edge - a.edge);

  const edgeCount = allEdgeBets.length;

  if (loading || !activeRace) {
    return (
      <div style={{
        background: BG, minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "'IBM Plex Mono', monospace", color: TEXT2
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "13px", letterSpacing: "0.1em", color: AMBER, marginBottom: "6px" }}>
            {loading ? '⟳ LADDAR...' : 'INGA LOPP'}
          </div>
          <div style={{ fontSize: "10px" }}>
            {loading ? 'Hämtar loppdata' : 'Synka data först'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: BG,
      minHeight: "100vh",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      color: TEXT,
      fontSize: "13px",
      maxWidth: "430px",
      margin: "0 auto",
      position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{display:none}
        .tap{cursor:pointer;transition:background 0.12s;-webkit-tap-highlight-color:transparent}
        .tap:active{background:rgba(255,255,255,0.04)!important}
        .hnav-btn{background:none;border:none;font-family:inherit;cursor:pointer;transition:all 0.15s}
        .hnav-btn:active{opacity:0.7}
      `}</style>

      {/* Status bar sim */}
      <div style={{
        height: "44px",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        position: "sticky",
        top: 0,
        zIndex: 100,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "17px",
          fontWeight: 600,
          color: AMBER,
          letterSpacing: "0.02em"
        }}>Trav Edge</div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {formattedTime && (
            <span style={{ fontSize: "8px", color: TEXT3, letterSpacing: "0.03em" }}>
              {formattedTime}
            </span>
          )}
          <button
            onClick={() => manualIngest(1)}
            disabled={ingestStatus === 'loading'}
            className="hnav-btn"
            style={{
              padding: "4px 10px",
              borderRadius: "3px",
              background: ingestStatus === 'loading' ? BG3 : AMBER_DIM,
              border: `1px solid ${ingestStatus === 'loading' ? BORDER : 'rgba(212,168,67,0.3)'}`,
              color: ingestStatus === 'loading' ? TEXT2 : AMBER,
              fontSize: "9px",
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {ingestStatus === 'loading' ? '⟳' : ingestStatus === 'success' ? '✓' : ingestStatus === 'error' ? '!' : '↻'}
          </button>
          <div style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: ingestStatus === 'loading' ? AMBER : ingestStatus === 'error' ? '#E57373' : isPolling ? "#4CAF50" : TEXT3,
            boxShadow: ingestStatus === 'loading' ? `0 0 5px ${AMBER}` : ingestStatus === 'error' ? '0 0 5px #E57373' : isPolling ? "0 0 5px #4CAF50" : 'none',
            transition: 'all 0.3s',
          }} />
        </div>
      </div>

      {/* LOPP VIEW */}
      {tab === "lopp" && (
        <div style={{ paddingBottom: "80px" }}>

          {/* Race horizontal scroller */}
          <div style={{
            overflowX: "auto",
            display: "flex",
            gap: "6px",
            padding: "10px 16px",
            borderBottom: `1px solid ${BORDER}`,
            scrollbarWidth: "none",
          }}>
            {races.map(r => {
              const hasEdge = r.horses.some((h: any) => !h.scratch && (h.modelProb - h.marketProb > 0.05));
              const isActive = activeRace.id === r.id;
              return (
                <button key={r.id} className="hnav-btn" onClick={() => { setActiveRace(r); setExpandedHorse(null); }} style={{
                  flexShrink: 0,
                  padding: "7px 14px",
                  borderRadius: "20px",
                  background: isActive ? AMBER : BG3,
                  border: isActive ? "none" : `1px solid ${hasEdge ? "rgba(212,168,67,0.3)" : BORDER}`,
                  color: isActive ? "#0D0F14" : hasEdge ? AMBER : TEXT2,
                  fontSize: "12px",
                  fontWeight: 500,
                  fontFamily: "'IBM Plex Mono', monospace",
                  letterSpacing: "0.04em",
                }}>
                  L{r.num}{hasEdge && !isActive ? " ·" : ""}
                </button>
              );
            })}
          </div>

          {/* Race info strip */}
          <div style={{
            padding: "12px 16px",
            background: BG2,
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: "15px", fontFamily: "'Playfair Display', serif", fontWeight: 600, color: "#E8DEC8" }}>
                Lopp {activeRace.num}
              </div>
              <div style={{ fontSize: "11px", color: TEXT2, marginTop: "2px", letterSpacing: "0.03em" }}>
                {activeRace.distance} · {activeRace.prize}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {activeRace.horses.filter((h: any) => !h.scratch && (h.modelProb - h.marketProb) >= 5).length > 0 ? (
                <div>
                  <div style={{ fontSize: "10px", color: TEXT3, letterSpacing: "0.06em", marginBottom: "2px" }}>EDGE</div>
                  <div style={{ fontSize: "20px", color: AMBER, fontWeight: 500, lineHeight: 1 }}>
                    {activeRace.horses.filter((h: any) => !h.scratch && (h.modelProb - h.marketProb) >= 5).length}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "11px", color: TEXT3 }}>Ingen edge</div>
              )}
            </div>
          </div>

          {/* Horse cards */}
          <div style={{ padding: "8px 0" }}>
            {activeRace.horses.map((h: any) => {
              const edge = h.modelProb - h.marketProb;
              const hasEdge = !h.scratch && edge >= 5;
              const isExpanded = expandedHorse === h.post;

              return (
                <div key={h.post}>
                  <div
                    className="tap"
                    onClick={() => !h.scratch && setExpandedHorse(isExpanded ? null : h.post)}
                    style={{
                      padding: "13px 16px",
                      borderBottom: `1px solid ${BORDER}`,
                      borderLeft: `3px solid ${hasEdge ? AMBER : "transparent"}`,
                      background: hasEdge ? "rgba(212,168,67,0.04)" : "transparent",
                      opacity: h.scratch ? 0.3 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {/* Post circle */}
                      <div style={{
                        width: "26px", height: "26px", borderRadius: "50%",
                        background: hasEdge ? AMBER_DIM : BG3,
                        border: `0.5px solid ${hasEdge ? "rgba(212,168,67,0.4)" : BORDER}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "11px", color: hasEdge ? AMBER : TEXT2,
                        fontWeight: 500, flexShrink: 0
                      }}>{h.post}</div>

                      {/* Name block */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: "14px", fontWeight: 500,
                          color: hasEdge ? "#E8DEC8" : TEXT,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          textDecoration: h.scratch ? "line-through" : "none"
                        }}>{h.name}</div>
                        <div style={{ fontSize: "11px", color: TEXT2, marginTop: "2px" }}>{h.driver}</div>
                      </div>

                      {/* Right side */}
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: "15px", fontWeight: 500, color: TEXT }}>{h.odds.toFixed(2)}</div>
                        {hasEdge ? (
                          <div style={{
                            fontSize: "10px", color: AMBER,
                            background: AMBER_DIM,
                            padding: "2px 6px", borderRadius: "3px",
                            marginTop: "3px", letterSpacing: "0.03em"
                          }}>+{edge}% edge</div>
                        ) : (
                          <div style={{ fontSize: "10px", color: TEXT3, marginTop: "3px" }}>
                            {h.modelProb}% vs {h.marketProb}%
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{
                        marginTop: "12px",
                        paddingTop: "12px",
                        borderTop: `1px solid ${BORDER}`,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 1fr",
                        gap: "8px",
                      }}>
                        {[
                          { lbl: "KM-TID", val: h.kmTime },
                          { lbl: "KUSK 30D", val: `${h.driverForm}%`, hot: h.driverForm >= 30 },
                          { lbl: "KLASS", val: h.classChange > 0 ? `+${h.classChange}` : h.classChange === 0 ? "—" : `${h.classChange}`, up: h.classChange > 0, down: h.classChange < 0 },
                          { lbl: "MODELL", val: `${h.modelProb}%`, amber: hasEdge },
                        ].map((s, i) => (
                          <div key={i} style={{
                            background: BG3,
                            borderRadius: "4px",
                            padding: "8px",
                            textAlign: "center",
                          }}>
                            <div style={{ fontSize: "9px", color: TEXT3, letterSpacing: "0.07em", marginBottom: "4px" }}>{s.lbl}</div>
                            <div style={{
                              fontSize: "13px", fontWeight: 500,
                              color: s.amber ? AMBER : s.hot ? "#D4A843" : s.up ? "#5B9E6A" : s.down ? "#9E5B5B" : TEXT
                            }}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* AI summary */}
          <div style={{
            margin: "12px 16px 0",
            padding: "14px 16px",
            background: BG2,
            border: `1px solid ${BORDER}`,
            borderRadius: "6px",
          }}>
            <div style={{
              fontSize: "9px", color: TEXT3,
              letterSpacing: "0.1em", textTransform: "uppercase",
              marginBottom: "8px"
            }}>Sonnet · Lopp {activeRace.num}</div>
            <div style={{
              fontSize: "13px", color: "#8A8A9A",
              lineHeight: "1.7"
            }}>{activeRace.summary}</div>
          </div>
          
          <div style={{ height: "40px" }} />
        </div>
      )}

      {/* EDGE VIEW */}
      {tab === "edge" && (
        <div style={{ paddingBottom: "80px" }}>
          <div style={{
            padding: "14px 16px 10px",
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: "17px", fontFamily: "'Playfair Display', serif", fontWeight: 600, color: "#E8DEC8" }}>
              Edge-bets
            </div>
            <div style={{ fontSize: "11px", color: TEXT2, marginTop: "2px" }}>
              {edgeCount} hästar · modell ≥5% över marknad
            </div>
          </div>

          {allEdgeBets.map((h, i) => (
            <div
              key={i}
              className="tap"
              onClick={() => { setActiveRace(races.find(r => r.id === h.raceId)!); setExpandedHorse(null); setTab("lopp"); }}
              style={{
                padding: "14px 16px",
                borderBottom: `1px solid ${BORDER}`,
                borderLeft: `3px solid ${h.edge >= 7 ? AMBER : "rgba(212,168,67,0.4)"}`,
                background: h.edge >= 7 ? "rgba(212,168,67,0.05)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "32px", height: "32px",
                  background: AMBER_DIM,
                  border: `1px solid rgba(212,168,67,0.25)`,
                  borderRadius: "4px",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <div style={{ fontSize: "9px", color: TEXT2, lineHeight: 1 }}>L{h.raceNum}</div>
                  <div style={{ fontSize: "10px", color: AMBER, fontWeight: 500, lineHeight: 1, marginTop: "2px" }}>sp.{h.post}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "14px", fontWeight: 500, color: "#E8DEC8",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>{h.name}</div>
                  <div style={{ fontSize: "11px", color: TEXT2, marginTop: "2px" }}>{h.driver}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{
                    fontSize: "16px", fontWeight: 500,
                    color: AMBER,
                    lineHeight: 1,
                  }}>+{h.edge}%</div>
                  <div style={{ fontSize: "11px", color: TEXT2, marginTop: "3px" }}>odds {h.odds.toFixed(2)}</div>
                </div>
              </div>
              <div style={{
                marginTop: "10px",
                display: "flex",
                gap: "6px",
                alignItems: "center",
              }}>
                <div style={{
                  flex: 1,
                  height: "3px",
                  background: BG3,
                  borderRadius: "2px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(h.modelProb * 3.5, 100)}%`,
                    background: AMBER,
                    borderRadius: "2px",
                  }} />
                </div>
                <div style={{ fontSize: "10px", color: TEXT2, whiteSpace: "nowrap" }}>
                  {h.modelProb}% vs {h.marketProb}% mkt
                </div>
              </div>
            </div>
          ))}
          
          <div style={{ height: "40px" }} />
        </div>
      )}

      {/* CHEF VIEW */}
      {tab === "chef" && (
        <div style={{ paddingBottom: "120px", padding: "16px 16px 80px" }}>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "17px", fontFamily: "'Playfair Display', serif", fontWeight: 600, color: "#E8DEC8", marginBottom: "3px" }}>
              Chef-AI
            </div>
            <div style={{ fontSize: "11px", color: TEXT2 }}>Opus 4.6 · Omgångssyntes V75</div>
          </div>

          {/* Top 3 signals */}
          <div style={{
            background: BG2,
            border: `1px solid ${BORDER}`,
            borderRadius: "6px",
            marginBottom: "14px",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 14px",
              borderBottom: `1px solid ${BORDER}`,
              fontSize: "9px",
              color: AMBER,
              letterSpacing: "0.1em",
              textTransform: "uppercase"
            }}>Omgångens starkaste signaler</div>
            {allEdgeBets.slice(0, 3).map((h, i) => (
              <div
                key={i}
                className="tap"
                onClick={() => { setActiveRace(races.find(r => r.id === h.raceId)!); setExpandedHorse(null); setTab("lopp"); }}
                style={{
                  padding: "12px 14px",
                  borderBottom: i < 2 ? `1px solid ${BORDER}` : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <div style={{
                  width: "36px", height: "36px",
                  background: AMBER_DIM,
                  border: `1px solid rgba(212,168,67,0.2)`,
                  borderRadius: "4px",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <div style={{ fontSize: "9px", color: TEXT2 }}>L{h.raceNum}</div>
                  <div style={{ fontSize: "13px", color: AMBER, fontWeight: 500, lineHeight: 1.2 }}>+{h.edge}%</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "13px", fontWeight: 500, color: "#E8DEC8",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>{h.name}</div>
                  <div style={{ fontSize: "11px", color: TEXT2, marginTop: "2px" }}>{h.driver} · sp.{h.post} · {h.odds.toFixed(2)}</div>
                </div>
                <div style={{ fontSize: "11px", color: TEXT2, flexShrink: 0 }}>→</div>
              </div>
            ))}
          </div>

          {/* Narrative */}
          <div style={{
            background: BG2,
            border: `1px solid ${BORDER}`,
            borderRadius: "6px",
            padding: "14px",
            marginBottom: "14px",
          }}>
            <div style={{
              fontSize: "9px", color: TEXT3,
              letterSpacing: "0.1em", textTransform: "uppercase",
              marginBottom: "10px"
            }}>Omgångsbedömning</div>
            <div style={{ fontSize: "13px", color: "#8A8A9A", lineHeight: "1.8" }}>
              Springfield Lady (L6) är omgångens starkaste signal — dubbel undervärdering, rekommenderas som banker. Zarina Brick (L1) och Titus Sisu (L2) kompletterar portföljen.
              <br /><br />
              Vivid Wise As (L4) är marknadens favorit men marginellt överspelad. Selektiv inställning i L4 och L5 rekommenderas.
              <br /><br />
              Statistiken stödjer ett halvt system på 4 rader: L1+L2+L4+L6. Värmnings- och skoinformation kan ändra bilden — verifiera Springfield Lady och Zarina Brick.
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{
            padding: "12px 14px",
            background: "#0A1A0D",
            border: `1px solid #1A2A1A`,
            borderRadius: "6px",
            display: "flex",
            gap: "10px",
            alignItems: "flex-start",
          }}>
            <div style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: "#4CAF50", marginTop: "4px", flexShrink: 0
            }} />
            <div style={{ fontSize: "11px", color: "#4A6B4A", lineHeight: "1.6" }}>
              Statistiska signaler från LightGBM-modellen. Inkluderar ej skobyte, värmning eller spärrnoteringar. Expertens bedömning avgörande.
            </div>
          </div>
          
          <div style={{ height: "40px" }} />
        </div>
      )}

      {/* Bottom nav */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: "430px",
        height: "68px",
        background: BG,
        borderTop: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        zIndex: 200,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {[
          { id: "lopp", label: "Lopp", icon: "◈" },
          { id: "edge", label: `Edge (${edgeCount})`, icon: "◆" },
          { id: "chef", label: "Chef-AI", icon: "◉" },
        ].map(t => (
          <button
            key={t.id}
            className="hnav-btn"
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              color: tab === t.id ? AMBER : TEXT3,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ fontSize: "16px", lineHeight: 1 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      
      <RaceChat activeRace={activeRace} />
    </div>
  );
}
