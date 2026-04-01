import sys, os
from config import DB_URL_SQLALCHEMY
from sqlalchemy import create_engine, text

e = create_engine(DB_URL_SQLALCHEMY)
with e.connect() as c:
    r = c.execute(text("SELECT track_name, race_number, race_type FROM races WHERE cast(race_date as text) like '2026-04-01%' ORDER BY track_name, race_number"))
    rows = r.fetchall()
    print(f"Total races today: {len(rows)}")
    for row in rows:
        print(row)
