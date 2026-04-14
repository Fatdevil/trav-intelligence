"use client";
import { useState } from "react";
import "./dashboard.css";

interface HorseRowProps {
  horse: {
    post: number;
    name: string;
    driver: string;
    trainer: string;
    kmTime: string;
    odds: number;
    modelProb: number;
    marketProb: number;
    scratch: boolean;
    aiScore?: number | null;
    tier?: string | null;
    edge?: number;
    starterId?: string;
  };
  onExpand?: (expanded: boolean) => void;
}

export default function HorseRow({ horse: h, onExpand }: HorseRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const edge = (h.modelProb || 0) - (h.marketProb || 0);
  const hasEdge = !h.scratch && edge >= 5;
  const isGold = h.tier === 'GULDTIPS';
  const isBev = h.tier === 'BEVAKNING';

  const handleClick = () => {
    const next = !expanded;
    setExpanded(next);
    onExpand?.(next);
    
    // Lazy-load history for form curves
    if (next && !history && h.starterId) {
      setLoadingHistory(true);
      const parts = h.starterId.split('_');
      const horseId = parts[parts.length - 1]; // horse_id is LAST segment: 2025-12-20_18_5_775220 → 775220
      fetch(`/api/horses/${horseId}/history`)
        .then(r => r.json())
        .then(data => {
          setHistory(data.history || []);
        })
        .catch(() => setHistory([]))
        .finally(() => setLoadingHistory(false));
    }
  };

  const scoreClass = (h.aiScore || 0) >= 80 ? 'aiScoreHigh' 
    : (h.aiScore || 0) >= 60 ? 'aiScoreMed' : 'aiScoreLow';

  const rowClass = `horseRow ${isGold ? 'horseRowGold' : hasEdge ? 'horseRowEdge' : ''}`;

  return (
    <div>
      <div className={rowClass} onClick={handleClick} style={{
        opacity: h.scratch ? 0.35 : 1,
      }}>
        {/* Post */}
        <div className="postCircle">{h.post}</div>

        {/* Edge dot */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          {(hasEdge || isGold || isBev) && (
            <div className="edgeDot" style={{
              background: isGold ? 'var(--gold)' : hasEdge ? 'var(--gold-dim)' : '#5C5C5C',
              boxShadow: isGold ? '0 0 6px var(--gold)' : 'none',
            }} />
          )}
        </div>

        {/* Name with Dotted Connector */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: "12px" }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{
              fontSize: "13px", fontWeight: 500,
              color: isGold ? "var(--text-primary)" : hasEdge ? "var(--text-primary)" : "var(--text-muted)",
              textDecoration: h.scratch ? "line-through" : "none"
            }}>{h.name}</div>
            <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>
              {h.driver} · {h.trainer}
            </div>
          </div>
          <div className="widescreen-connector" style={{ 
            flexGrow: 1, 
            borderBottom: '1px dotted rgba(255,255,255,0.1)', 
            margin: '0 12px 0 16px', 
            opacity: 0.7 
          }}></div>
        </div>

        {/* Km-tid */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>{h.kmTime}</div>
        </div>

        {/* AI Score */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          {h.aiScore ? (
            <div className={`aiScore ${scoreClass}`}>{h.aiScore}</div>
          ) : (
            <div style={{ fontSize: "11px", color: "var(--text-ghost)" }}>—</div>
          )}
        </div>

        {/* Tier */}
        <div style={{ textAlign: "center" }}>
          {isGold ? (
            <span className="tierGold">GULDTIPS</span>
          ) : isBev ? (
            <span className="tierBev">BEVAKNING</span>
          ) : (
            <span style={{ fontSize: "11px", color: "var(--text-ghost)" }}>—</span>
          )}
        </div>

        {/* Model prob */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 500, color: hasEdge || isGold ? "var(--gold)" : "var(--text-dim)" }}>
            {h.modelProb}%
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-ghost)", marginTop: "2px" }}>
            mkt {h.marketProb}%
          </div>
        </div>

        {/* Odds */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)" }}>
            {typeof h.odds === 'number' ? h.odds.toFixed(2) : h.odds}
          </div>
          {(hasEdge || isGold) && (
            <div style={{
              fontSize: "10px", color: isGold ? "var(--gold)" : "var(--gold-dim)",
              marginTop: "2px", letterSpacing: "0.04em"
            }}>+{edge.toFixed(1)}% edge</div>
          )}
        </div>
      </div>

      {/* Expandable detail */}
      <div className={`horseDetail ${expanded ? 'horseDetailOpen' : ''}`}>
        {expanded && (
          <div className="fadeIn">
            <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
              {/* Stats column */}
              <div style={{ flex: "0 0 200px" }}>
                <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
                  STATISTIK
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: "var(--text-ghost)" }}>AI Score</div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: isGold ? "var(--gold)" : "var(--text-secondary)" }}>
                      {h.aiScore || '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "var(--text-ghost)" }}>Edge</div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: edge > 0 ? "var(--green)" : "var(--red)" }}>
                      {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Form curve placeholder */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
                  FORMKURVA — Senaste 10 starter
                </div>
                {loadingHistory ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    {Array(10).fill(0).map((_, i) => (
                      <div key={i} className="skeleton" style={{ width: "28px", height: "40px" }} />
                    ))}
                  </div>
                ) : history && history.length > 0 ? (
                  <div style={{ display: "flex", gap: "3px", alignItems: "flex-end", height: "60px" }}>
                    {history.slice(-10).map((h: any, i: number) => {
                      const pos = h.position || 10;
                      const height = Math.max(8, ((10 - Math.min(pos, 10)) / 10) * 55);
                      const isWin = pos === 1;
                      const isTop3 = pos <= 3;
                      return (
                        <div key={i} title={`${h.date}: ${pos}:e plats, ${h.track}`}
                          style={{
                            width: "24px",
                            height: `${height}px`,
                            borderRadius: "2px 2px 0 0",
                            background: isWin ? "var(--gold)" : isTop3 ? "var(--gold-bg)" : "rgba(90,90,120,0.2)",
                            border: isWin ? "1px solid var(--gold)" : isTop3 ? "1px solid rgba(212,168,67,0.3)" : "1px solid rgba(90,90,120,0.15)",
                            display: "flex", alignItems: "flex-end", justifyContent: "center",
                            fontSize: "9px", fontWeight: 600, paddingBottom: "2px",
                            color: isWin ? "#0D0D12" : isTop3 ? "var(--gold)" : "var(--text-dim)",
                            transition: "height 0.3s ease",
                          }}>
                          {pos}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--text-ghost)" }}>Ingen historik tillgänglig</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
