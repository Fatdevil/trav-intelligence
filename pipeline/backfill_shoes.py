"""
Backfill Shoe Data -- Hamtar skodata per race_id fran ATG:s Race API.
Uppdaterar race_starters med shoes_front, shoes_back, sulky_type, galloped.
"""
import requests
import time
import warnings
import urllib3
from sqlalchemy import create_engine, text
from config import DB_URL_SQLALCHEMY

warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)
engine = create_engine(DB_URL_SQLALCHEMY)

def fetch_race(race_id):
    """Hamta ett enskilt lopp fran ATG Race API."""
    url = f"https://www.atg.se/services/racinginfo/v1/api/races/{race_id}"
    try:
        resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None

def backfill_shoes():
    print("[SHOES] Booting Shoe Data Backfill...")
    
    with engine.connect() as conn:
        # Hitta alla race_starters som saknar skodata
        result = conn.execute(text("""
            SELECT DISTINCT rs.race_id 
            FROM race_starters rs 
            WHERE rs.shoes_front IS NULL 
            AND rs.scratch = 0
            ORDER BY rs.race_id DESC
        """))
        race_ids = [row[0] for row in result.fetchall()]
    
    print(f"[SHOES] {len(race_ids)} lopp saknar skodata. Hamtar...")
    
    updated_total = 0
    errors = 0
    
    for i, race_id in enumerate(race_ids):
        if i > 0 and i % 50 == 0:
            print(f"[SHOES] {i}/{len(race_ids)} lopp behandlade ({updated_total} uppdaterade)...")
        
        race_data = fetch_race(race_id)
        if not race_data or 'starts' not in race_data:
            errors += 1
            time.sleep(0.3)
            continue
        
        with engine.begin() as conn:
            for starter in race_data.get('starts', []):
                horse = starter.get('horse', {})
                horse_id = str(horse.get('id', ''))
                if not horse_id:
                    continue
                
                # Shoe data
                shoes = horse.get('shoes', {})
                shoes_front = None
                shoes_back = None
                if isinstance(shoes, dict) and shoes.get('reported'):
                    front = shoes.get('front', {})
                    back = shoes.get('back', {})
                    shoes_front = 0 if front.get('hasShoe', True) else 1
                    shoes_back = 0 if back.get('hasShoe', True) else 1
                
                # Sulky
                sulky = horse.get('sulky', {}) or {}
                sulky_type = None
                if isinstance(sulky, dict) and sulky.get('reported'):
                    sulky_type = (sulky.get('type', {}) or {}).get('code', None)
                
                # Gallop
                res_data = starter.get('result', {})
                galloped = 1 if res_data.get('galloped') else 0
                
                starter_id = f"{race_id}_{horse_id}"
                
                try:
                    result = conn.execute(text("""
                        UPDATE race_starters 
                        SET shoes_front = COALESCE(:sf, shoes_front),
                            shoes_back = COALESCE(:sb, shoes_back),
                            sulky_type = COALESCE(:sulky, sulky_type),
                            galloped = COALESCE(:gal, galloped)
                        WHERE id = :id AND shoes_front IS NULL
                    """), {
                        "sf": shoes_front, "sb": shoes_back, 
                        "sulky": sulky_type, "gal": galloped, 
                        "id": starter_id
                    })
                    updated_total += result.rowcount
                except Exception:
                    pass
        
        # Rate limit: ~3 req/sec
        time.sleep(0.35)
    
    print(f"\n[DONE] Skodata-backfill klar!")
    print(f"  Lopp behandlade: {len(race_ids)}")
    print(f"  Starters uppdaterade: {updated_total}")
    print(f"  Errors/saknade: {errors}")

    # Visa tackning
    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM race_starters WHERE scratch = 0")).scalar()
        with_shoes = conn.execute(text("SELECT COUNT(*) FROM race_starters WHERE shoes_front IS NOT NULL AND scratch = 0")).scalar()
        pct = (with_shoes / total * 100) if total > 0 else 0
        print(f"\n[COVERAGE] Skodata: {with_shoes}/{total} ({pct:.1f}%)")

if __name__ == "__main__":
    backfill_shoes()
