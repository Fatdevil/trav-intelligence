"""
proper_backtest.py — Riktig walk-forward ROI-analys
====================================================
Tränar modellen på 2024-data, testar på 2025 (out-of-sample).
Simulerar GULDTIPS-logiken och mäter verklig ROI.
"""
import os, sys, pickle, datetime
import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import log_loss
from sqlalchemy import create_engine, text
from config import DB_URL_SQLALCHEMY

print("="*60)
print("  TRAV EDGE — PROPER OUT-OF-SAMPLE ROI BACKTEST")
print("  Train: 2024-01-01 → 2024-12-31")
print("  Test:  2025-01-01 → 2025-12-31")
print("="*60)

e = create_engine(DB_URL_SQLALCHEMY)

# ── 1. Ladda features ──────────────────────────────────────────
print("\n[1/5] Laddar features från DB...")
df_long = pd.read_sql("""
    SELECT f.race_id, f.starter_id, f.feature_name, f.feature_value,
           rs.final_position, rs.odds_final, rs.odds_pre_race,
           r.race_date, r.track_name, r.race_number, h.horse_name
    FROM features f
    JOIN race_starters rs ON f.starter_id = rs.id
    JOIN races r ON f.race_id = r.id
    JOIN horses h ON rs.horse_id = h.id
    WHERE rs.final_position > 0
      AND rs.scratch = false
""", e)

print(f"  {len(df_long)} feature-rader laddade")

if df_long.empty:
    print("Inga features med resultat — kör features.py + backfill_history.py först")
    sys.exit(1)

# ── 2. Pivot till wide ─────────────────────────────────────────
print("[2/5] Pivoterar till wide format...")
df_long = df_long.drop_duplicates(subset=['starter_id','feature_name'], keep='last')
df_wide = df_long.pivot(
    index=['race_id','starter_id','final_position','odds_final','odds_pre_race',
           'race_date','track_name','race_number','horse_name'],
    columns='feature_name', values='feature_value'
).reset_index()
df_wide.columns.name = None

df_wide['race_date'] = pd.to_datetime(df_wide['race_date'])
df_wide['y'] = (df_wide['final_position'] == 1).astype(int)
df_wide = df_wide.sort_values('race_date').reset_index(drop=True)

print(f"  {len(df_wide)} starters | Datum: {df_wide['race_date'].min().date()} → {df_wide['race_date'].max().date()}")

TRAIN_END   = pd.Timestamp("2024-12-31")
TEST_START  = pd.Timestamp("2025-01-01")
TEST_END    = pd.Timestamp("2025-12-31")

# Features
meta = ['race_id','starter_id','final_position','odds_final','odds_pre_race',
        'race_date','track_name','race_number','horse_name','y']
feature_cols = [c for c in df_wide.columns if c not in meta]

train = df_wide[df_wide['race_date'] <= TRAIN_END].copy()
test  = df_wide[(df_wide['race_date'] >= TEST_START) & (df_wide['race_date'] <= TEST_END)].copy()

print(f"  Train: {len(train)} starter ({train['race_date'].min().date()} → {train['race_date'].max().date()})")
print(f"  Test:  {len(test)} starter ({test['race_date'].min().date()} → {test['race_date'].max().date()})")

if len(train) < 100 or len(test) < 100:
    print("\nFör lite data för en proper backtst. Behöver minst 100 starter per period.")
    print("Kör: python backfill_history.py + python features.py")
    sys.exit(1)

# ── 3. Träna modell på 2024 ────────────────────────────────────
print("\n[3/5] Tränar LightGBM på 2024-data...")
X_train = train[feature_cols].fillna(0)
y_train = train['y']
X_test  = test[feature_cols].fillna(0)
y_test  = test['y']

# Bästa params (från tune_lgbm.py)
best_pkl = os.path.join(os.path.dirname(__file__), "..", "models", "calibrator_v1.pkl")
try:
    with open(best_pkl, 'rb') as f:
        saved = pickle.load(f)
    params = {k: saved[k] for k in ['learning_rate','num_leaves','min_child_samples',
                                      'reg_alpha','reg_lambda','subsample','colsample_bytree']
              if k in saved}
    n_trees = saved.get('n_trees', 200)
    print(f"  Laddade sparade params: lr={params.get('learning_rate')}, leaves={params.get('num_leaves')}")
except Exception:
    # Fallback params
    params = dict(learning_rate=0.03, num_leaves=31, min_child_samples=20,
                  reg_alpha=0.1, reg_lambda=0.1, subsample=0.85, colsample_bytree=0.85)
    n_trees = 300
    print("  Använder default params (model pkl ej läsbar)")

base = lgb.LGBMClassifier(
    n_estimators=n_trees, objective='binary', verbosity=-1,
    class_weight='balanced', **params
)
base.fit(X_train, y_train)

probs_train = base.predict_proba(X_train)[:,1]
probs_test  = base.predict_proba(X_test)[:,1]

ll_train = log_loss(y_train, probs_train)
ll_test  = log_loss(y_test, probs_test)
print(f"  Log-loss train: {ll_train:.4f} | test: {ll_test:.4f}")
print(f"  (lägre = bättre; naiv baseline ≈ 0.23)")

