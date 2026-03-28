'use client';
import { useState } from 'react';
import { CinematicHero } from '@/components/ui/cinematic-hero';

type HorseSelection = {
  id: number;
  name: string;
  lopp: string;
  odds: string;
  motivation: string;
};

// Uppdaterad typning dör varje häst nu har motivering!
type FullSystemHorse = {
  num: number;
  desc: string;
};

type FullSystemLeg = {
  race: string;
  horses: FullSystemHorse[];
};

type AIResponse = {
  systemCost: number;
  totalRows: number;
  strategyName: string;
  selections: HorseSelection[];
  analysisSummary: string;
  fullSystem: FullSystemLeg[];
  xmlContent: string;
};

export default function Home() {
  const [budget, setBudget] = useState<string>('');
  const [strategy, setStrategy] = useState<string>('ev');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);

  const generateSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budget || isNaN(Number(budget))) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: Number(budget), strategy })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      alert("Något gick fel vid hämtning av analysen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <CinematicHero 
        brandName={<>TRAV<br/>INTELLIGENCE</>}
        tagline1="Kalla kalkyler,"
        tagline2="heta vinster."
        cardHeading="Spela smartare med AI."
        cardDescription={<><span className="text-white font-semibold">Trav Intelligence</span> analyserar lopp, odds och skvaller för att bygga matematiskt optimala system.</>}
        metricValue={100}
        metricLabel="ROI Potential"
        ctaHeading="Redo för V75?"
        ctaDescription="Låt vår AI bygga ditt system med maximalt värde."
      />
      <main id="analyzer" className="container mt-20 relative z-30">
      <h1>Trav Intelligence (TI) Analytiker</h1>
      <p className="subtitle">Låt AI bygga ditt system med kalla, beräknande kalkyler.</p>

      <div className="glass-panel">
        <form onSubmit={generateSystem}>
          <div className="input-group">
            <label htmlFor="budget">Hur mycket vill du spela för? (SEK)</label>
            <input 
              type="number" 
              id="budget" 
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="T.ex. 250"
              required
              min="10"
            />
          </div>

          <div className="input-group">
            <label htmlFor="strategy">Välj spelprofil och risk</label>
            <select 
              id="strategy" 
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              <option value="safe">Låg risk (Trygga spikar & Favoriter)</option>
              <option value="ev">Matematiskt Optimalt (EV+ / Proffsens val)</option>
              <option value="jackpot">Miljonjakten (Fokus stora Skrällar)</option>
            </select>
          </div>

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Analyserar system & risker...' : 'Generera AI-System'}
          </button>
        </form>
      </div>

      {loading && (
        <div className="glass-panel skeleton-card">
          <div className="skeleton title"></div>
          <div className="skeleton text"></div>
          <div className="skeleton text text-short"></div>
        </div>
      )}

      {result && !loading && (
        <div className="fade-in">
          <div className="glass-panel">
            <h2 style={{color: '#fff', marginBottom: '1rem', textShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>AI-Resultat: {result.strategyName}</h2>
            <p style={{color: 'rgba(255,255,255,0.95)', lineHeight: '1.6', marginBottom: '2rem', whiteSpace: 'pre-wrap'}}>
              {result.analysisSummary}
            </p>
            
            <h3 style={{color: '#39ff14', fontSize: '1.2rem', marginBottom: '1rem', textTransform: 'uppercase'}}>Kupongens Kärna</h3>
            <div className="horse-grid">
              {result.selections.map(horse => (
                <div key={horse.id} className="horse-card">
                  <div className="horse-header">
                    <div>
                      <span style={{color: '#ffcc00', fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px'}}>{horse.lopp}</span>
                      <div className="horse-name">{horse.name}</div>
                    </div>
                    <div className="horse-odds">{horse.odds}</div>
                  </div>
                  <div className="horse-reason">{horse.motivation}</div>
                </div>
              ))}
            </div>

            {/* INLÄMNINGSKUPONG MED MOTIVERING PER HÄST */}
            {result.fullSystem && (
              <div style={{marginTop: '3.5rem'}}>
                <h3 style={{color: '#fff', fontSize: '1.2rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '0.8rem', fontWeight: 800}}>
                  Komplett Inlämningsrad & Mikro-Motivering
                </h3>
                <div style={{display: 'flex', flexDirection: 'column', gap: '1.2rem'}}>
                  {result.fullSystem.map(leg => (
                    <div key={leg.race} style={{
                      background: 'rgba(0,0,0,0.4)', 
                      borderRadius: '12px', 
                      borderLeft: leg.horses.length === 1 ? '4px solid #39ff14' : '4px solid rgba(255,255,255,0.1)',
                      overflow: 'hidden'
                    }}>
                      
                      {/* Radens "huvud": Loppet och vilka nummer som spelas */}
                      <div style={{display: 'flex', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)'}}>
                        <div style={{width: '90px', fontWeight: 800, color: '#ffcc00', letterSpacing: '1px'}}>{leg.race}</div>
                        <div style={{color: '#fff', letterSpacing: '3px', fontFamily: 'monospace', fontSize: '1.2rem'}}>
                          {leg.horses.map(h => h.num).join(', ')}
                        </div>
                        {leg.horses.length === 1 && (
                          <div style={{marginLeft: 'auto', background: 'rgba(57, 255, 20, 0.2)', color: '#39ff14', padding: '4px 10px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '1px'}}>
                            SPIK
                          </div>
                        )}
                      </div>

                      {/* Mikro-motiveringar under loppet */}
                      <div style={{padding: '1rem 1.5rem', background: 'rgba(0,0,0,0.2)'}}>
                        {leg.horses.map(h => (
                          <div key={h.num} style={{marginBottom: '0.6rem', fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.4}}>
                            <strong style={{color: '#39ff14', display: 'inline-block', width: '30px', fontWeight: 800}}>{h.num}.</strong>
                            {h.desc}
                          </div>
                        ))}
                      </div>

                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="total-cost-box">
              <h3>System Redo: {result.totalRows} rader × {result.systemCost > 0 && result.totalRows > 0 ? (result.systemCost / result.totalRows).toFixed(2) : '1.00'} kr = {result.systemCost} kr</h3>
              <p style={{color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', marginBottom: '1rem'}}>Matematiskt reducerat utifrån din budget och AI:ns ranking.</p>
              {result.xmlContent && (
                <button 
                  onClick={() => {
                    const blob = new Blob([result.xmlContent], { type: 'application/xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'trav-ai-system.xml';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="primary-btn"
                  style={{marginTop: '0.5rem', fontSize: '1rem'}}
                >
                  📥 Ladda ner ATG-fil (.xml)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
    </>
  );
}
