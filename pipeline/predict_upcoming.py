"""
predict_upcoming.py - Pre-Race Prediction Pipeline
===================================================
Hämtar kommande startlistor från ATG, beräknar features från historisk data,
kör LGBM-modellen, och genererar GULDTIPS/BEVAKNING INNAN loppen startar.

Användning:
  python predict_upcoming.py              # Hämtar alla kommande spel (idag + 3 dagar fram)
  python predict_upcoming.py 2026-04-01   # Hämtar specifikt datum
"""

import os
import sys
import uuid
import datetime
import requests
import warnings
import numpy as np
import pandas as pd
import duckdb
import joblib
from sqlalchemy import create_engine, text
from config import DB_URL_SQLALCHEMY, DB_PATH, IS_POSTGRES, get_connection

warnings.filterwarnings("ignore")

# ======================================================================
# 1. HÄMTA KOMMANDE SPEL FRÅN ATG
# ======================================================================

def fetch_with_retry(url, retries=3):
    for i in range(retries):
        try:
            resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, 
                              verify=False, timeout=15)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            if i == retries - 1:
                print(f"  [WARN] Kunde inte hämta {url}: {e}")
    return None

def find_upcoming_games(target_dates):
    """Hitta alla bettable V75/V86/V85/V64 spel för givna datum."""
    game_ids = []
    for date_str in target_dates:
        url = f"https://www.atg.se/services/racinginfo/v1/api/calendar/day/{date_str}"
        data = fetch_with_retry(url)
        if not data or 'games' not in data:
            continue
        
        for game_type in ['V75', 'V86', 'V64', 'V85']:
            if game_type in data.get('games', {}):
                for g in data['games'][game_type]:
                    status = g.get('status', '')
                    if status in ('bettable', 'ongoing'):
                        game_ids.append({
                            'id': g['id'],
                            'type': game_type,
                            'status': status,
                            'date': date_str,
                            'startTime': g.get('scheduledStartTime', '')
                        })
                        print(f"  [FOUND] {game_type} {date_str} ({status}) - {g['id']}")
    
    return game_ids

# ======================================================================
# 2. INGESTA KOMMANDE STARTERS I DATABASEN
# ======================================================================

