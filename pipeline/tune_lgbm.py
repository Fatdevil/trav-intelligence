"""
LightGBM Hyperparameter Tuner — Grid search over key parameters.
Optimizes for minimal log-loss on walk-forward validation set.
"""
import os
import sqlite3
import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.metrics import log_loss
from itertools import product
import warnings
from config import DB_PATH

warnings.filterwarnings("ignore")

def run_tuning():
    print("[TUNER] Booting Hyperparameter Tuner...")
    db_path = DB_PATH.replace("file:", "")
    conn = sqlite3.connect(db_path)
    
    query = """
    SELECT f.race_id, f.starter_id, f.feature_name, f.feature_value, 
           rs.final_position, r.race_date 
    FROM features f
    JOIN race_starters rs ON f.starter_id = rs.id
    JOIN races r ON f.race_id = r.id;
    """
    df_long = pd.read_sql(query, conn)
    conn.close()
    
    df_wide = df_long.pivot(
        index=['race_id', 'starter_id', 'final_position', 'race_date'], 
        columns='feature_name', values='feature_value'
    ).reset_index()
    
    df_wide['y'] = (df_wide['final_position'] == 1).astype(int)
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    df_wide = df_wide.sort_values('race_date')
    
    start_date = df_wide['race_date'].min()
    split_date = start_date + pd.Timedelta(days=120)
    
    feature_cols = [c for c in df_wide.columns if c not in ['race_id', 'starter_id', 'final_position', 'race_date', 'y']]
    
    train_mask = df_wide['race_date'] <= split_date
    val_mask = df_wide['race_date'] > split_date
    
    X_train = df_wide.loc[train_mask, feature_cols]
    y_train = df_wide.loc[train_mask, 'y']
    X_val = df_wide.loc[val_mask, feature_cols]
    y_val = df_wide.loc[val_mask, 'y']
    
    print(f"[TUNER] Train: {X_train.shape}, Val: {X_val.shape}")
    
    # Parameter grid
    param_grid = {
        'learning_rate': [0.01, 0.03, 0.05, 0.1],
        'num_leaves': [15, 31, 50, 80],
        'min_child_samples': [10, 20, 50, 100],
        'reg_alpha': [0, 0.1, 1.0],
        'reg_lambda': [0, 0.1, 1.0],
        'subsample': [0.7, 0.85, 1.0],
        'colsample_bytree': [0.7, 0.85, 1.0],
    }
    
    # Random sample from grid (full grid = 4*4*4*3*3*3*3 = 5184 combos, too many)
    np.random.seed(42)
    n_trials = 80
    
    print(f"[TUNER] Running {n_trials} random configurations...")
    print(f"{'#':>3} | {'LogLoss':>8} | {'LR':>5} | {'Leaves':>6} | {'MinChild':>8} | {'Alpha':>5} | {'Lambda':>6} | {'Sub':>4} | {'ColSub':>6}")
    print("-" * 80)
    
    best_loss = 999
    best_params = {}
    results = []
    
    for trial in range(n_trials):
        params = {
            'learning_rate': np.random.choice(param_grid['learning_rate']),
            'num_leaves': int(np.random.choice(param_grid['num_leaves'])),
            'min_child_samples': int(np.random.choice(param_grid['min_child_samples'])),
            'reg_alpha': np.random.choice(param_grid['reg_alpha']),
            'reg_lambda': np.random.choice(param_grid['reg_lambda']),
            'subsample': np.random.choice(param_grid['subsample']),
            'colsample_bytree': np.random.choice(param_grid['colsample_bytree']),
        }
        
        model = lgb.LGBMClassifier(
            objective='binary', 
            n_estimators=1000,
            random_state=42,
            verbose=-1,
            **params
        )
        
        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)]
        )
        
        preds = model.predict_proba(X_val)[:, 1]
        ll = log_loss(y_val, preds)
        
        results.append({**params, 'log_loss': ll, 'n_trees': model.best_iteration_})
        
        marker = ""
        if ll < best_loss:
            best_loss = ll
            best_params = {**params, 'n_trees': model.best_iteration_}
            marker = " <-- BEST"
        
        if trial % 10 == 0 or ll < best_loss + 0.0005:
            print(f"{trial:>3} | {ll:.6f} | {params['learning_rate']:.2f} | {params['num_leaves']:>6} | {params['min_child_samples']:>8} | {params['reg_alpha']:.1f} | {params['reg_lambda']:>5.1f} | {params['subsample']:.2f} | {params['colsample_bytree']:.2f}{marker}")
    
    print("=" * 80)
    print(f"\n[RESULT] Basta konfiguration (log-loss: {best_loss:.6f}):")
    for k, v in best_params.items():
        print(f"  {k}: {v}")
    
    # Baseline jmf
    baseline = lgb.LGBMClassifier(objective='binary', n_estimators=500, random_state=42, verbose=-1)
    baseline.fit(X_train, y_train, eval_set=[(X_val, y_val)], 
                 callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)])
    baseline_ll = log_loss(y_val, baseline.predict_proba(X_val)[:, 1])
    
    improvement = (baseline_ll - best_loss) / baseline_ll * 100
    print(f"\n[COMPARE] Baseline log-loss: {baseline_ll:.6f}")
    print(f"[COMPARE] Tuned log-loss:    {best_loss:.6f}")
    print(f"[COMPARE] Forbattring:       {improvement:.2f}%")

if __name__ == "__main__":
    run_tuning()
