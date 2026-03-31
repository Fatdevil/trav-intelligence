import os
import duckdb
import pandas as pd
import numpy as np
import datetime
import uuid
from sqlalchemy import create_engine, text
from config import DB_URL_SQLALCHEMY, DB_PATH, IS_POSTGRES

def compute_features():
    print("[FEATURES] Booting DuckDB Feature Engineering Engine...")
    
    # 1. Starta DuckDB och anslut till databasen.
    con = duckdb.connect()
    
    safe_db_path = DB_PATH.replace("file:", "")
    print(f"Laddar DuckDB-koppling mot: {safe_db_path}")

    if IS_POSTGRES:
        # PostgreSQL: Använd postgres_scanner extension
        try:
            con.execute("INSTALL postgres;")
        except: pass
        con.execute("LOAD postgres;")
        con.execute(f"ATTACH '{safe_db_path}' AS devdb (TYPE postgres);")
    else:
        # SQLite: Använd sqlite extension
        try:
            con.execute("INSTALL sqlite;")
        except: pass
        con.execute("LOAD sqlite;")
        con.execute(f"ATTACH '{safe_db_path}' AS devdb (TYPE sqlite);")

    # 2. Den gigantiska Sub-Query formeln. 
    # Med "Strict Temporal Isolation" (Look-Ahead Bias protection via < b.race_date).
    # Vi läser hela tabellen 'race_starters' kopplat med 'races'
    print("[FEATURES] Beraknar features for alla starters...")
    df = con.execute("""
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
            b.starter_id,
            b.race_id,
            b.horse_id,
            b.race_date,
            
            -- Statiska features för det aktuella loppet
            b.post_position,
            b.field_size,
            b.odds,

            -- Häst-Historik: KM-tider och Starter
            (SELECT AVG(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) AS avg_km_time_last5,
            (SELECT MIN(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 10)) AS best_km_time_last10,
            (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) AS days_since_last_race,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 90) AS starts_last_90_days,
            
            -- Häst-Historik: Fält och Klass
            (SELECT AVG(field_size) FROM (SELECT field_size FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 5)) AS avg_field_size_last5,
            (b.prize_money - (SELECT prize_money FROM (SELECT prize_money FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1))) AS class_change,
            
            -- Häst-Historik: Vinstprocent & Uppehåll
            (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.final_position = 1) AS days_since_last_win,
            (SELECT CAST(SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 10)) AS win_rate_last10,
            (SELECT CAST(SUM(CASE WHEN final_position IN (1,2,3) THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 10)) AS top3_rate_last10,
            
            -- Kusk och Tränar-Historik
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.driver_name = b.driver_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS driver_win_rate_last30,
            (SELECT COUNT(*) FROM Base h WHERE h.driver_name = b.driver_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS driver_starts_last30,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.trainer_name = b.trainer_name AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 30) AS trainer_win_rate_last30,
            
            -- Ban- och distanskomfort samt Startmetod
            (CASE WHEN b.start_type = 'V' THEN 1.0 ELSE 0.0 END) AS volt_start_indicator,
            (b.distance - (SELECT distance FROM (SELECT distance FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1))) AS distance_delta,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND h.track_name = b.track_name AND h.race_date < b.race_date) AS track_starts,
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND h.track_name = b.track_name AND h.race_date < b.race_date) AS track_win_rate,
            (SELECT COUNT(*) FROM Base h WHERE h.horse_id = b.horse_id AND ABS(h.distance - b.distance) <= 100 AND h.race_date < b.race_date) AS distance_starts,

            -- NYA FEATURES (Fas 8)
            -- 1. Ekipage-historik: Kusk+Hast vinstandel ihop
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM Base h WHERE h.horse_id = b.horse_id AND h.driver_name = b.driver_name AND h.race_date < b.race_date) AS driver_horse_combo_winrate,
            
            -- 2. Prispeng-trend: Stigande/sjunkande klass
            (SELECT AVG(prize_money) FROM (SELECT prize_money FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 3)) AS avg_prize_last3,
            
            -- 3. Optimal vila: 14-28 dagar = optimal (flagga)
            (CASE 
                WHEN (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) BETWEEN 14 AND 28 THEN 1.0
                ELSE 0.0 
             END) AS rest_optimal,
            
            -- 4. Konsistens: Standardavvikelse pa km-tid (lagre = mer konsistent)
            (SELECT STDDEV(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) AS km_time_consistency,
            
            -- 5. Placeringstrend: Forbattring i de senaste loppen (lagre = battre trend)
            (SELECT AVG(final_position) FROM (SELECT final_position FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.final_position > 0 ORDER BY h.race_date DESC LIMIT 3)) AS avg_position_last3,

            -- UNIKA EDGE-FEATURES (Fas 9) — Ingen konkurrent har dessa
            -- 6. Kusk-Bana-Distans korsinteraktion: Kuskens vinstandel pa JUST denna bana + distanstyp
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM Base h WHERE h.driver_name = b.driver_name AND h.track_name = b.track_name
             AND ABS(h.distance - b.distance) <= 100 AND h.race_date < b.race_date) AS driver_track_distance_winrate,
            
            -- 7. Tranarbyte-signal: Hasten har bytt tranare nyligen (senaste tranare != forsta tranare i historiken)
            (CASE WHEN b.trainer_name != (SELECT trainer_name FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date ASC LIMIT 1) THEN 1.0 ELSE 0.0 END) AS trainer_change_flag,
            
            -- 8. Comeback-effekt: Lang vila (>90d) + senaste lopp innan vila var topp-3
            (CASE WHEN 
                (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) > 90
                AND (SELECT final_position FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 1) <= 3
             THEN 1.0 ELSE 0.0 END) AS comeback_signal,
            
            -- 9. Overperformance-flagga: Vunnit 40%+ av senaste 5 trots mediokra km-tider (= regression signal)
            (CASE WHEN 
                (SELECT CAST(SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM (SELECT final_position FROM Base x WHERE x.horse_id = b.horse_id AND x.race_date < b.race_date ORDER BY x.race_date DESC LIMIT 5)) >= 0.4
                AND (SELECT AVG(km_time) FROM (SELECT km_time FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.km_time > 0 ORDER BY h.race_date DESC LIMIT 5)) > 
                    (SELECT AVG(km_time) FROM Base h WHERE h.km_time > 0 AND h.race_date < b.race_date AND DATE_DIFF('day', h.race_date, b.race_date) <= 90)
             THEN 1.0 ELSE 0.0 END) AS overperformance_flag,

            -- SKODATA & GALOPP (Fas 10) -- Det alla proffs vill ha
            -- 10. Barfota fram: Aktuellt lopp
            COALESCE(b.shoes_front, 0) AS barefoot_front,
            
            -- 11. Barfota-poang (0=skor, 1=barfota bak, 2=barfota runtom)
            (COALESCE(b.shoes_front, 0) + COALESCE(b.shoes_back, 0)) AS barefoot_score,
            
            -- 12. Galoppfrekvens senaste 5 lopp
            (SELECT CAST(SUM(CASE WHEN galloped = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM (SELECT galloped FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date ORDER BY h.race_date DESC LIMIT 5)) AS gallop_rate_last5,
            
            -- 13. Amerikansk sulky-flagga (jankar = snabbare)
            (CASE WHEN b.sulky_type = 'AM' THEN 1.0 ELSE 0.0 END) AS sulky_american,

            -- SASONGSFEATURES (Fas 15)
            -- 14. Cyklisk manad (sin/cos for att fanga sasongsmonstret)
            SIN(2 * 3.14159 * EXTRACT(MONTH FROM b.race_date) / 12.0) AS month_sin,
            COS(2 * 3.14159 * EXTRACT(MONTH FROM b.race_date) / 12.0) AS month_cos,
            
            -- 15. Veckodag (0=mandag, 5=lordag=V75, 2=onsdag=V86)
            EXTRACT(DOW FROM b.race_date) AS weekday,
            
            -- 16. Storlopp-flagga (lordag = V75/V86 huvuddag)
            (CASE WHEN EXTRACT(DOW FROM b.race_date) IN (6, 0) THEN 1.0 ELSE 0.0 END) AS is_weekend_race,

            -- NYA FEATURES (Fas 25)
            -- 17. Häst-ålder (beräknad från födelseår)
            (EXTRACT(YEAR FROM b.race_date) - COALESCE(b.birth_year, EXTRACT(YEAR FROM b.race_date))) AS horse_age,
            
            -- 18. Kön-flaggor (valack = gelding, sto = mare)
            (CASE WHEN LOWER(COALESCE(b.horse_gender, '')) IN ('gelding', 'valack') THEN 1.0 ELSE 0.0 END) AS is_gelding,
            (CASE WHEN LOWER(COALESCE(b.horse_gender, '')) IN ('mare', 'sto') THEN 1.0 ELSE 0.0 END) AS is_mare,
            
            -- 19. Rekordtid normaliserad (lägre = snabbare häst)
            COALESCE(b.horse_record_time, 0) AS record_time_norm,
            
            -- 20. Skobyte-signal (byte = formindikator)
            (CASE WHEN COALESCE(b.shoe_change_front, false) OR COALESCE(b.shoe_change_back, false) THEN 1.0 ELSE 0.0 END) AS shoe_change_signal,
            
            -- 21. Karriärintjäning (log-transformerad)
            LN(COALESCE(b.career_earnings, 1) + 1) AS career_earnings_log,

            -- TIDS-VIKTADE FEATURES (Fas 30) — Skiljer "het nu" från "gammal form"
            -- 22. Form senaste 90 dagar (vinstprocent bara inom 3 mån)
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date
             AND DATE_DIFF('day', h.race_date, b.race_date) <= 90) AS form_last_90d,
            
            -- 23. Form senaste 365 dagar
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date
             AND DATE_DIFF('day', h.race_date, b.race_date) <= 365) AS form_last_365d,
            
            -- 24. Recency-viktat placeringsscore (nyare lopp väger exponentiellt mer)
            (SELECT SUM(
                (CASE WHEN h.final_position <= 3 THEN 1.0 ELSE 0.0 END) 
                * POWER(0.9, ROW_NUMBER() OVER (ORDER BY h.race_date DESC) - 1)
             ) / NULLIF(SUM(POWER(0.9, ROW_NUMBER() OVER (ORDER BY h.race_date DESC) - 1)), 0)
             FROM (SELECT final_position, race_date FROM Base h 
                   WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date AND h.final_position > 0
                   ORDER BY h.race_date DESC LIMIT 10) h) AS recency_weighted_score,
            
            -- 25. Placeringstrend (slope: negativ = förbättring, positiv = försämring)
            (SELECT (COUNT(*) * SUM(rn * pos) - SUM(rn) * SUM(pos)) / 
                    NULLIF(COUNT(*) * SUM(rn * rn) - SUM(rn) * SUM(rn), 0)
             FROM (SELECT final_position AS pos, ROW_NUMBER() OVER (ORDER BY race_date DESC) AS rn
                   FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date 
                   AND h.final_position > 0 ORDER BY h.race_date DESC LIMIT 5) sub) AS position_trend,
            
            -- 26. Comeback-flagga (tillbaka efter 180+ dagars uppehåll)
            (CASE WHEN (SELECT DATE_DIFF('day', MAX(h.race_date), b.race_date) 
                        FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date) > 180 
             THEN 1.0 ELSE 0.0 END) AS comeback_flag

        FROM Base b
    )
    SELECT * FROM Computed;
    """).df()
    
    print(f"[FEATURES] Skapade raa features for {len(df)} startande.")
    
    # 3. Clean up. Vi behåller NaN så att SQL databasen får NULL-värden. LightGBM hanterar NULL nativt.
    # Log-odds calculation.
    safe_odds = df['odds'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else np.nan) 
    df['log_odds'] = np.log(safe_odds)

    # 4. Omvandla till Long Format (Key-Value) för Prisma-databasen
    print("[FEATURES] Translating to Long-Format db insertion...")
    feature_columns = [
        'post_position', 'field_size', 'log_odds',
        'avg_km_time_last5', 'best_km_time_last10', 'days_since_last_race', 
        'starts_last_90_days', 'win_rate_last10', 'top3_rate_last10',
        'driver_win_rate_last30', 'driver_starts_last30', 'track_starts', 
        'track_win_rate', 'distance_starts',
        'class_change', 'days_since_last_win', 'avg_field_size_last5',
        'trainer_win_rate_last30', 'volt_start_indicator', 'distance_delta',
        # Nya features (Fas 8)
        'driver_horse_combo_winrate', 'avg_prize_last3', 'rest_optimal',
        'km_time_consistency', 'avg_position_last3',
        # Unika edge-features (Fas 9)
        'driver_track_distance_winrate', 'trainer_change_flag',
        'comeback_signal', 'overperformance_flag',
        # Sko- och galoppdata (Fas 10)
        'barefoot_front', 'barefoot_score', 'gallop_rate_last5', 'sulky_american',
        # Sasongsfeatures (Fas 15)
        'month_sin', 'month_cos', 'weekday', 'is_weekend_race',
        # Nya features (Fas 25)
        'horse_age', 'is_gelding', 'is_mare', 'record_time_norm',
        'shoe_change_signal', 'career_earnings_log'
    ]
    
    records_to_insert = []
    timestamp_now = datetime.datetime.now().isoformat()
    
    for _, row in df.iterrows():
        for feat in feature_columns:
            feat_val = row[feat]
            final_val = float(feat_val) if pd.notnull(feat_val) else None
            
            records_to_insert.append({
                "id": str(uuid.uuid4()),
                "race_id": row['race_id'],
                "starter_id": row['starter_id'],
                "feature_name": feat,
                "feature_value": final_val,
                "computed_at": timestamp_now,
                "look_ahead_cutoff_date": row['race_date'].isoformat() if isinstance(row['race_date'], datetime.datetime) else str(row['race_date'])
            })
    
    print(f"[FEATURES] Infogar {len(records_to_insert)} rader i features-tabellen...")
    engine = create_engine(DB_URL_SQLALCHEMY)
    
    # Töm gamla features
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM features"))
    
    if IS_POSTGRES:
        # Direkt psycopg2 för snabb batch-insert med reconnect
        import psycopg2
        from psycopg2.extras import execute_batch
        import time
        
        db_url = DB_URL_SQLALCHEMY.replace("postgresql+psycopg2://", "postgresql://")
        
        sql = """INSERT INTO features 
            (id, race_id, starter_id, feature_name, feature_value, computed_at, look_ahead_cutoff_date)
            VALUES (%(id)s, %(race_id)s, %(starter_id)s, %(feature_name)s, %(feature_value)s, %(computed_at)s, %(look_ahead_cutoff_date)s)
            ON CONFLICT DO NOTHING"""
        
        BATCH_SIZE = 2000
        RECONNECT_EVERY = 10  # Reconnect every 10 batches
        total = len(records_to_insert)
        batch_count = 0
        pg_conn = None
        cur = None
        
        for i in range(0, total, BATCH_SIZE):
            # Reconnect periodically to avoid Neon timeout
            if batch_count % RECONNECT_EVERY == 0:
                if pg_conn:
                    try:
                        cur.close()
                        pg_conn.close()
                    except:
                        pass
                pg_conn = psycopg2.connect(db_url)
                cur = pg_conn.cursor()
            
            batch = records_to_insert[i:i+BATCH_SIZE]
            
            try:
                execute_batch(cur, sql, batch)
                pg_conn.commit()
            except Exception as e:
                print(f"  [RETRY] Batch {i} failed: {e}")
                try:
                    pg_conn.close()
                except:
                    pass
                time.sleep(2)
                pg_conn = psycopg2.connect(db_url)
                cur = pg_conn.cursor()
                try:
                    execute_batch(cur, sql, batch)
                    pg_conn.commit()
                except Exception as e2:
                    print(f"  [SKIP] Batch {i} skipped: {e2}")
            
            batch_count += 1
            if batch_count % 5 == 0:
                print(f"  [BATCH] {min(i+BATCH_SIZE, total)}/{total} rader insatta")
        
        if pg_conn:
            try:
                cur.close()
                pg_conn.close()
            except:
                pass
    else:
        # SQLite: original SQLAlchemy approach
        sql_feature = text("""
            INSERT OR IGNORE INTO features 
            (id, race_id, starter_id, feature_name, feature_value, computed_at, look_ahead_cutoff_date)
            VALUES (:id, :race_id, :starter_id, :feature_name, :feature_value, :computed_at, :look_ahead_cutoff_date)
        """)
        with engine.begin() as conn:
            conn.execute(sql_feature, records_to_insert)

    print("[DONE] FEATURIZATION COMPLETE!")
    
if __name__ == "__main__":
    compute_features()

