'use client';

export default function Insights() {
  const mockInsights = [
    {
      id: 1,
      date: "I förrgår (V86 Bjerke/Solvalla)",
      category: "Kusk / Vänstervarv",
      confidence: "89%",
      text: "LÄRDOM: AI-modellen rekommenderade spik på Björn Goop från spår 8 i regn, men han blev fastlåst i rygg. Statistiken från rättnings-skrapan visade på tok för lågt EV för denna kombination. Har nu lagt in en STRAFF-REGEL i databasen för Goop från spår 8-12 tunga banor."
    },
    {
      id: 2,
      date: "Förra veckan (V75 Mantorp)",
      category: "Skor / Underlag (Vinnande System)",
      confidence: "94%",
      text: "UTVÄRDERING: Utmärkt matematisk träff. Modellen ignorerade 52%-favoriten eftersom den förlorar hela 40% av sin explosivitet när den tvingas gå med järnskor pga vinterbana. Vår rekommenderade neongröna 4-procentare dök snyggt upp i vinnarcirkeln PRECIS som Huvuddomaren förutspådde."
    },
    {
      id: 3,
      date: "2 veckor sedan (V75 Jägersro)",
      category: "Vagnsinformation (Jänkarvagn)",
      confidence: "74%",
      text: "NOTIS: Datan från mina sista 12 analyser visar konsekvent att Jänkarvagn ger noll effekt för hästar som rankats som C-hästar bakifrån i guld-divisionen. AI:n ska framöver sluta plocka med C-rank enbart pga uppanmäld vagnsförändring."
    }
  ];

  return (
    <main className="container">
      <h1>AI:ns Minne & Rättningar</h1>
      <p className="subtitle">Här granskar Databasen och AI:n sig själva <strong style={{color: '#39ff14'}}>efter</strong> att loppen gått i mål.</p>
      
      <div className="glass-panel" style={{marginBottom: '2rem'}}>
        <h2 style={{color: '#39ff14', marginBottom: '1rem', borderBottom: '1px solid rgba(57, 255, 20, 0.3)', paddingBottom: '0.5rem', fontWeight: 800}}>
          Hur funkar maskininlärningen?
        </h2>
        <p style={{color: 'rgba(255,255,255,0.9)', lineHeight: 1.6, fontSize: '1.05rem'}}>
          Varje kväll efter tävlingarna hämtar servern det rätta facit. Vår Huvuddomare tvingas då läsa sina egna vinnande och förlorande råd och rita upp 
          vad som gick snett eller rätt. Insikterna sparas här varpå AI:n lägger in spärrar för nästa vecka.
        </p>
      </div>

      <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
        {mockInsights.map(insight => (
          <div key={insight.id} className="glass-panel" style={{padding: '1.5rem', marginBottom: '0', position: 'relative'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px dashed rgba(255,255,255,0.2)', paddingBottom: '0.5rem'}}>
              <span style={{color: '#39ff14', fontWeight: 700, textTransform: 'uppercase'}}>{insight.category}</span>
              <span style={{color: '#d500f9', fontSize: '0.9rem', fontWeight: 'bold'}}>{insight.date}</span>
            </div>
            <p style={{color: '#fff', fontSize: '1.1rem', lineHeight: 1.6, marginBottom: '1.5rem'}}>{insight.text}</p>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
               <span style={{color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem'}}>Tillitsvärde i Databasen:</span>
               <div style={{background: 'rgba(0,0,0,0.5)', padding: '5px 15px', borderRadius: '10px', color: '#39ff14', border: '1px solid #39ff14', fontWeight: 'bold'}}>
                 {insight.confidence} Säkerhet i parametern
               </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
