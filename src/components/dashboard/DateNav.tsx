"use client";
import { useState, useEffect } from "react";
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

  useEffect(() => {
    fetch('/api/race-dates')
      .then(r => r.json())
      .then(data => {
        if (data.dates) setDates(data.dates);
      })
      .catch(() => {});
  }, []);

  if (dates.length <= 1) return null;

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  };

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr === today;
  };

  const isTomorrow = (dateStr: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateStr === tomorrow.toISOString().split('T')[0];
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "4px",
      padding: "0 4px",
    }}>
      {dates.map(d => {
        const isActive = selectedDate === d.date || (!selectedDate && dates.indexOf(d) === 0);
        const gameTypes = d.games.map(g => g.type).join('/');

        return (
          <button key={d.date} onClick={() => onDateChange(d.date)}
            style={{
              background: isActive ? "var(--gold-bg)" : "transparent",
              border: isActive ? "1px solid rgba(212,168,67,0.3)" : "1px solid transparent",
              borderRadius: "4px",
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              transition: "all 0.15s ease",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
            }}>
            <div style={{
              fontSize: "10px", fontWeight: 600,
              color: isActive ? "var(--gold)" : "var(--text-dim)",
              letterSpacing: "0.04em",
            }}>
              {isToday(d.date) ? 'IDAG' : isTomorrow(d.date) ? 'IMORGON' : formatDay(d.date)}
            </div>
            <div style={{
              fontSize: "9px", fontWeight: 500,
              color: isActive ? "var(--gold)" : "var(--text-ghost)",
              letterSpacing: "0.06em",
            }}>
              {gameTypes}
            </div>
          </button>
        );
      })}
    </div>
  );
}
