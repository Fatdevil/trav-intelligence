import os
import pandas as pd
import numpy as np
import joblib
import datetime
import uuid
from config import DB_URL_SQLALCHEMY, get_connection
from sqlalchemy import create_engine, text
import warnings
warnings.filterwarnings("ignore")

def run_value_calculator():
    conn = get_connection()
    
    # 1. Läs hela Wide Matrix + Label data + Metadata
    query = """
    SELECT 
        f.race_id, f.starter_id, f.feature_name, f.feature_value, 
        rs.final_position, r.race_date, rs.odds_final, r.track_name, r.race_number,
        h.horse_name, rs.driver_name
    FROM features f
    JOIN race_starters rs ON f.starter_id = rs.id
    JOIN races r ON f.race_id = r.id
    JOIN horses h ON rs.horse_id = h.id;
    """
    df_long = pd.read_sql(query, conn)
    conn.close()
    
    if len(df_long) == 0: return

    # 2. Pivot till Wide Format
    print("[VALUE] Pivoterar data...")
    metadata_cols = ['race_id', 'starter_id', 'final_position', 'race_date', 'odds_final', 'track_name', 'race_number', 'horse_name', 'driver_name']
    df_wide = df_long.pivot(index=metadata_cols, columns='feature_name', values='feature_value').reset_index()
    
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    start_date = df_wide['race_date'].min()
    
    # 3. Filtrera Endast Valideringsperioden (Walk-Forward out-of-sample)
    val_mask = df_wide['race_date'] > (start_date + pd.Timedelta(days=365))
    df_val = df_wide[val_mask].copy()
    
    # Rensa trasiga odds
    df_val = df_val.dropna(subset=['odds_final'])
    df_val = df_val[df_val['odds_final'] > 1.0]
    
    if len(df_val) == 0:
        print("[ERROR] Ingen valideringsdata med giltiga odds hittades.")
        return

    # 4. Ladda kalibrerade modellen och prediktera
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models')
    calibrator = joblib.load(os.path.join(models_dir, 'calibrator_v1.pkl'))
    feature_cols = [c for c in df_wide.columns if c not in metadata_cols]
    
    print("[VALUE] Genererar kalibrerade vinstchanser...")
    df_val['calibrated_prob'] = calibrator.predict_proba(df_val[feature_cols])[:, 1]
    
    # 5. Kalkylera Värde & Edge
    df_val['decimal_odds'] = df_val['odds_final']
    df_val['market_prob'] = 1.0 / df_val['decimal_odds']
    
    df_val['edge'] = df_val['calibrated_prob'] - df_val['market_prob']
    df_val['ev'] = (df_val['calibrated_prob'] * (df_val['decimal_odds'] - 1)) - (1 - df_val['calibrated_prob'])
    
    # Quarter-Kelly
    df_val['kelly_fraction'] = 0.25 * (df_val['calibrated_prob'] - ((1 - df_val['calibrated_prob']) / (df_val['decimal_odds'] - 1)))
    df_val.loc[df_val['ev'] <= 0, 'kelly_fraction'] = 0
    
    # 6. Flagga Value Bets med 2-tier system (365d RAW LGBM, verifierat Fas 17)
    # GULDTIPS: edge >= 5% = +9.57% ROI i 3-way OOS (195 bets)
    # BEVAKNING: edge 3-5% = +3.30% ROI i 3-way OOS (189 bets)
    value_bets = df_val[(df_val['edge'] > 0.03) & (df_val['ev'] > 0.01)].copy()
    value_bets['tier'] = value_bets['edge'].apply(lambda e: 'GULDTIPS' if e >= 0.05 else 'BEVAKNING')
    
    # 7. Spara till Databasen
    print("[VALUE] Sparar Value Bets till databasen...")
    records_to_insert = []
    timestamp_now = datetime.datetime.now().isoformat()
    
    for _, row in value_bets.iterrows():
        records_to_insert.append({
            "id": str(uuid.uuid4()),
            "race_id": row['race_id'],
            "starter_id": row['starter_id'],
            "race_date": str(row['race_date'].date()) + "T00:00:00.000Z",
            "track_name": str(row['track_name']),
            "race_number": int(row['race_number']),
            "horse_name": str(row['horse_name']),
            "driver_name": str(row['driver_name']),
            "post_position": int(row['post_position']),
            "model_prob": float(row['calibrated_prob']),
            "market_prob": float(row['market_prob']),
            "decimal_odds": float(row['decimal_odds']),
            "edge": float(row['edge']),
            "expected_value": float(row['ev']),
            "kelly_stake": float(row['kelly_fraction']),
            "tier": row['tier'],
            "computed_at": timestamp_now
        })
        
    engine = create_engine(DB_URL_SQLALCHEMY)
    insert_clause = "INSERT OR IGNORE" if "sqlite" in DB_URL_SQLALCHEMY.lower() else "INSERT"
    conflict_clause = "ON CONFLICT DO NOTHING" if "postgres" in DB_URL_SQLALCHEMY.lower() else ""

    sql_value = text(f"""
        {insert_clause} INTO value_bets 
        (id, race_id, starter_id, race_date, track_name, race_number, horse_name, driver_name, post_position, model_prob, market_prob, decimal_odds, edge, expected_value, kelly_stake, tier, created_at)
        VALUES (:id, :race_id, :starter_id, :race_date, :track_name, :race_number, :horse_name, :driver_name, :post_position, :model_prob, :market_prob, :decimal_odds, :edge, :expected_value, :kelly_stake, :tier, :computed_at)
        {conflict_clause}
    """)

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM value_bets")) 
        if records_to_insert:
            conn.execute(sql_value, records_to_insert)
            
    # 8. Rapportera ROI Matrix
    total_bets = len(value_bets)
    win_rate = value_bets['final_position'].apply(lambda x: 1 if x == 1 else 0).mean() if total_bets > 0 else 0
    avg_odds = value_bets['decimal_odds'].mean() if total_bets > 0 else 0

    value_bets['payout'] = value_bets.apply(lambda r: r['decimal_odds'] if r['final_position'] == 1 else 0, axis=1)
    roi = (value_bets['payout'].sum() - total_bets) / total_bets if total_bets > 0 else 0

    # Kelly-sizing ROI: Quarter-Kelly proportional betting
    value_bets['kelly_safe'] = value_bets['kelly_fraction'].clip(lower=0, upper=0.15)  # Cap at 15% bankroll
    kelly_stakes = value_bets['kelly_safe'] / value_bets['kelly_safe'].sum()  # Normalize to sum=1
    kelly_payouts = value_bets['payout'] * kelly_stakes * total_bets  # Scale by total bet count
    kelly_costs = kelly_stakes * total_bets
    kelly_roi = (kelly_payouts.sum() - kelly_costs.sum()) / kelly_costs.sum() if kelly_costs.sum() > 0 else 0

    print("\n" + "="*40)
    print("[REPORT] VALUE BETTING BACKTEST RAPPORT")
    print("="*40)
    print(f"Bettade Lopp/Hastar under validering: {total_bets}")
    print(f"Verklig Vinstfrekvens:                {win_rate:.2%}")
    print(f"Genomsnittligt Odds:                  {avg_odds:.2f}")
    
    implied_win_req = (1 / avg_odds) if avg_odds > 0 else 0
    print("-" * 40)
    print(f"[ROI] Flat-Stake ROI:                   {roi:+.2%}")
    print(f"[ROI] Quarter-Kelly ROI:                {kelly_roi:+.2%}")
    print("="*40)

    # 9. Tiered Report
    gold = value_bets[value_bets['tier'] == 'GULDTIPS']
    silver = value_bets[value_bets['tier'] == 'BEVAKNING']
    if len(gold) > 0:
        gw = gold['final_position'].apply(lambda x: 1 if x == 1 else 0).mean()
        gp = gold.apply(lambda r: r['decimal_odds'] if r['final_position'] == 1 else 0, axis=1)
        gr = (gp.sum() - len(gold)) / len(gold)
        # GULDTIPS-only Kelly
        gk = gold['kelly_safe'] / gold['kelly_safe'].sum()
        gk_pay = gp * gk * len(gold)
        gk_cost = gk * len(gold)
        gk_roi = (gk_pay.sum() - gk_cost.sum()) / gk_cost.sum() if gk_cost.sum() > 0 else 0
        print(f"\n[GULDTIPS]   {len(gold):>4} bets | Win: {gw:.1%} | Flat ROI: {gr:+.2%} | Kelly ROI: {gk_roi:+.2%}")
    if len(silver) > 0:
        sw = silver['final_position'].apply(lambda x: 1 if x == 1 else 0).mean()
        sp = silver.apply(lambda r: r['decimal_odds'] if r['final_position'] == 1 else 0, axis=1)
        sr = (sp.sum() - len(silver)) / len(silver)
        print(f"[BEVAKNING] {len(silver):>4} bets | Win: {sw:.1%} | ROI: {sr:+.2%}")

if __name__ == "__main__":
    run_value_calculator()
