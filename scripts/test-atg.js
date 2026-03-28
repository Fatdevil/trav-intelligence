process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
async function testATG() {
  try {
    const dateStr = new Date().toISOString().split('T')[0];
    const calRes = await fetch(`https://www.atg.se/services/racinginfo/v1/api/calendar/day/${dateStr}`, { headers: {'User-Agent': 'Mozilla/5.0'} });
    const calData = await calRes.json();
    
    const games = calData.games || {};
    const targetGame = games.V86?.[0] || games.V75?.[0] || games.V64?.[0];
    if (!targetGame) return;
    
    const res = await fetch(`https://www.atg.se/services/racinginfo/v1/api/games/${targetGame.id || targetGame}`, { headers: {'User-Agent': 'Mozilla/5.0'} });
    const data = await res.json();
    
    if (data.races && data.races[0]) {
      console.log('Fetching Race:', data.races[0]);
      // data.races is array of strings e.g. '2026-03-25_7_6'
      const raceRes = await fetch(`https://www.atg.se/services/racinginfo/v1/api/races/${data.races[0]}`, { headers: {'User-Agent': 'Mozilla/5.0'} });
      const raceData = await raceRes.json();
      console.log('Race Keys:', Object.keys(raceData));
      if (raceData.starts && raceData.starts[0]) {
        const start = raceData.starts[0];
        console.log('Horse:', start.horse?.name);
        console.log('Driver:', start.driver?.firstName, start.driver?.lastName);
        console.log('Trainer:', start.horse?.trainer?.firstName, start.horse?.trainer?.lastName);
      }
    }
  } catch(e) {
    console.error(e);
  }
}
testATG();
