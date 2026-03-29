/**
 * Feature-baserad kommentargenerator (Fas 20)
 * Genererar svenska kommentarer för ALLA hästar baserat på LGBM-features.
 * Kostar 0 kr — ingen AI-API-anrop, ren datalogi.
 */

export interface HorseComment {
  horseName: string;
  postPosition: number;
  odds: number;
  modelProb: number;    // Modellens beräknade vinstchans
  marketProb: number;   // Marknadens implicita vinstchans (1/odds)
  edge: number;         // modelProb - marketProb
  tier: 'GULDTIPS' | 'BEVAKNING' | null;
  tags: string[];       // Korta feature-taggar (t.ex. "Kuskform TOPP")
  comment: string;      // Fullständig kommentar
  signals: Signal[];    // Strukturerade signaler
}

interface Signal {
  emoji: string;
  label: string;
  value: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface FeatureMap {
  [key: string]: number | null;
}

/**
 * Generera kommentar för en häst baserat på features
 */
export function generateHorseComment(
  horseName: string,
  postPosition: number,
  odds: number,
  modelProb: number,
  features: FeatureMap
): HorseComment {
  const marketProb = 1.0 / Math.max(odds, 1.01);
  const edge = modelProb - marketProb;
  
  // Bestäm tier
  let tier: 'GULDTIPS' | 'BEVAKNING' | null = null;
  if (edge >= 0.05) tier = 'GULDTIPS';
  else if (edge >= 0.03) tier = 'BEVAKNING';
  
  const signals: Signal[] = [];
  const tags: string[] = [];
  
  // === KUSKFORM ===
  const driverWinRate = features['driver_win_rate_last30'];
  if (driverWinRate !== null && driverWinRate !== undefined) {
    const pct = (driverWinRate * 100).toFixed(0);
    if (driverWinRate >= 0.25) {
      signals.push({ emoji: '🏆', label: 'Kuskform', value: `${pct}% vinstandel 30d`, sentiment: 'positive' });
      tags.push('Kuskform TOPP');
    } else if (driverWinRate >= 0.15) {
      signals.push({ emoji: '👍', label: 'Kuskform', value: `${pct}% vinstandel 30d`, sentiment: 'positive' });
      tags.push('Kuskform bra');
    } else if (driverWinRate <= 0.05) {
      signals.push({ emoji: '⚠️', label: 'Kuskform', value: `${pct}% vinstandel 30d`, sentiment: 'negative' });
      tags.push('Kuskform svag');
    } else {
      signals.push({ emoji: '👤', label: 'Kuskform', value: `${pct}% vinstandel 30d`, sentiment: 'neutral' });
    }
  }
  
  // === HÄSTFORM ===
  const winRateLast10 = features['win_rate_last10'];
  if (winRateLast10 !== null && winRateLast10 !== undefined) {
    const pct = (winRateLast10 * 100).toFixed(0);
    if (winRateLast10 >= 0.3) {
      signals.push({ emoji: '🔥', label: 'Hästform', value: `${pct}% vinst senaste 10`, sentiment: 'positive' });
      tags.push('I storform');
    } else if (winRateLast10 >= 0.15) {
      signals.push({ emoji: '📈', label: 'Hästform', value: `${pct}% vinst senaste 10`, sentiment: 'positive' });
    } else if (winRateLast10 === 0) {
      signals.push({ emoji: '📉', label: 'Hästform', value: 'Inga vinster senaste 10', sentiment: 'negative' });
      tags.push('Utan vinst');
    }
  }
  
  // === SPÅR ===
  if (postPosition <= 3) {
    signals.push({ emoji: '🟢', label: 'Spår', value: `Spår ${postPosition} (fördelaktigt)`, sentiment: 'positive' });
    tags.push(`Spår ${postPosition} ✓`);
  } else if (postPosition >= 8) {
    signals.push({ emoji: '🔴', label: 'Spår', value: `Spår ${postPosition} (bakspår)`, sentiment: 'negative' });
    tags.push('Bakspår');
  } else {
    signals.push({ emoji: '⚪', label: 'Spår', value: `Spår ${postPosition}`, sentiment: 'neutral' });
  }
  
  // === VILA ===
  const daysSinceRace = features['days_since_last_race'];
  if (daysSinceRace !== null && daysSinceRace !== undefined) {
    if (daysSinceRace >= 60) {
      signals.push({ emoji: '💤', label: 'Vila', value: `${Math.round(daysSinceRace)}d sedan start`, sentiment: 'negative' });
      tags.push('Lång vila');
    } else if (daysSinceRace >= 30) {
      signals.push({ emoji: '😴', label: 'Vila', value: `${Math.round(daysSinceRace)}d sedan start`, sentiment: 'neutral' });
    } else if (daysSinceRace >= 7 && daysSinceRace <= 21) {
      signals.push({ emoji: '✅', label: 'Vila', value: `${Math.round(daysSinceRace)}d (optimal)`, sentiment: 'positive' });
      tags.push('Optimal vila');
    }
  }
  
  // === BARFOTA ===
  const barefoot = features['barefoot_front'];
  if (barefoot !== null && barefoot !== undefined && barefoot > 0) {
    signals.push({ emoji: '🦶', label: 'Utrustning', value: 'Barfota fram', sentiment: 'positive' });
    tags.push('Barfota');
  }
  
  // === SULKY ===
  const sulkyAmerican = features['sulky_american'];
  if (sulkyAmerican !== null && sulkyAmerican !== undefined && sulkyAmerican > 0) {
    signals.push({ emoji: '🇺🇸', label: 'Sulky', value: 'Amerikansk (jänkarvagn)', sentiment: 'positive' });
    tags.push('Jänkare');
  }
  
  // === TRÄNARE ===
  const trainerWinRate = features['trainer_win_rate_last30'];
  if (trainerWinRate !== null && trainerWinRate !== undefined) {
    if (trainerWinRate >= 0.20) {
      signals.push({ emoji: '🏅', label: 'Tränare', value: `${(trainerWinRate * 100).toFixed(0)}% vinstandel 30d`, sentiment: 'positive' });
      tags.push('Topp-stall');
    }
  }
  
  // === KM-TID ===
  const avgKmTime = features['avg_km_time_last5'];
  if (avgKmTime !== null && avgKmTime !== undefined) {
    if (avgKmTime <= 75) {
      signals.push({ emoji: '⚡', label: 'Fart', value: `${avgKmTime.toFixed(1)}s snitt (snabb)`, sentiment: 'positive' });
      tags.push('Snabb');
    } else if (avgKmTime >= 82) {
      signals.push({ emoji: '🐢', label: 'Fart', value: `${avgKmTime.toFixed(1)}s snitt (långsam)`, sentiment: 'negative' });
    }
  }
  
  // === EDGE-ANALYS ===
  const edgePct = (edge * 100).toFixed(1);
  const modelPct = (modelProb * 100).toFixed(1);
  const marketPct = (marketProb * 100).toFixed(1);
  
  if (edge >= 0.05) {
    signals.push({ emoji: '🏆', label: 'Edge', value: `+${edgePct}% (GULDTIPS)`, sentiment: 'positive' });
  } else if (edge >= 0.03) {
    signals.push({ emoji: '👀', label: 'Edge', value: `+${edgePct}% (Bevakning)`, sentiment: 'positive' });
  } else if (edge >= 0) {
    signals.push({ emoji: '⚖️', label: 'Edge', value: `+${edgePct}% (neutral)`, sentiment: 'neutral' });
  } else if (edge >= -0.05) {
    signals.push({ emoji: '📊', label: 'Edge', value: `${edgePct}% (rätt prissatt)`, sentiment: 'neutral' });
  } else {
    signals.push({ emoji: '❌', label: 'Edge', value: `${edgePct}% (överspelad)`, sentiment: 'negative' });
    tags.push('Överspelad');
  }
  
  // === Bygg kommentartext ===
  const positiveSignals = signals.filter(s => s.sentiment === 'positive');
  const negativeSignals = signals.filter(s => s.sentiment === 'negative');
  
  let comment = '';
  if (tier === 'GULDTIPS') {
    comment = `🏆 GULDTIPS — Modellen ser ${modelPct}% vinstchans mot marknadens ${marketPct}%. `;
    comment += positiveSignals.map(s => s.value).join('. ') + '.';
    if (negativeSignals.length > 0) {
      comment += ` Obs: ${negativeSignals.map(s => s.value).join(', ')}.`;
    }
  } else if (tier === 'BEVAKNING') {
    comment = `👀 Bevakning — Edge +${edgePct}%. ${positiveSignals.slice(0, 2).map(s => s.value).join('. ')}.`;
  } else if (edge < -0.08) {
    comment = `❌ Överspelad av marknaden (${edgePct}%). Modellen bedömer ${modelPct}% vinstchans mot marknadens ${marketPct}%. Undvik som spik.`;
  } else if (edge < 0) {
    comment = `📊 Rätt prissatt till neutral. ${positiveSignals.length > 0 ? positiveSignals[0].value + '.' : ''} ${negativeSignals.length > 0 ? 'Dock: ' + negativeSignals[0].value + '.' : ''}`.trim();
  } else {
    comment = `⚖️ Svag positiv edge (+${edgePct}%). ${positiveSignals.length > 0 ? positiveSignals[0].value + '.' : 'Inga starka signaler.'}`;
  }
  
  return {
    horseName,
    postPosition,
    odds,
    modelProb,
    marketProb,
    edge,
    tier,
    tags,
    comment: comment.trim(),
    signals
  };
}