def ingest_upcoming_game(game_info, engine):
    """Hämta startlistor och infoga i races/horses/race_starters."""
    game_id = game_info['id']
    game_type = game_info['type']
    
    url = f"https://www.atg.se/services/racinginfo/v1/api/games/{game_id}"
    data = fetch_with_retry(url)
    if not data or 'races' not in data:
        print(f"  [ERROR] Kunde inte hämta speldata för {game_id}")
        return []
    
    race_ids = []
    
    with engine.begin() as conn:
        for race in data['races']:
            race_id = race.get('id')
            race_date_str = race.get('date') or race.get('startTime')
            start_time = race.get('scheduledStartTime') or race.get('startTime')
            if not race_date_str:
                continue
            
            # Parse prize money
            prize_money = 0
            for term in race.get('terms') or []:
                if 'Pris:' in term or 'Prissumma:' in term:
                    try:
                        p_str = term.split(':')[1].strip().split('-')[0].replace('.', '').replace(' ', '')
                        prize_money = int(p_str)
                    except: pass
            
            raw_start = str(race.get('startMethod') or '').lower()
            start_type = 'A' if 'auto' in raw_start else 'V'
            track_name = (race.get('track') or {}).get('name', 'Unknown')
            
            # INSERT race
            try:
                sql = text("""
                    INSERT INTO races 
                    (id, race_date, track_name, race_number, race_type, distance, start_type, surface, prize_money, num_starters, created_at)
                    VALUES (:id, :rdate, :track, :num, :rtype, :dist, :start, :surf, :prize, :starters, :created)
                    ON CONFLICT DO NOTHING
                """)
                conn.execute(sql, {
                    "id": race_id,
                    "rdate": race_date_str,
                    "track": track_name,
                    "num": race.get('number', 0),
                    "rtype": game_type,
                    "dist": race.get('distance', 0),
                    "start": start_type,
                    "surf": (race.get('track') or {}).get('condition', 'Unknown'),
                    "prize": prize_money,
                    "starters": len(race.get('starts') or []),
                    "created": datetime.datetime.now().isoformat()
                })
                race_ids.append(race_id)
            except Exception as e:
                print(f"  [WARN] Race insert error: {e}")
            
            # INSERT hästar och starters
            for starter in race.get('starts', []):
                horse = starter.get('horse', {})
                horse_id = str(horse.get('id', uuid.uuid4()))
                
                # Horse
                try:
                    conn.execute(text("""
                        INSERT INTO horses (id, horse_name, birth_year, country, gender, created_at)
                        VALUES (:id, :name, :byear, :ctr, :gend, :created)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": horse_id,
                        "name": horse.get('name', 'Unknown'),
                        "byear": horse.get('age', 0),
                        "ctr": horse.get('nationality', 'Unknown'),
                        "gend": horse.get('sex', 'Unknown'),
                        "created": datetime.datetime.now().isoformat()
                    })
                except Exception as e:
                    print(f"  [WARN] Horse insert error: {e}")
                
                # Odds från vinnare-pool (pre-race odds)
                odds = None
                try:
                    pool_odds = starter.get('pools', {}).get('vinnare', {}).get('odds', 0)
                    if pool_odds > 0:
                        odds = pool_odds / 100.0
                except: pass
                
                # Shoes
                shoes = horse.get('shoes', {})
                shoes_front = None
                shoes_back = None
                if isinstance(shoes, dict) and shoes.get('reported'):
                    front = shoes.get('front', {})
                    back = shoes.get('back', {})
                    shoes_front = True if front.get('hasShoe', True) else False
                    shoes_back = True if back.get('hasShoe', True) else False
                
                # Sulky
                sulky = horse.get('sulky', {}) or starter.get('sulky', {}) or {}
                sulky_type = None
                if isinstance(sulky, dict) and sulky.get('reported'):
                    sulky_type = (sulky.get('type', {}) or {}).get('code', None)
                
                start_id = f"{race_id}_{horse_id}"
                
                try:
                    conn.execute(text("""
                        INSERT INTO race_starters 
                        (id, race_id, horse_id, post_position, driver_name, trainer_name, scratch, final_position, km_time, odds_final, odds_pre_race, shoes_front, shoes_back, sulky_type, galloped, created_at)
                        VALUES (:id, :rid, :hid, :post, :drv, :trn, :scr, :fin, :km, :odds, :odds_pre, :sf, :sb, :sulky, :gal, :created)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": start_id,
                        "rid": race_id,
                        "hid": horse_id,
                        "post": starter.get('number', 0),
                        "drv": f"{starter.get('driver', {}).get('firstName', '')} {starter.get('driver', {}).get('lastName', '')}".strip(),
                        "trn": f"{horse.get('trainer', {}).get('firstName', '')} {horse.get('trainer', {}).get('lastName', '')}".strip(),
                        "scr": False,  # Ej scratched vid startliste-hämtning
                        "fin": 0,      # Ej avgjort ännu
                        "km": None,    # Ej avgjort ännu
                        "odds": odds,  # Pre-race odds
                        "odds_pre": odds,
                        "sf": shoes_front,
                        "sb": shoes_back,
                        "sulky": sulky_type,
                        "gal": False,  # Ej avgjort ännu
                        "created": datetime.datetime.now().isoformat()
                    })
                except Exception as e:
                    print(f"  [WARN] Starter insert error: {e}")
    
    print(f"  [OK] Ingestad {len(race_ids)} lopp för {game_type} {game_info['date']}")
    return race_ids

# ======================================================================
# 3. BERÄKNA FEATURES (DuckDB) — ENBART FÖR NYA LOPP
# ======================================================================

