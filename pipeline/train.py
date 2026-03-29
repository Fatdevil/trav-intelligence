import os
import pandas as pd
import numpy as np
import lightgbm as lgb
import joblib
from sklearn.metrics import log_loss, brier_score_loss
import warnings
from config import get_connection

warnings.filterwarnings("ignore")

def train_model():
    conn = get_connection()
    
    query = """
    SELECT 
        f.race_id, f.starter_id, f.feature_name, f.feature_value, 
        rs.final_position, r.race_date 
    FROM features f
    JOIN race_starters rs ON f.starter_id = rs.id
    JOIN races r ON f.race_id = r.id;
    """
    df_long = pd.read_sql(query, conn)
    conn.close()
    
    if len(df_long) == 0:
        print("[ERROR] Inga features hittades. Kor features.py forst!")
        return

    print("[TRAIN] Pivoting to Wide Matrix...")
    df_wide = df_long.pivot(
        index=['race_id', 'starter_id', 'final_position', 'race_date'], 
        columns='feature_name', 
        values='feature_value'
    ).reset_index()
    
    df_wide['y'] = (df_wide['final_position'] == 1).astype(int)
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    df_wide = df_wide.sort_values('race_date')
    
    start_date = df_wide['race_date'].min()
    split_date = start_date + pd.Timedelta(days=365)
    
    train_mask = df_wide['race_date'] <= split_date
    val_mask = df_wide['race_date'] > split_date
    
    feature_cols = [c for c in df_wide.columns if c not in ['race_id', 'starter_id', 'final_position', 'race_date', 'y']]
    
    X_train = df_wide.loc[train_mask, feature_cols]
    y_train = df_wide.loc[train_mask, 'y']
    X_val = df_wide.loc[val_mask, feature_cols]
    y_val = df_wide.loc[val_mask, 'y']
    
    print(f"[TRAIN] Training matrix shapes: X_train={X_train.shape}, X_val={X_val.shape}")
    
    train_pos_rate = y_train.mean()
    val_pos_rate = y_val.mean()
    
    # === RAW LightGBM — verifierat bast i 3-way OOS test (Fas 17) ===
    # Ingen kalibrering — raw probabilities ger +9.57% ROI i true OOS
    print("[TRAIN] LightGBM RAW (tuned, no calibration)...")
    model = lgb.LGBMClassifier(
        objective='binary', n_estimators=1000, learning_rate=0.1,
        num_leaves=15, min_child_samples=50, reg_alpha=1.0, reg_lambda=1.0,
        subsample=0.85, colsample_bytree=1.0, random_state=42
    )
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)],
              callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)])
    
    # Metrics
    preds = model.predict_proba(X_val)[:, 1]
    ll = log_loss(y_val, preds)
    brier = brier_score_loss(y_val, preds)
    
    # Top Features
    importances = pd.Series(model.feature_importances_, index=feature_cols).sort_values(ascending=False).head(5)
    
    # Spara RAW LGBM som produktion (sklearn wrapper for predict_proba)
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models')
    os.makedirs(models_dir, exist_ok=True)
    
    model_path = os.path.join(models_dir, 'lgbm_v1.lgb')
    model.booster_.save_model(model_path)
    
    # Spara sklearn wrapper som calibrator (samma interface, raw probabilities)
    calibrator_path = os.path.join(models_dir, 'calibrator_v1.pkl')
    joblib.dump(model, calibrator_path)
    
    # --- RAPPORTERING ---
    print("\n" + "="*40)
    print("[REPORT] RESULTATRAPPORT (RAW LGBM):")
    print("="*40)
    print(f"Log-loss:    {ll:.4f}")
    print(f"Brier score: {brier:.4f}\n")
    
    print(f"Positiv klassandel (Train): {train_pos_rate:.2%} (Safety: 7-15%)")
    print(f"Positiv klassandel (Val):   {val_pos_rate:.2%} (Safety: 7-15%)\n")
    
    if train_pos_rate < 0.07 or train_pos_rate > 0.15:
        print("[WARN] VARNING: Join-logiken for y=1 brot safety range!")
        
    print("Viktigaste funktionerna (Top 5):")
    for feat, imp in importances.items():
        print(f"  - {feat}: {imp}")
        
    print(f"\n[DONE] RAW LGBM sparad till {calibrator_path}")
    print("[NOTE] Ingen kalibrering — raw probabilities (verifierat bast i Fas 17)")

if __name__ == "__main__":
    train_model()
