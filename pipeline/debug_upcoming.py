"""Quick debug: Compare features for upcoming vs historical, check model sanity."""
import sys; sys.path.insert(0, '.')
import pandas as pd, numpy as np, joblib, os
from config import get_connection

conn = get_connection()

# Get a historical starter with known good probability
hist = pd.read_sql("""
    SELECT f.starter_id, f.feature_name, f.feature_value
    FROM features f JOIN races r ON f.race_id = r.id
    WHERE r.race_date < '2026-03-30'
    AND f.starter_id = (SELECT starter_id FROM features WHERE feature_name = 'log_odds' AND feature_value IS NOT NULL LIMIT 1)
""", conn)

# Get an upcoming starter  
upcoming = pd.read_sql("""
    SELECT f.starter_id, f.feature_name, f.feature_value
    FROM features f JOIN races r ON f.race_id = r.id
    WHERE r.race_date >= '2026-03-30'
    AND f.starter_id = (
        SELECT f2.starter_id FROM features f2 JOIN races r2 ON f2.race_id = r2.id
        WHERE r2.race_date >= '2026-03-30' AND f2.feature_name = 'log_odds' AND f2.feature_value IS NOT NULL
        LIMIT 1
    )
""", conn)
conn.close()

if len(hist) > 0:
    hist_pivot = hist.pivot(index='starter_id', columns='feature_name', values='feature_value').reset_index()
    print("HISTORICAL features:")
    for col in sorted(hist_pivot.columns):
        if col != 'starter_id':
            print(f"  {col:35s}: {hist_pivot[col].iloc[0]}")

if len(upcoming) > 0:
    up_pivot = upcoming.pivot(index='starter_id', columns='feature_name', values='feature_value').reset_index()
    print("\nUPCOMING features:")
    for col in sorted(up_pivot.columns):
        if col != 'starter_id':
            print(f"  {col:35s}: {up_pivot[col].iloc[0]}")
    
    # Score both individually
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models')
    cal = joblib.load(os.path.join(models_dir, 'calibrator_v1.pkl'))
    
    feat_cols = sorted([c for c in hist_pivot.columns if c != 'starter_id'])
    
    if len(hist) > 0:
        X_h = hist_pivot[feat_cols]
        p_h = cal.predict_proba(X_h)[:, 1]
        print(f"\nHistorical prob: {p_h[0]*100:.1f}%")
    
    X_u = up_pivot[feat_cols]
    p_u = cal.predict_proba(X_u)[:, 1]
    print(f"Upcoming prob:   {p_u[0]*100:.1f}%")
