import pandas as pd
import duckdb
from config import get_connection
import os
from features import generate_duckdb_features

def run():
    print("[HISTORICAL] Fetching all races from Postgres...")
    conn = get_connection()
    query = """
    SELECT rs.id as starter_id, r.id as race_id, rs.horse_id, rs.driver_name, r.trainer_name as trainer_name,
           r.track_name, r.distance, r.race_date, rs.final_position, rs.prize_money, rs.km_time,
           r.start_type, rs.galloped, r.race_number, r.prize,
           h.gender as horse_gender, h.record_time as horse_record_time,
           rs.shoes_front_changed as shoe_change_front, rs.shoes_back_changed as shoe_change_back,
           h.career_earnings, rs.shoes_front, rs.shoes_back, rs.sulky_type
    FROM race_starters rs
    JOIN races r ON rs.race_id = r.id
    JOIN horses h ON rs.horse_id = h.id
    """
    df_base = pd.read_sql(query, conn)
    conn.close()
    
    print(f"[HISTORICAL] Loaded {len(df_base)} raw starters. Generating features via DuckDB...")
    
    # We apply generate_duckdb_features which runs that massive SQL query
    df_features = generate_duckdb_features(df_base)
    
    print(f"[HISTORICAL] Computed features for {len(df_features)} starters.")
    
    # Save to parquet locally
    out_path = os.path.join(os.path.dirname(__file__), "historical_features.parquet")
    df_features.to_parquet(out_path)
    print(f"[HISTORICAL] Saved to {out_path}!")

if __name__ == '__main__':
    run()
