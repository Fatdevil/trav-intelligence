process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export type SimplifiedHorse = {
  num: number;
  name: string;
  driver: string;
  trainer: string;
  odds: number;
  shoes: string;
  sulky: string;
  age: number;
  sex: string;
  money: number;
};

export type SimplifiedRace = {
  raceId: string;
  raceNumber: number;
  distance: number;
  startMethod: string;
  trackName: string;
  trackCondition: string;
  horses: SimplifiedHorse[];
};

export type GameData = {
  gameId: string;
  type: string;
  races: SimplifiedRace[];
};

export async function fetchLiveGameData(): Promise<GameData | null> {
  try {
    const dateStr = new Date().toISOString().split('T')[0];
    
    // 1. Fetch Calendar
    const calRes = await fetch(`https://www.atg.se/services/racinginfo/v1/api/calendar/day/${dateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!calRes.ok) return null;
    
    const calData = await calRes.json();
    const games = calData.games || {};
    const targetGame = games.V75?.[0] || games.V86?.[0] || games.V85?.[0] || games.V65?.[0] || games.V64?.[0] || games.V4?.[0];
    if (!targetGame) return null;
    
    const gameId = targetGame.id || targetGame;
    const gameType = gameId.split('_')[0];
    
    // 2. Fetch Game (races are embedded as full objects!)
    const gameRes = await fetch(`https://www.atg.se/services/racinginfo/v1/api/games/${gameId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!gameRes.ok) return null;
    
    const gameData = await gameRes.json();
    if (!gameData.races) return null;
    
    // 3. Race data is already embedded in game response - no extra fetches needed!
    const formattedRaces: SimplifiedRace[] = gameData.races.map((r: any) => {
      return {
        raceId: r.id || 'unknown',
        raceNumber: r.number || 0,
        distance: r.distance || 0,
        startMethod: r.startMethod || 'auto',
        trackName: r.track?.name || 'Okänd bana',
        trackCondition: r.track?.condition || 'unknown',
        horses: (r.starts || []).map((s: any) => {
          const oddsPool = s.pools?.vinnare?.odds;
          return {
            num: s.number || 0,
            name: s.horse?.name || 'Okänd',
            driver: `${s.driver?.firstName || ''} ${s.driver?.lastName || ''}`.trim() || 'Okänd',
            trainer: `${s.horse?.trainer?.firstName || ''} ${s.horse?.trainer?.lastName || ''}`.trim() || 'Okänd',
            odds: oddsPool ? (oddsPool / 100) : 0,
            shoes: s.horse?.shoes?.reported ? 'Barfota' : 'Med skor',
            sulky: s.horse?.sulky?.reported ? 'Jänkarvagn' : 'Standard',
            age: s.horse?.age || 0,
            sex: s.horse?.sex || 'Okänd',
            money: s.horse?.money || 0
          };
        })
      };
    });
    
    return {
      gameId,
      type: gameType,
      races: formattedRaces
    };
  } catch (err) {
    console.error('Error fetching ATG data:', err);
    return null;
  }
}
