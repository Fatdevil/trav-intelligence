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
            
            -- Statiska features och Grund-Metadata för det aktuella loppet
            b.post_position,
            b.field_size,
            b.odds,
            b.final_position,
            b.distance,

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

            -- VÄRLDSKLASS EDGE-FEATURES (Fas 40 - Moonshot)
            -- 14. Driver-Trainer Synergy Winrate: Deras gemensamma historiska vinstprocent
            (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
             FROM Base h WHERE h.driver_name = b.driver_name AND h.trainer_name = b.trainer_name AND h.race_date < b.race_date) AS driver_trainer_synergy_winrate,
             
            -- 15. Distance Specialist Delta: Hästens Vinst% på EXAKT denna distans minus dens Vinst% oavsett distans
            (
                (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND ABS(h.distance - b.distance) <= 100 AND h.race_date < b.race_date)
                -
                (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND h.race_date < b.race_date)
            ) AS distance_specialist_delta,
            
            -- 16. Barefoot Delta: Skillnad i vinstprocent när hästen är barfota vs med skor
            (
                (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND ((COALESCE(h.shoes_front, 0) + COALESCE(h.shoes_back, 0)) >= 1) AND h.race_date < b.race_date)
                -
                (SELECT CAST(SUM(CASE WHEN h.final_position = 1 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) FROM Base h WHERE h.horse_id = b.horse_id AND ((COALESCE(h.shoes_front, 0) + COALESCE(h.shoes_back, 0)) = 0) AND h.race_date < b.race_date)
            ) AS horse_barefoot_delta,


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
            
            -- 24. Recency-viktat placeringsscore (nyare = bättre, 0.9^rn decay)
            (SELECT SUM(CASE WHEN pos <= 3 THEN 1.0 ELSE 0.0 END * POWER(0.9, rn - 1))
                  / NULLIF(SUM(POWER(0.9, rn - 1)), 0)
             FROM (SELECT final_position AS pos,
                          ROW_NUMBER() OVER (ORDER BY race_date DESC) AS rn
                   FROM Base h2
                   WHERE h2.horse_id = b.horse_id AND h2.race_date < b.race_date
                     AND h2.final_position > 0
                   ORDER BY h2.race_date DESC LIMIT 10) sub) AS recency_weighted_score,
            
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
    
    print("[FEATURES] Beraknar Elo Rating (Chronological Loop)...")
    # Sortera df strikt kronologiskt for den rekursiva ELO-motorn
    df = df.sort_values(by=['race_date', 'race_id'])
    
    elo_dict = {}
    K = 32.0 # Standard maximal aggresiv K-faktor for snabb anpassning
    
    # Initiera nya kolumner
    df['current_elo'] = 1500.0
    df['elo_diff_from_field_avg'] = 0.0
    
    # GroupBy bevarar ordningen nar DataFrame redans sorterats
    for race_id, group in df.groupby('race_id', sort=False):
        indices = group.index
        horses = group['horse_id'].values
        positions = group['final_position'].values
        
        # 1. Hamta pre-race ELO
        current_elos = np.array([elo_dict.get(h, 1500.0) for h in horses])
        df.loc[indices, 'current_elo'] = current_elos
        
        # 2. Berakna field avg diff (Sjuk margin edge!)
        field_avg = np.mean(current_elos) if len(current_elos) > 0 else 1500.0
        df.loc[indices, 'elo_diff_from_field_avg'] = current_elos - field_avg
        
        # 3. Kalkylera ny ELO (bara om loppet ar avgjort historiskt)
        has_results = any((pd.notnull(p) and p > 0) for p in positions)
        if has_results:
            n = len(horses)
            if n > 1:
                new_elos = current_elos.copy()
                for i in range(n):
                    pos_i = positions[i]
                    # Oplacerad, diskad, eller galopp fallbacks
                    if pd.isnull(pos_i) or pos_i == 0: pos_i = 99
                    
                    for j in range(n):
                        if i == j: continue
                        pos_j = positions[j]
                        if pd.isnull(pos_j) or pos_j == 0: pos_j = 99
                        
                        # Vinnar-Score calculation
                        if pos_i < pos_j: S = 1.0
                        elif pos_i > pos_j: S = 0.0
                        else: S = 0.5
                        
                        # Expected ELO Score
                        E = 1.0 / (1.0 + 10.0 ** ((current_elos[j] - current_elos[i]) / 400.0))
                        
                        # Justerad K for parvis mattning
                        K_adj = K / (n - 1)
                        new_elos[i] += K_adj * (S - E)
                
                # Skriv tillbaka uppdaterad ELO till minnet for nasta vecka
                for i, h in enumerate(horses):
                    elo_dict[h] = new_elos[i]

    print("[FEATURES] ELO-Räkning Slutförd!")
    
    # Exporterar den sanna ELO-listan for morgondagens lopp
    import joblib
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models')
    os.makedirs(models_dir, exist_ok=True)
    joblib.dump(elo_dict, os.path.join(models_dir, 'elo_dict.pkl'))

    # 3. Clean up. Vi behåller NaN så att SQL databasen får NULL-värden. LightGBM hanterar NULL nativt.
    # Log-odds calculation.
    safe_odds = df['odds'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else np.nan) 
    df['log_odds'] = np.log(safe_odds)

    # 4. Spara till lokal Parquet-fil för att träna LightGBM utanför Neon PostgreSQL-gränsen
    print("[FEATURES] Sparar till features_v2.parquet...")
    
    # Vi behöver pivota 'df' till Long-Format först? NEJ! Träningen kan ske DIREKT på Wide-format om vi sparar hela df
    df.to_parquet('features_v2_moonshot.parquet')
    print("[DONE] FEATURIZATION (PARQUET) COMPLETE!")
    
if __name__ == "__main__":
    compute_features()

