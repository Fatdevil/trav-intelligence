from ingest import engine, DB_URL_SQLALCHEMY
from sqlalchemy import text
import traceback
import requests
import datetime
try:
    game_id = 'V86_2026-03-25_40_1'
    url = f"https://www.atg.se/services/racinginfo/v1/api/games/{game_id}"
    data = requests.get(url).json()
    race = data['races'][0]
    with engine.begin() as conn:
        conflict_clause = "ON CONFLICT DO NOTHING" if "postgres" in DB_URL_SQLALCHEMY.lower() else ""
        insert_clause = "INSERT OR IGNORE" if "sqlite" in DB_URL_SQLALCHEMY.lower() else "INSERT"
        sql_race = text(f"""
            {insert_clause} INTO races 
            (id, race_date, track_name, race_number, race_type, distance, start_type, surface, prize_money, num_starters, created_at)
            VALUES (:id, :rdate, :track, :num, :rtype, :dist, :start, :surf, :prize, :starters, :created)
            {conflict_clause}
        """)
        res = conn.execute(sql_race, {
            "id": race['id'],
            "rdate": race.get('date') or race.get('startTime', '2026-01-01'),
            "track": 'Test',
            "num": 1,
            "rtype": 'V86',
            "dist": 2140,
            "start": 'V',
            "surf": 'Lätt',
            "prize": 100000,
            "starters": 12,
            "created": datetime.datetime.now().isoformat()
        })
        print(f"Success! Inserted rowcount: {res.rowcount}")
except Exception as e:
    traceback.print_exc()