def compute_features_for_races(race_ids):
    """Kör DuckDB feature-engine för specifika race_ids."""
    if not race_ids:
        return pd.DataFrame()
    
    con = duckdb.connect()
    safe_db_path = DB_PATH.replace("file:", "")
    
    if IS_POSTGRES:
        try: con.execute("INSTALL postgres;")
        except: pass
        con.execute("LOAD postgres;")
        con.execute(f"ATTACH '{safe_db_path}' AS devdb (TYPE postgres);")
    else:
        try: con.execute("INSTALL sqlite;")
        except: pass
        con.execute("LOAD sqlite;")
        con.execute(f"ATTACH '{safe_db_path}' AS devdb (TYPE sqlite);")
    
    # Skapa race_id filter
    race_filter = ",".join([f"'{rid}'" for rid in race_ids])
    
    print(f"[FEATURES] Beräknar features för {len(race_ids)} kommande lopp...")
    
    df = con.execute(f"""
    WITH Base AS (
        SELECT 
            rs.id AS starter_id,
            r.id AS race_id,
            rs.horse_id,
            rs.driver_name,
            rs.trainer_name,
            r.race_date,
            r.track_name,
            r.distance,
            rs.km_time,
            rs.final_position,
            rs.post_position,
            r.num_starters AS field_size,
            rs.odds_final AS odds,
            r.prize_money,
            r.start_type,
            rs.shoes_front,
            rs.shoes_back,
            rs.sulky_type,
            rs.galloped,
            rs.shoe_change_front,
            rs.shoe_change_back,
            h2.birth_year,
            h2.gender AS horse_gender,
            h2.record_time AS horse_record_time,
            h2.career_earnings
        FROM devdb.race_starters rs
        JOIN devdb.races r ON rs.race_id = r.id
        LEFT JOIN devdb.horses h2 ON rs.horse_id = h2.id
        WHERE rs.scratch = false
    ),
    Computed AS (
        SELECT 
            b.starter_id, b.race_id, b.horse_id, b.race_date,
            b.post_position, b.field_size, b.odds,
            
            (SELECT AVG(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) AS avg_km_time_last5,
            (SELECT MIN(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 10)) AS best_km_time_last10,
            (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) AS days_since_last_race,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 90) AS starts_last_90_days,
            (SELECT AVG(field_size) FROM (SELECT field_size FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 5)) AS avg_field_size_last5,
            (b.prize_money - (SELECT prize_money FROM (SELECT prize_money FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1))) AS class_change,
            (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.final_position = 1) AS days_since_last_win,
            (SELECT CAST(SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 10)) AS win_rate_last10,
            (SELECT CAST(SUM(CASE WHEN final_position IN (1,2,3) THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 10)) AS top3_rate_last10,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.driver_name = b.driver_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS driver_win_rate_last30,
            (SELECT COUNT(*) FROM Base h WHERE h.driver_name = b.driver_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS driver_starts_last30,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.trainer_name = b.trainer_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS trainer_win_rate_last30,
            (CASE WHEN b.start_type = 'V' THEN 1.0 ELSE 0.0 END) AS volt_start_indicator,
            (b.distance - (SELECT distance FROM (SELECT distance FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1))) AS distance_delta,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND h.track_name = b.track_name AND h.race_date < b.race_date) AS track_starts,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND h.track_name = b.track_name AND h.race_date < b.race_date) AS track_win_rate,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND ABS(h.distance - b.distance) <= 100 AND h.race_date < b.race_date) AS distance_starts,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND h.driver_name = b.driver_name AND h.race_date < b.race_date) AS driver_horse_combo_winrate,
            (SELECT AVG(prize_money) FROM (SELECT prize_money FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 3)) AS avg_prize_last3,
            (CASE WHEN (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) BETWEEN 14 AND 28 THEN 1.0 ELSE 0.0 END) AS rest_optimal,
            (SELECT STDDEV(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) AS km_time_consistency,
            (SELECT AVG(final_position) FROM (SELECT final_position FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.final_position > 0 ORDER BY h.race_date DESC LIMIT 3)) AS avg_position_last3,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.driver_name = b.driver_name AND h.track_name = b.track_name AND ABS(h.distance - b.distance) <= 100 AND h.race_date < b.race_date) AS driver_track_distance_winrate,
            (CASE WHEN b.trainer_name != (SELECT trainer_name FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date ASC LIMIT 1) THEN 1.0 ELSE 0.0 END) AS trainer_change_flag,
            (CASE WHEN (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) > 90 AND (SELECT final_position FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1) <= 3 THEN 1.0 ELSE 0.0 END) AS comeback_signal,
            (CASE WHEN (SELECT CAST(SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 5)) >= 0.4 AND (SELECT AVG(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) > (SELECT AVG(km_time) FROM Base h WHERE h.km_time > 0 AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 90) THEN 1.0 ELSE 0.0 END) AS overperformance_flag,
            COALESCE(b.shoes_front, 0) AS barefoot_front,
            (COALESCE(b.shoes_front, 0) + COALESCE(b.shoes_back, 0)) AS barefoot_score,
            (SELECT CAST(SUM(CASE WHEN galloped = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT galloped FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 5)) AS gallop_rate_last5,
            (CASE WHEN b.sulky_type = 'AM' THEN 1.0 ELSE 0.0 END) AS sulky_american,
            SIN(2 * 3.14159 * EXTRACT(MONTH FROM b.race_date) / 12.0) AS month_sin,
            COS(2 * 3.14159 * EXTRACT(MONTH FROM b.race_date) / 12.0) AS month_cos,
            EXTRACT(DOW FROM b.race_date) AS weekday,
            (CASE WHEN EXTRACT(DOW FROM b.race_date) IN (6, 0) THEN 1.0 ELSE 0.0 END) AS is_weekend_race,
            -- NYA FEATURES (Fas 25)
            (EXTRACT(YEAR FROM b.race_date) - COALESCE(b.birth_year, EXTRACT(YEAR FROM b.race_date))) AS horse_age,
            (CASE WHEN LOWER(COALESCE(b.horse_gender, '')) IN ('gelding', 'valack') THEN 1.0 ELSE 0.0 END) AS is_gelding,
            (CASE WHEN LOWER(COALESCE(b.horse_gender, '')) IN ('mare', 'sto') THEN 1.0 ELSE 0.0 END) AS is_mare,
            COALESCE(b.horse_record_time, 0) AS record_time_norm,
            (CASE WHEN COALESCE(b.shoe_change_front, false) OR COALESCE(b.shoe_change_back, false) THEN 1.0 ELSE 0.0 END) AS shoe_change_signal,
            LN(COALESCE(b.career_earnings, 1) + 1) AS career_earnings_log
        FROM Base b
        WHERE b.race_id IN ({race_filter})
    )
    SELECT * FROM Computed;
    """).df()
    
    con.close()
    print(f"[FEATURES] Beräknade features för {len(df)} starters")
    return df

