"use client";
import { useState } from "react";
import "./dashboard.css";

interface RowHorse {
  post: number;
  name: string;
  driver: string;
  modelProb: number;
  odds: number;
  edge: number;
}

interface RaceSelection {
  raceNumber: number;
  track: string;
  type: 'SPIK' | 'HALVGARD' | 'GARDERING';
  coverage: number;
  horses: RowHorse[];
}

interface RowResult {
  selections: RaceSelection[];
  totalRows: number;
  cost: number;
  totalProbability: number;
  budget: number;
  risk: string;
  gameType: string;
  raceCount: number;
  spiks: number;
  garderat: number;
}

export default function RowGenerator() {
  const [budget, setBudget] = useState(500);
  const [risk, setRisk] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [result, setResult] = useState<RowResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget, risk, unitCost: 2 }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.rows);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const riskLabels = {
    conservative: { label: 'Försiktig', emoji: '🔒', desc: 'Fler spikar, billigare' },
    balanced: { label: 'Balanserad', emoji: '⚖️', desc: 'Standard mix' },
    aggressive: { label: 'Offensiv', emoji: '🔥', desc: 'Bred gardering' },
  };

  const typeIcon = (type: string) => {
    if (type === 'SPIK') return '⭐';
    if (type === 'HALVGARD') return '🔒';
    return '🔓';
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: "900px" }} className="fadeIn">
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", color: "var(--text-primary)", marginBottom: "4px" }}>
        AI Radgenerator
      </div>
      <div style={{ fontSize: "11px", color: "var(--text-ghost)", marginBottom: "24px", letterSpacing: "0.04em" }}>
        Budgetoptimerad radsammansättning baserad på modellens sannolikheter
      </div>

      {/* Controls */}
      <div style={{ 
        background: "var(--bg-card)", border: "1px solid var(--border)", 
        borderRadius: "6px", padding: "20px", marginBottom: "24px" 
      }}>
        {/* Budget slider */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Budget</span>
            <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--gold)" }}>{budget} kr</span>
          </div>
          <input
            type="range" min="50" max="2000" step="50" value={budget}
            onChange={e => setBudget(Number(e.target.value))}
            style={{
              width: "100%", height: "4px", appearance: "none", background: "var(--border)",
              borderRadius: "2px", outline: "none", cursor: "pointer",
              accentColor: "#D4A843",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-ghost)" }}>50 kr</span>
            <span style={{ fontSize: "9px", color: "var(--text-ghost)" }}>2 000 kr</span>
          </div>
        </div>

        {/* Risk profile */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
            Riskprofil
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {(Object.entries(riskLabels) as [string, any][]).map(([key, val]) => (
              <button key={key} onClick={() => setRisk(key as any)}
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: "4px",
                  background: risk === key ? "var(--gold-bg)" : "rgba(30,30,40,0.5)",
                  border: risk === key ? "1px solid rgba(212,168,67,0.4)" : "1px solid var(--border)",
                  color: risk === key ? "var(--gold)" : "var(--text-dim)",
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                  transition: "all var(--transition-fast)",
                  textAlign: "center",
                }}>
                <div style={{ fontSize: "16px", marginBottom: "4px" }}>{val.emoji}</div>
                <div style={{ fontSize: "11px", fontWeight: 600 }}>{val.label}</div>
                <div style={{ fontSize: "9px", color: "var(--text-ghost)", marginTop: "2px" }}>{val.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button onClick={generate} disabled={loading}
          style={{
            width: "100%", padding: "12px", borderRadius: "4px",
            background: loading ? "#1A1A24" : "linear-gradient(135deg, #D4A843, #B8922E)",
            border: "none", color: loading ? "var(--text-dim)" : "#0D0D12",
            fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: loading ? "wait" : "pointer",
            fontFamily: "var(--font-mono)",
            transition: "all var(--transition-fast)",
          }}>
          {loading ? '⟳ GENERERAR RAD...' : '🎯 GENERERA OPTIMERAD RAD'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", background: "var(--red-bg)", border: "1px solid rgba(244,67,54,0.3)", borderRadius: "4px", marginBottom: "16px" }}>
          <span style={{ fontSize: "12px", color: "var(--red)" }}>⚠️ {error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="fadeIn">
          {/* Summary card */}
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "6px", padding: "16px 20px", marginBottom: "16px",
            display: "flex", gap: "16px", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Speltyp</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--gold)", marginTop: "4px" }}>{result.gameType}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Rader</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginTop: "4px" }}>{result.totalRows}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Kostnad</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginTop: "4px" }}>{result.cost} kr</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Spikar</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--green)", marginTop: "4px" }}>{result.spiks}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", color: "var(--text-ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Garderat</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--gold)", marginTop: "4px" }}>{result.garderat}</div>
            </div>
          </div>

          {/* Per-race selections */}
          {result.selections.map((race, i) => (
            <div key={race.raceNumber} className="slideIn" style={{
              animationDelay: `${i * 0.06}s`,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "4px", padding: "12px 16px", marginBottom: "8px",
              borderLeft: race.type === 'SPIK' ? "3px solid var(--green)" : race.type === 'HALVGARD' ? "3px solid var(--gold)" : "3px solid var(--text-ghost)",
            }}>
              {/* Race header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px" }}>{typeIcon(race.type)}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Lopp {race.raceNumber}</span>
                  <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>({race.track})</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: "8px",
                    background: race.type === 'SPIK' ? "var(--green-bg)" : race.type === 'HALVGARD' ? "var(--gold-bg)" : "rgba(90,90,120,0.1)",
                    color: race.type === 'SPIK' ? "var(--green)" : race.type === 'HALVGARD' ? "var(--gold)" : "var(--text-dim)",
                    border: race.type === 'SPIK' ? "1px solid rgba(61,220,132,0.3)" : race.type === 'HALVGARD' ? "1px solid rgba(212,168,67,0.3)" : "1px solid rgba(90,90,120,0.2)",
                  }}>{race.type}</span>
                  <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Täckning: <strong style={{ color: race.coverage > 50 ? "var(--green)" : "var(--text-muted)" }}>{race.coverage}%</strong></span>
                </div>
              </div>

              {/* Horses in this race */}
              {race.horses.map(h => (
                <div key={h.post} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "5px 0",
                  borderTop: "1px solid rgba(30,30,42,0.5)",
                }}>
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "50%",
                    background: h.edge > 0 ? "var(--gold-bg)" : "#1A1A24",
                    border: h.edge > 0 ? "1px solid rgba(212,168,67,0.3)" : "1px solid #2A2A35",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", color: h.edge > 0 ? "var(--gold)" : "var(--text-dim)", fontWeight: 600,
                  }}>{h.post}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: "12px", fontWeight: 500, color: h.edge > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {h.name}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-ghost)", marginLeft: "8px" }}>{h.driver}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--gold)", fontWeight: 500 }}>{h.modelProb}%</div>
                  <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>odds {typeof h.odds === 'number' ? h.odds.toFixed(1) : h.odds}</div>
                  {h.edge > 0 && (
                    <span style={{
                      fontSize: "9px", fontWeight: 600, padding: "2px 6px", borderRadius: "6px",
                      background: "var(--green-bg)", color: "var(--green)", border: "1px solid rgba(61,220,132,0.2)"
                    }}>+{h.edge}%</span>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Copy to ATG format */}
          <div style={{
            marginTop: "16px", padding: "14px 18px",
            background: "rgba(13,26,18,0.5)", border: "1px solid #1A2A1A",
            borderRadius: "4px",
          }}>
            <div style={{ fontSize: "10px", color: "var(--green)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
              ATG-format (kopiera)
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.8 }}>
              {result.selections.map(r =>
                `L${r.raceNumber}: ${r.horses.map(h => h.post).join(', ')}`
              ).join('\n')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
