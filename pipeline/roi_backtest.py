"""
SQL-baserat ROI-backtest mot historisk data.
Kör insiktsfull analys direkt mot databasen.
"""
from config import DB_URL_SQLALCHEMY
from sqlalchemy import create_engine, text

e = create_engine(DB_URL_SQLALCHEMY)

print("=" * 55)
print("  ROI-BACKTEST: HISTORISKA VALUE_BETS")
print("=" * 55)

with e.connect() as c:
    # Hur manga historiska value_bets har vi med resultat?
    r = c.execute(text("""
        SELECT 
            vb.tier,
            COUNT(*) as total,
            SUM(CASE WHEN rs.final_position = 1 THEN 1 ELSE 0 END) as wins,
            AVG(rs.odds_final) as avg_odds,
            SUM(CASE WHEN rs.final_position = 1 THEN rs.odds_final ELSE 0 END) as total_returned,
            AVG(vb.model_prob) as avg_prob,
            AVG(vb.edge) as avg_edge
        FROM value_bets vb
        JOIN race_starters rs ON vb.starter_id = rs.id
        WHERE rs.final_position > 0
          AND rs.odds_final IS NOT NULL AND rs.odds_final > 1
        GROUP BY vb.tier
        ORDER BY vb.tier
    """))
    rows = r.fetchall()

total_bets = sum(row[1] for row in rows)

if not rows:
    print("\nInga historiska value_bets med resultat hittade.")
    print("Det beror pa att vi bara genererar GULDTIPS for kommande lopp,")
    print("inte retroaktivt for historiska.")
    print()
    print("For att gora ett proper backtest maste vi:")
    print("  1. Kora modellen pa historisk data (retroaktivt)")
    print("  2. Jamfora modellens tips mot faktiska resultat")
    print()
    # Visa statistik om vad vi har
    r2 = c.execute(text("SELECT COUNT(*) FROM value_bets"))
    r3 = c.execute(text("""
        SELECT COUNT(*) FROM value_bets vb 
        JOIN race_starters rs ON vb.starter_id = rs.id 
        WHERE rs.final_position > 0
    """))
    print(f"Total value_bets i DB: {r2.fetchone()[0]}")
    print(f"Dar av med avgjort resultat: {r3.fetchone()[0]}")
else:
    print(f"\nTotal bets med resultat: {total_bets}")
    for row in rows:
        tier, total, wins, avg_odds, returned, prob, edge = row
        roi = ((returned - total) / total * 100) if total > 0 else 0
        wr = (wins / total * 100) if total > 0 else 0
        print(f"\n{'='*45}")
        print(f"  {tier}")
        print(f"  Antal:         {total}")
        print(f"  Vinster:       {wins} ({wr:.1f}%)")
        print(f"  Snitt odds:    {avg_odds:.1f}" if avg_odds else "  Snitt odds:    N/A")
        print(f"  Satsad total:  {total:.0f} kr")
        print(f"  Återbetalt:    {returned:.1f} kr")
        print(f"  ROI:           {roi:+.1f}%")
        print(f"  Snitt modell:  {prob*100:.1f}%" if prob else "")
        print(f"  Snitt edge:    {edge*100:.1f}%" if edge else "")