# ======================================================================
# 4. SCORA MED LGBM OCH BERÄKNA EDGE
# ======================================================================

def score_and_save(df, race_ids):
    """Kör LGBM-modellen, beräkna edge, spara GULDTIPS/BEVAKNING."""
    if len(df) == 0:
        print("[WARN] Inga starters att scorea.")
        return
    
    # 5. Load model bundle (V3 Moonshot med ELO)
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models')
    bundle_path = os.path.join(models_dir, 'calibrator_v3_moonshot.pkl')
    try:
        calibrator_bundle = joblib.load(bundle_path)
        calibrator = calibrator_bundle['calibrator']
        gbm = calibrator_bundle['gbm']
        feature_cols = calibrator_bundle['features']
    except Exception as e:
        print(f"[ERROR] Kunde inte ladda modellen: {e}")
        return
        
    # Ladda historisk ELO
    elo_path = os.path.join(models_dir, 'elo_dict.pkl')
    try:
        elo_dict = joblib.load(elo_path)
    except:
        elo_dict = {}
        
    # Tillämpa ELO för varje häst (1500 om debutant/okänd)
    df['current_elo'] = df['horse_id'].apply(lambda x: elo_dict.get(x, 1500.0))
    
    # Beräkna field avg diff per lopp
    for race_id, group in df.groupby('race_id'):
        field_avg = group['current_elo'].mean()
        df.loc[group.index, 'elo_diff_from_field_avg'] = group['current_elo'] - field_avg
    
    # Log-odds
    safe_odds = df['odds'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else np.nan)
    df['log_odds'] = np.log(safe_odds)
    
    # Fyll saknade feature-kolumner med 0
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0
            
    # Prediktera
    X = df[feature_cols].copy()
    raw_preds = gbm.predict(X, num_iteration=gbm.best_iteration)
    df['model_prob'] = calibrator.predict(raw_preds)
    
    # Odds → market probability
    df['decimal_odds'] = df['odds'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else np.nan)
    df['market_prob'] = 1.0 / df['decimal_odds']
    
    # Edge
    df['edge'] = df['model_prob'] - df['market_prob']
    df['ev'] = (df['model_prob'] * (df['decimal_odds'] - 1)) - (1 - df['model_prob'])
    
    # Kelly
    df['kelly_fraction'] = 0.25 * (df['model_prob'] - ((1 - df['model_prob']) / (df['decimal_odds'] - 1)))
    df.loc[df['ev'] <= 0, 'kelly_fraction'] = 0
    
    # Tier: Per-race ranking — Topp-hästar med positiv edge
    # Rankar alla hästar per lopp efter modellens prediction
    # GULDTIPS: Topp 1 per lopp med edge > 0
    # BEVAKNING: Topp 2-3 per lopp med edge > 0
    df['rank_in_race'] = df.groupby('race_id')['model_prob'].rank(ascending=False, method='first')
    
    value_bets = df[
        (df['edge'] > 0) & (df['rank_in_race'] <= 3)
    ].copy()
    value_bets['tier'] = value_bets['rank_in_race'].apply(
        lambda r: 'GULDTIPS' if r == 1 else 'BEVAKNING'
    )
    
    # Hämta metadata (hästnamn, kusk, bana, loppnummer)
    conn = get_connection()
    cur = conn.cursor()
    
    starter_meta = {}
    for _, row in value_bets.iterrows():
        sid = row['starter_id']
        cur.execute("""
            SELECT rs.driver_name, rs.post_position, h.horse_name, r.track_name, r.race_number, r.race_date
            FROM race_starters rs
            JOIN horses h ON rs.horse_id = h.id
            JOIN races r ON rs.race_id = r.id
            WHERE rs.id = %s
        """, (sid,))
        meta = cur.fetchone()
        if meta:
            starter_meta[sid] = meta
    
    conn.close()
    
    # Bygg records
    records = []
    timestamp_now = datetime.datetime.now().isoformat()
    
    for _, row in value_bets.iterrows():
        sid = row['starter_id']
        meta = starter_meta.get(sid)
        if not meta:
            continue
        
        driver_name, post_pos, horse_name, track_name, race_number, race_date = meta
        
        records.append({
            "id": str(uuid.uuid4()),
            "race_id": row['race_id'],
            "starter_id": sid,
            "race_date": str(race_date)[:10] + "T00:00:00.000Z" if race_date else timestamp_now,
            "track_name": str(track_name),
            "race_number": int(race_number),
            "horse_name": str(horse_name),
            "driver_name": str(driver_name),
            "post_position": int(post_pos),
            "model_prob": float(row['model_prob']),
            "market_prob": float(row['market_prob']),
            "decimal_odds": float(row['decimal_odds']),
            "edge": float(row['edge']),
            "expected_value": float(row['ev']),
            "kelly_stake": float(row['kelly_fraction']),
            "tier": row['tier'],
            "computed_at": timestamp_now
        })
    
    # Ta bort gamla value_bets för dessa lopp och infoga nya
    engine = create_engine(DB_URL_SQLALCHEMY)
    with engine.begin() as conn:
        race_filter_sql = ",".join([f"'{rid}'" for rid in race_ids])
        conn.execute(text(f"DELETE FROM value_bets WHERE race_id IN ({race_filter_sql})"))
    
    if records and IS_POSTGRES:
        import psycopg2
        from psycopg2.extras import execute_batch
        pg_conn = psycopg2.connect(DB_URL_SQLALCHEMY.replace("postgresql+psycopg2://", "postgresql://"))
        cur = pg_conn.cursor()
        
        sql = """INSERT INTO value_bets 
            (id, race_id, starter_id, race_date, track_name, race_number, horse_name, driver_name, post_position, model_prob, market_prob, decimal_odds, edge, expected_value, kelly_stake, tier, created_at)
            VALUES (%(id)s, %(race_id)s, %(starter_id)s, %(race_date)s, %(track_name)s, %(race_number)s, %(horse_name)s, %(driver_name)s, %(post_position)s, %(model_prob)s, %(market_prob)s, %(decimal_odds)s, %(edge)s, %(expected_value)s, %(kelly_stake)s, %(tier)s, %(computed_at)s)
            ON CONFLICT DO NOTHING"""
        
        execute_batch(cur, sql, records)
        pg_conn.commit()
        cur.close()
        pg_conn.close()
    
    # Rapport
    guld = len([r for r in records if r['tier'] == 'GULDTIPS'])
    bev = len([r for r in records if r['tier'] == 'BEVAKNING'])
    
    print(f"\n{'='*50}")
    print(f"  PRE-RACE PREDICTIONS KLAR!")
    print(f"{'='*50}")
    print(f"  Starters analyserade:  {len(df)}")
    print(f"  Value Bets totalt:     {len(records)}")
    print(f"  GULDTIPS:              {guld}")
    print(f"  BEVAKNING:             {bev}")
    print(f"{'='*50}")
    
    # Skriv ut GULDTIPS
    if guld > 0:
        print(f"\n  {'GULDTIPS':}")
        for r in sorted(records, key=lambda x: -x['edge']):
            if r['tier'] == 'GULDTIPS':
                print(f"  >> {r['horse_name']} (Lopp {r['race_number']}, {r['track_name']})")
                print(f"     Modell: {r['model_prob']*100:.1f}% | Marknad: {r['market_prob']*100:.1f}% | Edge: {r['edge']*100:.1f}% | Odds: {r['decimal_odds']:.1f}")
    
    return records