# ── 4. Beräkna edge & simulera GULDTIPS ────────────────────────
print("\n[4/5] Simulerar GULDTIPS-logik på 2025...")
test = test.copy()
test['model_prob'] = probs_test
odds = test['odds_final'].fillna(test['odds_pre_race']).clip(lower=1.01)
test['market_prob'] = 1.0 / odds
test['edge'] = test['model_prob'] - test['market_prob']

# Definitioner
test['is_guldtips'] = (test['edge'] >= 0.30) & (test['model_prob'] >= 0.40)
test['is_bevakning'] = (test['edge'] >= 0.15) & (test['model_prob'] >= 0.25) & ~test['is_guldtips']
test['is_any_tip']   = test['is_guldtips'] | test['is_bevakning']

# ── 5. ROI-beräkning ───────────────────────────────────────────
print("\n[5/5] Räknar ROI...")
print()
print("="*60)
print("  OUT-OF-SAMPLE ROI (2025) — RESULTAT")
print("="*60)

def roi_report(subset, label):
    if len(subset) == 0:
        print(f"\n  {label}: INGA BETS (för strikt filter)")
        return
    wins   = subset[subset['final_position'] == 1]
    staked = len(subset)
    ret    = wins[odds.loc[wins.index].clip(lower=1).name if False else 'odds_final'].fillna(1).sum()
    # Enkel summering
    ret = 0
    for _, row in wins.iterrows():
        o = row['odds_final'] or row['odds_pre_race'] or 1
        ret += float(o)
    roi    = (ret - staked) / staked * 100
    wr     = len(wins) / len(subset) * 100
    avg_o  = subset['odds_final'].fillna(subset['odds_pre_race']).mean()
    avg_e  = subset['edge'].mean() * 100
    avg_mp = subset['model_prob'].mean() * 100

    print(f"\n  ── {label} ──")
    print(f"     Antal bets:       {staked}")
    print(f"     Vinster:          {len(wins)} ({wr:.1f}%)")
    print(f"     Snitt odds:       {avg_o:.1f}")
    print(f"     Snitt edge:       {avg_e:.1f}%")
    print(f"     Snitt modellprob: {avg_mp:.1f}%")
    print(f"     Satsad (1kr/bet): {staked:.0f} kr")
    print(f"     Återbetalt:       {ret:.1f} kr")
    print(f"     ┌─────────────────────────┐")
    print(f"     │  ROI:  {roi:+.1f}%              │")
    print(f"     └─────────────────────────┘")
    
    if len(wins) > 0 and len(wins) <= 20:
        print(f"\n     Vinnare:")
        for _, w in wins.iterrows():
            print(f"       {w['horse_name'][:20]:20s} {w['race_date'].date()} odds={w['odds_final']:.1f} edge={w['edge']*100:.0f}%")

roi_report(test[test['is_guldtips']], "GULDTIPS (edge>=30%, prob>=40%)")
roi_report(test[test['is_bevakning']], "BEVAKNING (edge>=15%, prob>=25%)")
roi_report(test[test['is_any_tip']], "ALLA TIPS (GULDTIPS + BEVAKNING)")
roi_report(test,                      "ALLA BETS (benchmark)")

# ── RENSAT FILTER: ta bort smutsiga odds ─────────────────────
print()
print("="*60)
print("  FILTRERAT: max odds 30 (rensar bort 99.99-placeholders)")
print("="*60)

clean = test[test['odds_final'].fillna(99) <= 30].copy()
print(f"\n  Starters kvar efter filter: {len(clean)} (av {len(test)})")

roi_report(clean[clean['is_guldtips']], "GULDTIPS (ren, odds<=30)")
roi_report(clean[clean['is_bevakning']], "BEVAKNING (ren, odds<=30)")
roi_report(clean[clean['is_any_tip']], "ALLA TIPS (ren, odds<=30)")
roi_report(clean, "ALLA BETS (benchmark, ren)")

# ── ODDS-BUCKET ANALYS ────────────────────────────────────────
print()
print("="*60)
print("  ODDS-BUCKET: Var är edge störst? (GULDTIPS, ren data)")
print("="*60)
gt = clean[clean['is_guldtips']].copy()
for lo, hi, label in [(1,3,"1-3 (storfavorit)"),(3,6,"3-6 (favorit)"),(6,10,"6-10 (medel)"),(10,20,"10-20 (outsider)"),(20,30,"20-30 (longshot)")]:
    bucket = gt[(gt['odds_final'] >= lo) & (gt['odds_final'] < hi)]
    if len(bucket) == 0: continue
    wins = bucket[bucket['final_position'] == 1]
    ret = sum(float(r['odds_final'] or 1) for _, r in wins.iterrows())
    roi = (ret - len(bucket)) / len(bucket) * 100
    wr  = len(wins) / len(bucket) * 100
    print(f"  odds {label:20s}: {len(bucket):4d} bets | {wr:.0f}% wins | ROI {roi:+.1f}%")

print()
print("="*60)
print("  OBS: OUT-OF-SAMPLE — modellen traenade ALDRIG pa 2025.")
print("="*60)

