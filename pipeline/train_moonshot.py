import os
import pandas as pd
import numpy as np
import lightgbm as lgb
import joblib
from sklearn.metrics import log_loss, brier_score_loss
import warnings

warnings.filterwarnings("ignore")

def train_model():
    print("[TRAIN MOONSHOT] Loading data directly from Parquet...")
    pwd = os.path.dirname(os.path.abspath(__file__))
    parquet_path = os.path.join(pwd, 'features_v2_moonshot.parquet')
    
    if not os.path.exists(parquet_path):
        print("[ERROR] Parquet file not found. Run features_parquet.py first!")
        return

    df_wide = pd.read_parquet(parquet_path)
    print(f"[TRAIN] Loaded {len(df_wide)} rows.")
    
    df_wide['y'] = (df_wide['final_position'] == 1).astype(int)
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    df_wide = df_wide.sort_values('race_date')
    
    start_date = df_wide['race_date'].min()
    # 2 years of data: 1 year train, 1 year validation
    split_date = start_date + pd.Timedelta(days=365)
    
    train_mask = df_wide['race_date'] <= split_date
    val_mask = df_wide['race_date'] > split_date
    
    ignore_cols = ['starter_id', 'race_id', 'horse_id', 'race_date', 'final_position', 'odds', 'log_odds', 'y', 'field_size']
    feature_cols = [c for c in df_wide.columns if c not in ignore_cols]
    
    print(f"[TRAIN] Using {len(feature_cols)} advanced features. Features:", feature_cols[:10], "...")
    
    X_train = df_wide.loc[train_mask, feature_cols]
    y_train = df_wide.loc[train_mask, 'y']
    
    X_val = df_wide.loc[val_mask, feature_cols]
    y_val = df_wide.loc[val_mask, 'y']
    
    print(f"[TRAIN] Train size: {len(X_train)}, Validation size: {len(X_val)}")
    
    params = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'random_state': 42
    }
    
    lgb_train = lgb.Dataset(X_train, y_train)
    lgb_eval = lgb.Dataset(X_val, y_val, reference=lgb_train)
    
    print("[TRAIN] Fitting LightGBM...")
    gbm = lgb.train(
        params,
        lgb_train,
        num_boost_round=1000,
        valid_sets=[lgb_train, lgb_eval],
        callbacks=[lgb.early_stopping(stopping_rounds=50)]
    )
    
    y_pred_val = gbm.predict(X_val, num_iteration=gbm.best_iteration)
    ll = log_loss(y_val, y_pred_val)
    print(f"[EVAL] Validation LogLoss: {ll:.4f}")
    
    # Save the moonshot model
    models_dir = os.path.join(pwd, '../models')
    os.makedirs(models_dir, exist_ok=True)
    out_path = os.path.join(models_dir, 'calibrator_v3_moonshot.pkl')
    
    from sklearn.calibration import IsotonicRegression
    print("[CALIBRATION] Calibrating probabilities with IsotonicRegression...")
    iso = IsotonicRegression(out_of_bounds='clip')
    iso.fit(y_pred_val, y_val)
    
    # Save a combo dict for the pipeline
    model_bundle = {
        'gbm': gbm,
        'calibrator': iso,
        'features': feature_cols
    }
    joblib.dump(model_bundle, out_path)
    print(f"[DONE] Moonshot V3 model saved to {out_path}")

if __name__ == '__main__':
    train_model()