# ======================================================================
# 5. FEATURES → DB (spara för API-åtkomst)
# ======================================================================

def save_features_to_db(df, race_ids):
    """Spara features till features-tabellen för API:t."""
    feature_cols = [
        'post_position', 'field_size', 'log_odds',
        'avg_km_time_last5', 'best_km_time_last10', 'days_since_last_race', 
        'starts_last_90_days', 'win_rate_last10', 'top3_rate_last10',
        'driver_win_rate_last30', 'driver_starts_last30', 'track_starts', 
        'track_win_rate', 'distance_starts',
        'class_change', 'days_since_last_win', 'avg_field_size_last5',
        'trainer_win_rate_last30', 'volt_start_indicator', 'distance_delta',
        'driver_horse_combo_winrate', 'avg_prize_last3', 'rest_optimal',
        'km_time_consistency', 'avg_position_last3',
        'driver_track_distance_winrate', 'trainer_change_flag',
        'comeback_signal', 'overperformance_flag',
        'barefoot_front', 'barefoot_score', 'gallop_rate_last5', 'sulky_american',
        'month_sin', 'month_cos', 'weekday', 'is_weekend_race',
        # Nya features (Fas 25)
        'horse_age', 'is_gelding', 'is_mare', 'record_time_norm',
        'shoe_change_signal', 'career_earnings_log'
    ]
    
    records = []
    timestamp_now = datetime.datetime.now().isoformat()
    
    for _, row in df.iterrows():
        for feat in feature_cols:
            feat_val = row.get(feat)
            final_val = float(feat_val) if pd.notnull(feat_val) else None
            records.append({
                "id": str(uuid.uuid4()),
                "race_id": row['race_id'],
                "starter_id": row['starter_id'],
                "feature_name": feat,
                "feature_value": final_val,
                "computed_at": timestamp_now,
                "look_ahead_cutoff_date": row['race_date'].isoformat() if isinstance(row['race_date'], datetime.datetime) else str(row['race_date'])
            })
    
    # Ta bort gamla features för dessa lopp
    engine = create_engine(DB_URL_SQLALCHEMY)
    race_filter_sql = ",".join([f"'{rid}'" for rid in race_ids])
    with engine.begin() as conn:
        conn.execute(text(f"DELETE FROM features WHERE race_id IN ({race_filter_sql})"))
    
    if IS_POSTGRES and records:
        import psycopg2
        from psycopg2.extras import execute_batch
        pg_conn = psycopg2.connect(DB_URL_SQLALCHEMY.replace("postgresql+psycopg2://", "postgresql://"))
        cur = pg_conn.cursor()
        
        sql = """INSERT INTO features 
            (id, race_id, starter_id, feature_name, feature_value, computed_at, look_ahead_cutoff_date)
            VALUES (%(id)s, %(race_id)s, %(starter_id)s, %(feature_name)s, %(feature_value)s, %(computed_at)s, %(look_ahead_cutoff_date)s)
            ON CONFLICT DO NOTHING"""
        
        BATCH_SIZE = 5000
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i+BATCH_SIZE]
            execute_batch(cur, sql, batch)
            pg_conn.commit()
        
        cur.close()
        pg_conn.close()
    
    print(f"[FEATURES] Sparade {len(records)} feature-rader för kommande lopp")


