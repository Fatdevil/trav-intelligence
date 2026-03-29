import os
import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from config import get_connection
import warnings

warnings.filterwarnings("ignore")

def run_backtest():
    conn = get_connection()
    
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
        print("❌ Inga features hittades.")
        return

    metadata_cols = ['race_id', 'starter_id', 'final_position', 'race_date', 'odds_final', 'track_name', 'race_number', 'horse_name', 'driver_name']
    df_wide = df_long.pivot(index=metadata_cols, columns='feature_name', values='feature_value').reset_index()
    
    df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
    df_wide['year_month'] = df_wide['race_date'].dt.to_period('M')
    
    df_wide = df_wide.dropna(subset=['odds_final'])
    df_wide = df_wide[df_wide['odds_final'] > 1.0]
    df_wide = df_wide.sort_values('race_date')
    
    df_wide['y'] = (df_wide['final_position'] == 1).astype(int)
    feature_cols = [c for c in df_wide.columns if c not in metadata_cols + ['y', 'year_month']]
    
    months = sorted(df_wide['year_month'].unique())
    
    if len(months) < 2:
        print("❌ Behöver minst 2 månader av data för walk-forward.")
        return
        
    all_bets = []
    
    print(f"🗓️ Hittade {len(months)} unika månader i databasen: {[str(m) for m in months]}")
    
    # Kör Walk-Forward (Starta från månad 2 för att ha minst 1 månads träningsdata)
    for i in range(1, len(months)):
        test_month = months[i]
        print(f"\n🔄 Tränar och utvärderar för testmånad: {test_month}")
        
        train_mask = df_wide['year_month'] < test_month
        test_mask = df_wide['year_month'] == test_month
        
        X_train = df_wide.loc[train_mask, feature_cols]
        y_train = df_wide.loc[train_mask, 'y']
        
        X_test = df_wide.loc[test_mask, feature_cols]
        y_test = df_wide.loc[test_mask, 'y']
        
        if len(X_train) == 0 or len(X_test) == 0:
            print(f"Skippar {test_month} på grund av för lite data.")
            continue
            
        # Splitta X_train för Validation/Early-Stopping
        split_idx = int(len(X_train) * 0.8)
        X_t, y_t = X_train.iloc[:split_idx], y_train.iloc[:split_idx]
        X_v, y_v = X_train.iloc[split_idx:], y_train.iloc[split_idx:]
        
        model = lgb.LGBMClassifier(objective='binary', n_estimators=500, random_state=42)
        model.fit(
            X_t, y_t,
            eval_set=[(X_v, y_v)],
            callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)]
        )
        
        # Isotonic Regression Kalibrering PÅ validation set
        calibrated_clf = CalibratedClassifierCV(estimator=FrozenEstimator(model), method='isotonic')
        try:
            calibrated_clf.fit(X_v, y_v)
        except Exception as e:
            # Fallback till okalibrerad om valideringsset saknar positiva/negativa klasser pga litet sample
            print(f"⚠️ Kalibrering misslyckades för {test_month}, använder rå-modell.")
            calibrated_clf = model
        
        df_test = df_wide[test_mask].copy()
        
        if hasattr(calibrated_clf, "predict_proba"):
            df_test['calibrated_prob'] = calibrated_clf.predict_proba(X_test)[:, 1]
        else:
            df_test['calibrated_prob'] = model.predict_proba(X_test)[:, 1]
        
        df_test['decimal_odds'] = df_test['odds_final']
        df_test['market_prob'] = 1.0 / df_test['decimal_odds']
        df_test['edge'] = df_test['calibrated_prob'] - df_test['market_prob']
        df_test['ev'] = (df_test['calibrated_prob'] * (df_test['decimal_odds'] - 1)) - (1 - df_test['calibrated_prob'])
        
        # Value bets logic
        bets = df_test[(df_test['edge'] > 0.03) & (df_test['ev'] > 0.05)].copy()
        all_bets.append(bets)

    print("\n" + "="*50)
    print("📊 ROLLING WALK-FORWARD BACKTEST RAPPORT")
    print("="*50)
    
    if not all_bets:
        print("❌ Inga value bets hittades över hela perioden.")
        return
        
    df_all_bets = pd.concat(all_bets, ignore_index=True)
    df_all_bets['payout'] = df_all_bets.apply(lambda r: r['decimal_odds'] if r['y'] == 1 else 0, axis=1)
    
    # Månad för månad
    monthly_stats = []
    cumulative_profit = 0
    cumulative_bets = 0
    
    for month in sorted(df_all_bets['year_month'].unique()):
        m_bets = df_all_bets[df_all_bets['year_month'] == month]
        c = len(m_bets)
        profit = m_bets['payout'].sum() - c
        roi = profit / c if c > 0 else 0
        
        cumulative_profit += profit
        cumulative_bets += c
        cum_roi = cumulative_profit / cumulative_bets if cumulative_bets > 0 else 0
        
        win_count = m_bets['y'].sum()
        win_rate = win_count / c if c > 0 else 0
        avg_odds = m_bets['decimal_odds'].mean() if c > 0 else 0
        
        print(f"📅 {month}: \t {c} bets \t | Vinst: {win_rate: >5.1%} \t | Månads-ROI: {roi: >+7.2%} \t | Kumulativ ROI: {cum_roi: >+7.2%}")
        
    total_bets = len(df_all_bets)
    total_profit = df_all_bets['payout'].sum() - total_bets
    total_roi = total_profit / total_bets if total_bets > 0 else 0
    
    print("="*50)
    print(f"🏆 TOTALA STATISTIK FÖR BACKTEST (Månad 2-6)")
    print(f"Totalt antal flaggade bets: {total_bets}")
    print(f"Totalt Netto (Flat-stake):  {total_profit:+.2f} units")
    print(f"Total Flat-Stake ROI:       {total_roi:+.2%}")
    print("="*50)

if __name__ == "__main__":
    run_backtest()
