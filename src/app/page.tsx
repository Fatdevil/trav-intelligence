'use client';
import { useState, useEffect } from 'react';
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
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [result, setResult] = useState<AIResponse | null>(null);

  const loadingMessages = [
    "⚡ Etablerar krypterad säkerhetslänk till ATG...",
    "📡 Klonar V75-startlistor & Live-Odds från mainfraime...",
    "🤖 Skvaller-Agenten skrapar nätet efter morgonens värmningar...",
    "🌧️ Ban-Experten kvantifierar väderdata och skotvång...",
    "📉 Skrälljägaren söker efter asymmetriska EV-värden...",
    "⚖️ Master Judge RAG-kollar tidigare minnen och bedömer starten...",
    "✂️ Den matematiska reduceraren slaktar rader för att matcha din budget...",
    "🔥 Paketerar exklusiv miljon-XML för omedelbar export..."
  ];

  // Kör fejkad uppbyggnad av laddtexter för maximal "Hackerkänsla"
  useEffect(() => {
    let interval: any;
    if (loading) {
      setLoadingTextIndex(0);
      interval = setInterval(() => {
        setLoadingTextIndex(prev => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [loading]);

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
        <div className="glass-panel" style={{ border: '1px solid rgba(57, 255, 20, 0.4)', boxShadow: '0 0 40px rgba(57, 255, 20, 0.1)'}}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid rgba(57,255,20,0.2)', paddingBottom: '1rem', marginBottom: '1rem' }}>
            <div className="spinner" style={{width: '20px', height: '20px', border: '3px solid rgba(57,255,20,0.3)', borderTop: '3px solid #39ff14', borderRadius: '50%', animation: 'spin 1s linear infinite'}}></div>
            <h3 style={{color: '#39ff14', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '2px', margin: 0}}>Tillverkar System</h3>
          </div>
          <div style={{ fontFamily: 'var(--font-mono), monospace', color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {loadingMessages.map((msg, idx) => (
              <div key={idx} style={{ 
                opacity: idx <= loadingTextIndex ? 1 : 0.2, 
                color: idx === loadingTextIndex ? '#39ff14' : 'rgba(255,255,255,0.5)',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{opacity: idx === loadingTextIndex ? 1 : 0}}>&gt;</span> {msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {result && !loading && (
        <div className="fade-in">
          <div className="glass-panel">
            <h2 style={{color: '#fff', marginBottom: '1rem', textShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>AI-Resultat: {result.strategyName}</h2>
            <p style={{color: 'rgba(255,255,255,0.95)', lineHeight: '1.6', marginBottom: '2rem', whiteSpace: 'pre-wrap'}}>
              {result.analysisSummary}
            </p>
            
            <h3 style={{color: '#ffcc00', fontSize: '1.2rem', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px', textShadow: '0 0 10px rgba(255, 204, 0, 0.5)'}}>👑 Kupongens Kärna (Dina AI-Spikar)</h3>
            <div className="horse-grid">
              {result.selections.map(horse => (
                <div key={horse.id} className="horse-card" style={{ 
                  background: 'linear-gradient(145deg, rgba(255,215,0,0.05) 0%, rgba(0,0,0,0.8) 100%)',
                  border: '1px solid rgba(255, 204, 0, 0.4)', 
                  boxShadow: '0 10px 30px rgba(255, 204, 0, 0.15)',
                  transform: 'translateY(-2px)'
                }}>
                  <div className="horse-header">
                    <div>
                      <span style={{color: '#ffcc00', fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', background: 'rgba(255,204,0,0.1)', padding: '2px 6px', borderRadius: '4px'}}>{horse.lopp}</span>
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
                  <div style={{
                    animation: 'pulse 2s infinite'
                  }}>
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
                      style={{
                        marginTop: '0.5rem', 
                        fontSize: '1.1rem', 
                        padding: '1.2rem 2rem', 
                        background: 'linear-gradient(90deg, #39ff14, #00ff00)', 
                        color: '#000', 
                        fontWeight: 900,
                        boxShadow: '0 0 20px rgba(57, 255, 20, 0.6)'
                      }}
                    >
                      ⚡ LADDA NER OPTIMERAD XML
                    </button>
                  </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
    </>
  );
}