# ======================================================================
# MAIN
# ======================================================================

def main():
    print("="*60)
    print("  TRAV EDGE — PRE-RACE PREDICTION PIPELINE")
    print("="*60)
    
    # Bestäm datum att söka
    if len(sys.argv) > 1:
        target_dates = [sys.argv[1]]
    else:
        today = datetime.date.today()
        target_dates = [(today + datetime.timedelta(days=i)).isoformat() for i in range(4)]
    
    print(f"\n[1/4] Söker kommande spel för: {', '.join(target_dates)}")
    games = find_upcoming_games(target_dates)
    
    if not games:
        print("  Inga kommande bettable spel hittades.")
        return
    
    print(f"\n[2/4] Ingestar startlistor i databasen...")
    engine = create_engine(DB_URL_SQLALCHEMY)
    all_race_ids = []
    for game in games:
        race_ids = ingest_upcoming_game(game, engine)
        all_race_ids.extend(race_ids)
    
    if not all_race_ids:
        print("  Inga lopp att analysera.")
        return
    
    print(f"\n[3/4] Beräknar features för {len(all_race_ids)} lopp...")
    df = compute_features_for_races(all_race_ids)
    
    if len(df) == 0:
        print("  Inga features beräknade. Kontrollera att historisk data finns i databasen.")
        return
    
    # Beräkna log_odds (görs i Python, inte DuckDB — MÅSTE ske innan save & score)
    safe_odds = df['odds'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else np.nan)
    df['log_odds'] = np.log(safe_odds)
    
    # Spara features för API
    save_features_to_db(df, all_race_ids)
    
    print(f"\n[4/4] Kör LGBM-modellen och genererar GULDTIPS...")
    score_and_save(df, all_race_ids)
    
    print(f"\nKlar! Öppna dashboarden för att se prediksionerna.")

if __name__ == "__main__":
    main()
