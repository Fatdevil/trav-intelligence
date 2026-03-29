import os
import sys
import time
import requests
import datetime
import uuid
from typing import Optional, Dict, Any, List
from sqlalchemy import create_engine, text
from config import DB_URL_SQLALCHEMY

# Disable TLS warning if needed (Atg environments sometimes complain)
import warnings
import urllib3
warnings.filterwarnings("ignore", category=urllib3.exceptions.InsecureRequestWarning)

# Config
engine = create_engine(DB_URL_SQLALCHEMY)

def fetch_with_retry(url: str, max_retries: int = 3) -> Optional[Dict[str, Any]]:
    """Hämta JSON från ett URL med exponential backoff."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            time.sleep(2 ** attempt)
    return None

def fetch_games_for_date(date_str: str) -> List[str]:
    """Hitta alla relevanta spel (V75, V86, V85, V64) för ett visst datum."""
    url = f"https://www.atg.se/services/racinginfo/v1/api/calendar/day/{date_str}"
    data = fetch_with_retry(url)
    game_ids = []
    if not data or 'games' not in data:
        return game_ids
    
    games_dict = data['games']
    for game_type in ['V75', 'V86', 'V64', 'V85']:
        if game_type in games_dict:
            for g in games_dict[game_type]:
                game_ids.append(g.get('id'))
    return game_ids

def parse_and_ingest_game(game_id: str):
    """Läs ner spelets lopp och placeringar, spara idempotent i databasen."""
    url = f"https://www.atg.se/services/racinginfo/v1/api/games/{game_id}"
    data = fetch_with_retry(url)
    if not data or 'races' not in data:
        return 0, 0, 0

    game_type = data.get('type', 'UNKNOWN')
    races_inserted = 0
    horses_inserted = 0
    starters_inserted = 0

    with engine.begin() as conn:
        for race in data['races']:
            if race.get('status') != 'results':
                continue # Endast lopp som är avgjorda
                
            race_id = race.get('id')
            race_date_str = race.get('date') or race.get('startTime')
            if not race_date_str: continue
            
            # Parse prize money format 'Pris: 60.000-30.000...'
            prize_money = 0
            for term in race.get('terms') or []:
                if 'Pris:' in term or 'Prissumma:' in term:
                    try:
                        p_str = term.split(':')[1].strip().split('-')[0].replace('.', '').replace(' ', '')
                        prize_money = int(p_str)
                    except: pass
            
            # Formatera start type (Volte / Auto)
            raw_start = str(race.get('startMethod') or '').lower()
            start_type = 'A' if 'auto' in raw_start else 'V'
            
            # Race SQL
            try:
                conflict_clause = "ON CONFLICT DO NOTHING" if "postgres" in DB_URL_SQLALCHEMY.lower() else ""
                insert_clause = "INSERT OR IGNORE" if "sqlite" in DB_URL_SQLALCHEMY.lower() else "INSERT"
                
                sql_race = text(f"""
                    {insert_clause} INTO races 
                    (id, race_date, track_name, race_number, race_type, distance, start_type, surface, prize_money, num_starters, created_at)
                    VALUES (:id, :rdate, :track, :num, :rtype, :dist, :start, :surf, :prize, :starters, :created)
                    {conflict_clause}
                """)
                
                res = conn.execute(sql_race, {
                    "id": race_id,
                    "rdate": race_date_str,
                    "track": (race.get('track') or {}).get('name', 'Unknown'),
                    "num": race.get('number', 0),
                    "rtype": game_type,
                    "dist": race.get('distance', 0),
                    "start": start_type,
                    "surf": (race.get('track') or {}).get('condition', 'Unknown'),
                    "prize": prize_money,
                    "starters": len(race.get('starts') or []),
                    "created": datetime.datetime.now().isoformat()
                })
                races_inserted += res.rowcount
            except Exception as e:
                print(f"  [WARN] Race insert error: {e}")

            # Hästar & Starters
            for starter in race.get('starts', []):
                horse = starter.get('horse', {})
                horse_id = str(horse.get('id', uuid.uuid4()))
                
                try:
                    sql_horse = text(f"""
                        {insert_clause} INTO horses 
                        (id, horse_name, birth_year, country, gender, created_at)
                        VALUES (:id, :name, :byear, :ctr, :gend, :created)
                        {conflict_clause}
                    """)
                    res_h = conn.execute(sql_horse, {
                        "id": horse_id,
                        "name": horse.get('name', 'Unknown'),
                        "byear": horse.get('age', 0), # Fallback mapping age to birth year temporarily
                        "ctr": horse.get('nationality', 'Unknown'),
                        "gend": horse.get('sex', 'Unknown'),
                        "created": datetime.datetime.now().isoformat()
                    })
                    horses_inserted += res_h.rowcount
                except Exception as e:
                    print(f"  [WARN] Horse insert error: {e}")

                # Result parsing
                res_data = starter.get('result', {})
                km_time_obj = res_data.get('kmTime') or {}
                
                # ATG returnerar { 'minutes': 1, 'seconds': 12, 'tenths': 4 }
                m = km_time_obj.get('minutes', 0)
                s = km_time_obj.get('seconds', 0)
                t = km_time_obj.get('tenths', 0)
                
                if m > 0 or s > 0 or t > 0:
                    km_val = float(m * 60 + s + t / 10.0)
                else:
                    km_val = None

                start_id = f"{race_id}_{horse_id}"
                
                # Fetching odds
                odds = res_data.get('finalOdds')
                if odds is None:
                    try:
                        pool_odds = starter.get('pools', {}).get('vinnare', {}).get('odds', 0)
                        if pool_odds > 0:
                            odds = pool_odds / 100.0
                    except: pass

                # Shoe data: 0 = has shoe, 1 = barefoot (barfota)
                shoes = horse.get('shoes', {})
                shoes_front = None
                shoes_back = None
                if isinstance(shoes, dict) and shoes.get('reported'):
                    front = shoes.get('front', {})
                    back = shoes.get('back', {})
                    shoes_front = True if front.get('hasShoe', True) else False
                    shoes_back = True if back.get('hasShoe', True) else False

                # Sulky type
                sulky = horse.get('sulky', {}) or starter.get('sulky', {}) or {}
                sulky_type = None
                if isinstance(sulky, dict) and sulky.get('reported'):
                    sulky_type = (sulky.get('type', {}) or {}).get('code', None)

                # Gallop flag
                galloped = True if res_data.get('galloped') else False

                try:
                    sql_starter = text(f"""
                        {insert_clause} INTO race_starters 
                        (id, race_id, horse_id, post_position, driver_name, trainer_name, scratch, final_position, km_time, odds_final, odds_pre_race, shoes_front, shoes_back, sulky_type, galloped, created_at)
                        VALUES (:id, :rid, :hid, :post, :drv, :trn, :scr, :fin, :km, :odds, :odds, :sf, :sb, :sulky, :gal, :created)
                        {conflict_clause}
                    """)
                    res_s = conn.execute(sql_starter, {
                        "id": start_id,
                        "rid": race_id,
                        "hid": horse_id,
                        "post": starter.get('number', 0),
                        "drv": f"{starter.get('driver', {}).get('firstName', '')} {starter.get('driver', {}).get('lastName', '')}".strip(),
                        "trn": f"{horse.get('trainer', {}).get('firstName', '')} {horse.get('trainer', {}).get('lastName', '')}".strip(),
                        "scr": res_data.get('scratched', False),
                        "fin": res_data.get('place', 0),
                        "km": km_val,
                        "odds": odds,
                        "sf": shoes_front,
                        "sb": shoes_back,
                        "sulky": sulky_type,
                        "gal": galloped,
                        "created": datetime.datetime.now().isoformat()
                    })
                    starters_inserted += res_s.rowcount

                    # UPDATE fallback: fill shoe/gallop for existing rows
                    if res_s.rowcount == 0 and (shoes_front is not None or galloped):
                        conn.execute(text("""
                            UPDATE race_starters 
                            SET shoes_front = COALESCE(:sf, shoes_front),
                                shoes_back = COALESCE(:sb, shoes_back),
                                sulky_type = COALESCE(:sulky, sulky_type),
                                galloped = COALESCE(:gal, galloped)
                            WHERE id = :id
                        """), {"sf": shoes_front, "sb": shoes_back, "sulky": sulky_type, "gal": galloped, "id": start_id})
                except Exception:
                    pass

    return races_inserted, horses_inserted, starters_inserted

def run_ingestion(months_back: int = 6):
    print(f"[INGEST] Booting ML Data Ingestion (Target: Past {months_back} months)")
    today = datetime.date.today()
    days_to_fetch = months_back * 30

    total_r = 0
    total_h = 0
    total_s = 0

    for i in range(days_to_fetch):
        target_date = today - datetime.timedelta(days=i)
        
        # Performance shortcut: Main races are usually run on saturdays/wednesdays (V75/V86)
        if target_date.weekday() not in [2, 5]: # 2=Wed, 5=Sat
            # We skip non-wednesday/saturday to vastly speed up MVP backfill
            # For a production pipeline, we should fetch all days. Let's do all days if 1 month, else filter.
            if months_back > 1:
                continue

        date_str = target_date.strftime('%Y-%m-%d')
        ids = fetch_games_for_date(date_str)
        if not ids:
            continue
            
        for g_id in ids:
            print(f"[FETCH] Ingesting game {g_id} ({date_str})...")
            r, h, s = parse_and_ingest_game(g_id)
            total_r += r
            total_h += h
            total_s += s
            
    print("[DONE] MIGRATION COMPLETE")
    print(f"Lopp tillagda: {total_r}")
    print(f"Hästar tillagda: {total_h}")
    print(f"Startposter tillagda: {total_s}")

    # Skriv tidsstämpel för senaste lyckade hämtning
    import json
    stamp_path = os.path.join(os.path.dirname(__file__), 'last_ingest.json')
    with open(stamp_path, 'w') as f:
        json.dump({
            'timestamp': datetime.datetime.now().isoformat(),
            'races_added': total_r,
            'horses_added': total_h,
            'starters_added': total_s,
            'months_fetched': months_back
        }, f)
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--months', type=int, default=24, help='Antal månader bakåt att hämta')
    args = parser.parse_args()
    run_ingestion(months_back=args.months)
