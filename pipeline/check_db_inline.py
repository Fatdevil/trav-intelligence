from config import DB_URL_SQLALCHEMY
from sqlalchemy import create_engine, text
e = create_engine(DB_URL_SQLALCHEMY)
with e.connect() as c:
    r = c.execute(text("SELECT COUNT(*) as races, MIN(CAST(race_date AS TEXT)) as earliest, MAX(CAST(race_date AS TEXT)) as latest FROM races"))
    row = r.fetchone()
    print(f"Lopp totalt:      {row[0]}")
    print(f"Tidigast datum:   {row[1]}")
    print(f"Senaste datum:    {row[2]}")

    r2 = c.execute(text("SELECT COUNT(*) FROM race_starters WHERE final_position > 0"))
    print(f"Avgjorda starter: {r2.fetchone()[0]}")

    r3 = c.execute(text("SELECT COUNT(DISTINCT horse_id) FROM race_starters"))
    print(f"Unika hastar:     {r3.fetchone()[0]}")

    r4 = c.execute(text("""
        SELECT EXTRACT(YEAR FROM race_date) as yr, COUNT(*) as cnt
        FROM races GROUP BY yr ORDER BY yr
    """))
    print("\nPer ar:")
    for row in r4:
        print(f"  {int(row[0])}: {row[1]} lopp")
