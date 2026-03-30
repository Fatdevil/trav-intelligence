"""Backfill v3 - Fixed SQL, better error handling, progress logging."""
import sys, os, time, requests, warnings
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings("ignore")
from config import DB_URL_SQLALCHEMY
from sqlalchemy import create_engine, text

engine = create_engine(DB_URL_SQLALCHEMY)

# Get all race_ids
with engine.connect() as conn:
    rows = conn.execute(text(
        "SELECT DISTINCT rs.race_id FROM race_starters rs WHERE rs.shoe_change_front IS NULL LIMIT 3000"
    )).fetchall()

race_ids = [r[0] for r in rows]
print(f"Races to backfill: {len(race_ids)}")

updated_horses = 0
updated_starters = 0
skipped = 0

for i, race_id in enumerate(race_ids):
    try:
        url = f"https://www.atg.se/services/racinginfo/v1/api/races/{race_id}"
        resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=8)
        if resp.status_code != 200:
            skipped += 1
            continue
        
        race = resp.json()
        
        with engine.begin() as conn:
            for starter in race.get('starts', []):
                horse = starter.get('horse', {})
                horse_id = str(horse.get('id', ''))
                if not horse_id:
                    continue
                
                # Record time
                record = horse.get('record', {})
                record_time = None
                if isinstance(record, dict):
                    rt = record.get('time', {})
                    if isinstance(rt, dict):
                        m = rt.get('minutes', 0) or 0
                        s = rt.get('seconds', 0) or 0
                        t = rt.get('tenths', 0) or 0
                        if m > 0 or s > 0:
                            record_time = float(m * 60 + s + t / 10.0)
                
                # Career earnings
                career_earnings = None
                money = horse.get('money', None)
                if money and isinstance(money, (int, float)) and money > 0:
                    career_earnings = float(money)
                
                # Update horse (simple SET, no GREATEST)
                if record_time is not None or career_earnings is not None:
                    try:
                        conn.execute(text("""
                            UPDATE horses 
                            SET record_time = COALESCE(:rt, record_time),
                                career_earnings = COALESCE(:ce, career_earnings)
                            WHERE id = :id
                        """), {"id": horse_id, "rt": record_time, "ce": career_earnings})
                        updated_horses += 1
                    except Exception as e:
                        pass
                
                # Shoe changes
                shoes = horse.get('shoes', {})
                if isinstance(shoes, dict) and shoes.get('reported'):
                    front = shoes.get('front', {})
                    back = shoes.get('back', {})
                    scf = bool(front.get('changed', False)) if isinstance(front, dict) else False
                    scb = bool(back.get('changed', False)) if isinstance(back, dict) else False
                    
                    start_id = f"{race_id}_{horse_id}"
                    try:
                        conn.execute(text("""
                            UPDATE race_starters 
                            SET shoe_change_front = :scf, shoe_change_back = :scb
                            WHERE id = :id
                        """), {"id": start_id, "scf": scf, "scb": scb})
                        updated_starters += 1
                    except:
                        pass
    except Exception as e:
        skipped += 1
    
    if (i + 1) % 50 == 0:
        print(f"  [{i+1}/{len(race_ids)}] Horses: {updated_horses}, Starters: {updated_starters}, Skip: {skipped}")
    
    if (i + 1) % 100 == 0:
        time.sleep(0.3)

print(f"\n{'='*50}")
print(f"  BACKFILL KLAR!")
print(f"{'='*50}")
print(f"  Horses:   {updated_horses}")
print(f"  Starters: {updated_starters}")
print(f"  Skipped:  {skipped}")

# Verify
with engine.connect() as conn:
    r1 = conn.execute(text("SELECT COUNT(*) FROM horses WHERE record_time IS NOT NULL")).scalar()
    r2 = conn.execute(text("SELECT COUNT(*) FROM horses WHERE career_earnings IS NOT NULL AND career_earnings > 0")).scalar()
    r3 = conn.execute(text("SELECT COUNT(*) FROM race_starters WHERE shoe_change_front IS NOT NULL")).scalar()
    r4 = conn.execute(text("SELECT COUNT(*) FROM race_starters")).scalar()
    print(f"\n  Horses med record_time:   {r1}")
    print(f"  Horses med earnings:      {r2}")
    print(f"  Starters med shoe_change: {r3}/{r4}")
