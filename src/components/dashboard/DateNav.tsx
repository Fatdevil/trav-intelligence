"use client";
import { useState, useEffect, useRef } from "react";
import "./dashboard.css";

interface RaceDate {
  date: string;
  games: { type: string; races: number; starters: number }[];
}

interface DateNavProps {
  selectedDate: string | null;
  onDateChange: (date: string) => void;
}

export default function DateNav({ selectedDate, onDateChange }: DateNavProps) {
  const [dates, setDates] = useState<RaceDate[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/race-dates')
      .then(r => r.json())
      .then(data => { if (data.dates) setDates(data.dates); })
      .catch(() => {});
  }, []);

  // Stäng dropdown vid klick utanför
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (dates.length === 0) return null;

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  };

  const isToday = (dateStr: string) => dateStr === new Date().toISOString().split('T')[0];
  const isTomorrow = (dateStr: string) => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    return dateStr === t.toISOString().split('T')[0];
  };
  const isPast = (dateStr: string) => dateStr < new Date().toISOString().split('T')[0];

  // Hitta aktiv dag för visning i knappen
  const activeDate = dates.find(d => d.date === selectedDate) || dates.find(d => !isPast(d.date)) || dates[0];
  const activeLabel = isToday(activeDate.date) ? 'Idag' : isTomorrow(activeDate.date) ? 'Imorgon' : formatDay(activeDate.date);
  const activeGame = activeDate.games.map(g => g.type).join(' / ');

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Compact button */}
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: "6px",
        background: open ? "var(--gold-bg)" : "rgba(30,30,42,0.5)",
        border: open ? "1px solid rgba(212,168,67,0.3)" : "1px solid var(--border)",
        borderRadius: "4px", padding: "5px 10px",
        cursor: "pointer", fontFamily: "var(--font-mono)",
        transition: "all 0.15s ease",
      }}>
        <span style={{ fontSize: "14px" }}>📅</span>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--gold)", letterSpacing: "0.04em" }}>
            {activeLabel}
          </div>
          <div style={{ fontSize: "9px", color: "var(--text-ghost)" }}>{activeGame}</div>
        </div>
        <span style={{ fontSize: "8px", color: "var(--text-ghost)", marginLeft: "2px" }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="fadeIn" style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "#141420", border: "1px solid var(--border)",
          borderRadius: "6px", padding: "8px", minWidth: "220px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 200,
        }}>
          <div style={{ fontSize: "9px", color: "var(--text-ghost)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px 8px", borderBottom: "1px solid var(--border)", marginBottom: "4px" }}>
            TILLGÄNGLIGA LOPPDAGAR
          </div>
          
          {dates.map(d => {
            const isActive = d.date === (selectedDate || activeDate.date);
            const past = isPast(d.date);
            const today = isToday(d.date);
            const tomorrow = isTomorrow(d.date);
            const label = today ? 'Idag' : tomorrow ? 'Imorgon' : formatDay(d.date);
            const gameTypes = d.games.map(g => g.type).join(' / ');
            const totalRaces = d.games.reduce((s, g) => s + g.races, 0);

            return (
              <button key={d.date} onClick={() => { onDateChange(d.date); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", width: "100%",
                  padding: "8px 8px", borderRadius: "4px",
                  background: isActive ? "var(--gold-bg)" : "transparent",
                  border: isActive ? "1px solid rgba(212,168,67,0.2)" : "1px solid transparent",
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                  transition: "all 0.1s ease", marginBottom: "2px",
                  opacity: past && !today ? 0.5 : 1,
                }}>
                {/* Sync status dot */}
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                  background: past ? "#5C5C6C" : today ? "var(--green)" : tomorrow ? "var(--gold)" : "#3A3A46",
                  boxShadow: today ? "0 0 4px var(--green)" : tomorrow ? "0 0 4px var(--gold)" : "none",
                }} />
                
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{
                    fontSize: "11px", fontWeight: 600,
                    color: isActive ? "var(--gold)" : today || tomorrow ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "9px", color: "var(--text-ghost)", marginTop: "1px" }}>
                    {gameTypes} · {totalRaces} lopp
                  </div>
                </div>

                {/* Game type badge */}
                <span style={{
                  fontSize: "9px", fontWeight: 600, padding: "2px 6px", borderRadius: "3px",
                  background: isActive ? "var(--gold)" : "rgba(90,90,120,0.15)",
                  color: isActive ? "#0D0D12" : "var(--text-dim)",
                  letterSpacing: "0.04em",
                }}>{d.games[0]?.type || 'LOPP'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
