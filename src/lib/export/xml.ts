/**
 * ATG XML-Generator
 * 
 * Genererar en XML-fil i ATG:s format för "Fil-spel" (system upload).
 * Användaren laddar ner filen och laddar upp den direkt på atg.se.
 */

import { ReducedSystem } from '../math/reducer';

export function generateATGXml(system: ReducedSystem, gameType: string, gameId: string): string {
  const legs = system.legs.map((leg, idx) => {
    const marks = leg.selected.sort((a, b) => a - b).join(',');
    return `    <leg number="${idx + 1}" raceId="${leg.raceId}">
      <marks>${marks}</marks>
    </leg>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<atg-system>
  <game type="${gameType}" id="${gameId}" />
  <system>
    <name>AI-Systemet</name>
    <rows>${system.totalRows}</rows>
    <cost>${system.totalCost}</cost>
    <legs>
${legs}
    </legs>
  </system>
</atg-system>`;

  return xml;
}
