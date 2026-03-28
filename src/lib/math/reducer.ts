/**
 * Matematisk Systemreducerare för V75/V86
 * 
 * Tar AI:ns rankade hästar (A/B/C) per lopp och en budget,
 * beräknar antalet rader, och skär ner tills kostnaden matchar budgeten.
 * 
 * Kostnad = produkt av antal streck per avdelning × radpris (1 kr för V86, 0.50 kr för V75)
 */

export type RankedHorse = {
  num: number;
  name: string;
  rank: 'A' | 'B' | 'C';
  driver: string;
  odds: number;
};

export type SystemLeg = {
  legNumber: number;       // V86-1, V86-2 etc.
  raceId: string;
  horses: RankedHorse[];   // Alla hästar i loppet, rankade av AI
  selected: number[];      // Vilka nummer som är valda i systemet
};

export type ReducedSystem = {
  legs: SystemLeg[];
  totalRows: number;
  totalCost: number;
  pricePerRow: number;
};

/**
 * Beräkna antal rader i systemet
 * Rader = streck_lopp1 × streck_lopp2 × ... × streck_lopp8
 */
function calculateRows(legs: SystemLeg[]): number {
  return legs.reduce((product, leg) => product * leg.selected.length, 1);
}

/**
 * Huvudalgoritmen: Reducera systemet till att matcha budgeten
 * 
 * Strategi:
 * 1. Börja med att inkludera alla A och B hästar
 * 2. Om kostnaden > budget: ta bort C-hästar, sedan B-hästar med lägst confidence
 * 3. Om kostnaden < budget: lägg till C-hästar i de mest öppna loppen
 * 4. Garantera minst 1 häst (spik) per lopp
 */
export function reduceSystem(
  legs: SystemLeg[],
  budget: number,
  strategy: 'safe' | 'ev' | 'jackpot',
  pricePerRow: number = 1
): ReducedSystem {

  // Steg 1: Initialt urval baserat på AI-rank
  for (const leg of legs) {
    if (strategy === 'safe') {
      // Bara A-hästar + max 1 B-häst
      leg.selected = leg.horses.filter(h => h.rank === 'A').map(h => h.num);
      const bHorses = leg.horses.filter(h => h.rank === 'B');
      if (bHorses.length > 0) leg.selected.push(bHorses[0].num);
    } else if (strategy === 'jackpot') {
      // Alla A + B + C hästar (helgardering i svåra lopp)
      leg.selected = leg.horses.filter(h => h.rank === 'A' || h.rank === 'B' || h.rank === 'C').map(h => h.num);
    } else {
      // EV: A + B hästar
      leg.selected = leg.horses.filter(h => h.rank === 'A' || h.rank === 'B').map(h => h.num);
    }

    // Garantera minst 1 häst per lopp
    if (leg.selected.length === 0 && leg.horses.length > 0) {
      leg.selected = [leg.horses[0].num];
    }
  }

  // Steg 2: Iterativ reduktion tills vi hamnar inom budget
  let maxIterations = 100;
  while (calculateRows(legs) * pricePerRow > budget && maxIterations > 0) {
    maxIterations--;

    // Hitta loppet med flest streck (det som kostar mest)
    const sortedLegs = [...legs]
      .filter(l => l.selected.length > 1) // Kan inte ta bort från spikar
      .sort((a, b) => b.selected.length - a.selected.length);

    if (sortedLegs.length === 0) break; // Alla är redan spikar

    const fattest = sortedLegs[0];

    // Ta bort den sämst rankade hästen i det fetaste loppet
    const selectedHorses = fattest.horses.filter(h => fattest.selected.includes(h.num));
    const worst = selectedHorses
      .sort((a, b) => {
        const rankOrder = { 'A': 0, 'B': 1, 'C': 2 };
        return rankOrder[b.rank] - rankOrder[a.rank]; // C först (sämst)
      })[0];

    if (worst) {
      fattest.selected = fattest.selected.filter(n => n !== worst.num);
    }
  }

  // Steg 3: Om vi har budget kvar, lägga till hästar
  while (true) {
    const currentCost = calculateRows(legs) * pricePerRow;
    if (currentCost >= budget) break;

    // Hitta loppet med minst streck som kan utökas
    const slimmest = [...legs]
      .filter(l => l.selected.length < l.horses.length)
      .sort((a, b) => a.selected.length - b.selected.length)[0];

    if (!slimmest) break;

    // Lägg till nästa bästa omarkerade häst
    const nextHorse = slimmest.horses.find(h => !slimmest.selected.includes(h.num));
    if (!nextHorse) break;

    // Kontrollera att tillägg inte spränger budgeten
    const testSelected = [...slimmest.selected, nextHorse.num];
    const savedLen = slimmest.selected.length;
    slimmest.selected = testSelected;
    const newCost = calculateRows(legs) * pricePerRow;
    
    if (newCost > budget) {
      slimmest.selected = slimmest.selected.slice(0, savedLen); // Ångra
      break;
    }
  }

  const totalRows = calculateRows(legs);

  return {
    legs,
    totalRows,
    totalCost: totalRows * pricePerRow,
    pricePerRow
  };
}
