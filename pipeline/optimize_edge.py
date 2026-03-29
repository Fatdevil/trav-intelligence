"""
Edge Threshold Optimizer — Hittar optimal minsta edge for positiv ROI.
Testar alla edge-trosklar fran 1% till 30% i steg om 0.5%.
"""
import os
import sqlite3
import pandas as pd
import numpy as np
import joblib
from config import DB_PATH

def run_optimizer():
    print("[OPTIMIZER] Booting Edge Threshold Optimizer...")
    db_path = DB_PATH.replace("file:", "")
    conn = sqlite3.connect(db_path)
    
    # 1. Laddda Wide Matrix
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
    
    if len(df_long) == 0:
        print("[ERROR] Ingen data")
        return

    # 2. Pivot
    metadata_cols = ['race_id', 'starter_id', 'final_position', 'race_date', 'odds_final', 'track_name', 'race_number', 'horse_name', 'driver_name']
    df_wide = df_long.pivot(index=metadata_cols, columns='feature_name', values='feature_value').reset_index()
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    start_date = df_wide['race_date'].min()
    
    # 3. Walk-forward val
    val_mask = df_wide['race_date'] > (start_date + pd.Timedelta(days=120))
    df_val = df_wide[val_mask].copy()
    df_val = df_val.dropna(subset=['odds_final'])
    df_val = df_val[df_val['odds_final'] > 1.0]
    
    # 4. Load calibrator & predict
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models')
    calibrator = joblib.load(os.path.join(models_dir, 'calibrator_v1.pkl'))
    feature_cols = [c for c in df_wide.columns if c not in metadata_cols]

    df_val['model_prob'] = calibrator.predict_proba(df_val[feature_cols])[:, 1]
    df_val['market_prob'] = 1.0 / df_val['odds_final']
    df_val['edge'] = df_val['model_prob'] - df_val['market_prob']
    df_val['ev'] = (df_val['model_prob'] * (df_val['odds_final'] - 1)) - (1 - df_val['model_prob'])
    df_val['won'] = (df_val['final_position'] == 1).astype(int)
    df_val['payout'] = df_val['won'] * df_val['odds_final']
    
    # 5. Testa alla trosklar
    print("")
    print("=" * 70)
    print(f"{'EDGE MIN':>10} | {'BETS':>6} | {'WIN%':>8} | {'AVG ODDS':>9} | {'ROI':>10} | {'PROFIT/BET':>11}")
    print("=" * 70)
    
    results = []
    best_roi = -999
    best_threshold = 0
    
    for pct in np.arange(1.0, 30.5, 0.5):
        edge_min = pct / 100.0
        subset = df_val[(df_val['edge'] > edge_min) & (df_val['ev'] > 0.05)]
        
        n = len(subset)
        if n < 20:  # Minimum sample size
            continue
            
        wins = subset['won'].sum()
        win_rate = wins / n if n > 0 else 0
        avg_odds = subset['odds_final'].mean()
        total_payout = subset['payout'].sum()
        roi = (total_payout - n) / n if n > 0 else 0
        profit_per_bet = (total_payout - n) / n * 100 if n > 0 else 0
        
        marker = ""
        if roi > 0:
            marker = " <-- POSITIV"
        if roi > best_roi and n >= 30:
            best_roi = roi
            best_threshold = pct
            
        results.append({
            'edge_min': pct,
            'bets': n,
            'win_rate': win_rate,
            'avg_odds': avg_odds,
            'roi': roi
        })
        
        print(f"{pct:>8.1f}% | {n:>6} | {win_rate:>7.2%} | {avg_odds:>9.2f} | {roi:>+9.2%} |  {profit_per_bet:>+8.1f}kr{marker}")
    
    print("=" * 70)
    print(f"\n[RESULTAT] Basta edge-troskel (min 30 bets): {best_threshold:.1f}%")
    print(f"[RESULTAT] ROI vid optimal troskel: {best_roi:+.2%}")
    
    # 6. Visa basta bets vid optimal troskel
    optimal = df_val[(df_val['edge'] > best_threshold/100) & (df_val['ev'] > 0.05)].copy()
    print(f"\n[OPTIMAL] Antal bets: {len(optimal)}")
    print(f"[OPTIMAL] Vinstfrekvens: {optimal['won'].mean():.2%}")
    print(f"[OPTIMAL] Snittodds: {optimal['odds_final'].mean():.2f}")
    
    # Stabilitet: Visa ROI per kvartal vid optimal troskel
    print("\n--- ROI per kvartal (stabilitetscheck) ---")
    optimal['quarter'] = optimal['race_date'].dt.to_period('Q')
    for q, grp in optimal.groupby('quarter'):
        q_n = len(grp)
        q_payout = grp['payout'].sum()
        q_roi = (q_payout - q_n) / q_n if q_n > 0 else 0
        print(f"  {q}: {q_n} bets, ROI {q_roi:+.2%}")

if __name__ == "__main__":
    run_optimizer()
