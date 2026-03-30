"""
generate_rows.py — AI-Driven V75/V86/V64 Row Generator
========================================================
Budgetoptimerad radgenerator som maximerar Expected Value.

Algoritm:
1. Hämta modell-predictions för alla hästar per lopp
2. Rankg hästar per lopp efter model_prob
3. Greedy-optimering: Allokera "gardering" till lopp med störst EV-vinst
4. Generera rader inom budget med max EV

Användning:
  python generate_rows.py                     # V86 onsdag, 500 kr budget
  python generate_rows.py --budget 200        # Lägre budget
  python generate_rows.py --budget 1000 --game V75  # V75 med 1000 kr
  python generate_rows.py --risk aggressive   # Mer gardering
"""

import sys
import os
import argparse
import numpy as np
import pandas as pd
import joblib
from itertools import product
from functools import reduce
import operator

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import get_connection, DB_URL_SQLALCHEMY

# ======================================================================
# 1. HÄMTA MODELL-PREDICTIONS
# ======================================================================

def get_race_predictions(game_date=None):
    """Hämta alla hästar med model_prob för kommande lopp."""
    conn = get_connection()
    
    # Hitta kommande/senaste lopp
    if game_date:
        date_filter = f"AND CAST(r.race_date AS TEXT) LIKE '{game_date}%'"
    else:
        date_filter = "AND r.race_date >= CURRENT_DATE"
    
    query = f"""
        SELECT 
            r.id AS race_id,
            r.race_number,
            r.track_name,
            r.distance,
            r.start_type,
            r.race_type,
            rs.id AS starter_id,
            rs.post_position,
            rs.odds_final,
            h.horse_name,
            rs.driver_name
        FROM races r
        JOIN race_starters rs ON r.id = rs.race_id
        JOIN horses h ON rs.horse_id = h.id
        WHERE rs.scratch = false {date_filter}
        ORDER BY r.race_number, rs.post_position
    """
    
    df = pd.read_sql(query, conn)
    conn.close()
    
    if len(df) == 0:
        print("[WARN] Inga lopp hittade. Kör predict_upcoming.py först.")
        return None
    
    # Hämta features och beräkna model_prob
    conn2 = get_connection()
    features_query = f"""
        SELECT f.starter_id, f.feature_name, f.feature_value
        FROM features f
        JOIN races r ON f.race_id = r.id
        WHERE 1=1 {date_filter}
    """
    df_feat = pd.read_sql(features_query, conn2)
    conn2.close()
    
    if len(df_feat) == 0:
        print("[WARN] Inga features hittade. Kör predict_upcoming.py först.")
        return None
    
    # Pivot features
    df_wide = df_feat.pivot(index='starter_id', columns='feature_name', values='feature_value').reset_index()
    
    # Ladda modell
    models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models')
    model_path = os.path.join(models_dir, 'calibrator_v1.pkl')
    
    if not os.path.exists(model_path):
        print(f"[ERROR] Modell saknas: {model_path}")
        return None
    
    calibrator = joblib.load(model_path)
    feat_cols = sorted([c for c in df_wide.columns if c != 'starter_id'])
    
    # Matcha features med modellens förväntade kolumner
    expected = list(calibrator.feature_names_in_) if hasattr(calibrator, 'feature_names_in_') else feat_cols
    for col in expected:
        if col not in df_wide.columns:
            df_wide[col] = np.nan
    
    X = df_wide[expected]
    df_wide['model_prob'] = calibrator.predict_proba(X)[:, 1]
    
    # Merge med race-data
    df = df.merge(df_wide[['starter_id', 'model_prob']], on='starter_id', how='left')
    df['model_prob'] = df['model_prob'].fillna(0.01)
    
    # Market prob
    df['decimal_odds'] = df['odds_final'].apply(lambda o: max(o, 1.01) if pd.notnull(o) else 100.0)
    df['market_prob'] = 1.0 / df['decimal_odds']
    df['edge'] = df['model_prob'] - df['market_prob']
    
    return df


# ======================================================================
# 2. BUDGET-OPTIMERAD RADGENERATOR
# ======================================================================

def calculate_row_ev(selections_per_race, race_data):
    """
    Beräkna Expected Value för en given radkombination.
    
    selections_per_race: dict {race_number: [post_positions]}
    race_data: DataFrame med alla hästar
    
    EV = Σ(prob_winning_combo × payout) - cost
    """
    race_win_probs = []
    
    for race_num, posts in selections_per_race.items():
        race_horses = race_data[race_data['race_number'] == race_num]
        selected = race_horses[race_horses['post_position'].isin(posts)]
        
        # Sannolikheten att MINST EN av våra valda hästar vinner
        # = summan av deras individuella vinstsannolikheter (approximation)
        prob_cover = min(selected['model_prob'].sum(), 0.99)
        race_win_probs.append(prob_cover)
    
    # Sannolikheten att ALLA lopp träffar = produkt
    total_win_prob = reduce(operator.mul, race_win_probs, 1.0)
    
    return total_win_prob, race_win_probs


def greedy_row_optimizer(race_data, budget, unit_cost=2.0, risk_profile='balanced'):
    """
    Greedy-algoritm för att optimera rader inom budget.
    
    Strategi:
    1. Börja med topp-1 häst per lopp (minst antal rader)
    2. Iterativt lägg till den häst som ger störst EV-ökning per krona
    3. Stopp när budget är uppnådd
    """
    races = sorted(race_data['race_number'].unique())
    n_races = len(races)
    
    # Riskprofil styr min/max hästar per lopp
    risk_config = {
        'conservative': {'min': 1, 'max': 2, 'spik_threshold': 0.25},
        'balanced':     {'min': 1, 'max': 4, 'spik_threshold': 0.20},
        'aggressive':   {'min': 1, 'max': 6, 'spik_threshold': 0.15},
    }
    config = risk_config.get(risk_profile, risk_config['balanced'])
    
    # Steg 1: Börja med topp-1 per lopp
    selections = {}
    for race_num in races:
        race_horses = race_data[race_data['race_number'] == race_num].sort_values('model_prob', ascending=False)
        top_horse = race_horses.iloc[0]
        selections[race_num] = [int(top_horse['post_position'])]
    
    def total_rows():
        return reduce(operator.mul, [len(v) for v in selections.values()], 1)
    
    def total_cost():
        return total_rows() * unit_cost
    
    # Steg 2: Greedy — lägg till hästar som ger bäst EV/kr
    max_iterations = 50
    for iteration in range(max_iterations):
        if total_cost() >= budget:
            break
        
        best_ev_gain = -1
        best_race = None
        best_post = None
        
        for race_num in races:
            if len(selections[race_num]) >= config['max']:
                continue
            
            race_horses = race_data[race_data['race_number'] == race_num].sort_values('model_prob', ascending=False)
            current_posts = set(selections[race_num])
            
            for _, horse in race_horses.iterrows():
                post = int(horse['post_position'])
                if post in current_posts:
                    continue
                
                # Beräkna kostnaden för att lägga till denna häst
                old_rows = total_rows()
                new_rows = old_rows * (len(selections[race_num]) + 1) / len(selections[race_num])
                extra_cost = (new_rows - old_rows) * unit_cost
                
                if total_cost() + extra_cost > budget * 1.1:  # 10% marginal
                    continue
                
                # EV-vinst: hur mycket ökar vår täckning?
                ev_gain = horse['model_prob']  # Marginal prob att fånga vinnaren
                ev_per_kr = ev_gain / max(extra_cost, 0.01)
                
                if ev_per_kr > best_ev_gain:
                    best_ev_gain = ev_per_kr
                    best_race = race_num
                    best_post = post
        
        if best_race is None:
            break
        
        selections[best_race].append(best_post)
    
    # Om vi är under budget, försök ta bort onödiga hästar
    # (hästar med väldigt låg model_prob som inte bidrar)
    
    return selections


def format_row_output(selections, race_data, budget, unit_cost=2.0):
    """Formatera raden snyggt."""
    races = sorted(selections.keys())
    total_rows = reduce(operator.mul, [len(v) for v in selections.values()], 1)
    cost = total_rows * unit_cost
    
    # Beräkna total träffsannolikhet
    total_prob, race_probs = calculate_row_ev(selections, race_data)
    
    print(f"\n{'='*60}")
    print(f"  🎯 TRAV EDGE — OPTIMERAD RAD")
    print(f"{'='*60}")
    
    game_type = race_data['race_type'].iloc[0] if 'race_type' in race_data.columns else 'V??'
    track = race_data['track_name'].iloc[0] if 'track_name' in race_data.columns else ''
    print(f"  Spel:    {game_type}")
    print(f"  Budget:  {budget:.0f} kr")
    print(f"  Kostnad: {cost:.0f} kr ({total_rows} rader × {unit_cost:.0f} kr)")
    print(f"  Träff%:  {total_prob*100:.1f}%")
    print(f"{'='*60}\n")
    
    for race_num in races:
        posts = sorted(selections[race_num])
        race_horses = race_data[race_data['race_number'] == race_num]
        race_prob = race_probs[races.index(race_num)]
        
        # Spik eller gardering?
        if len(posts) == 1:
            label = "⭐ SPIK"
        elif len(posts) <= 2:
            label = "🔒 HALVGARD"
        else:
            label = "🔓 GARDERING"
        
        track_name = race_horses['track_name'].iloc[0] if len(race_horses) > 0 else ''
        print(f"  Lopp {race_num} ({track_name}) — {label} — Täckning: {race_prob*100:.0f}%")
        
        for post in posts:
            horse = race_horses[race_horses['post_position'] == post]
            if len(horse) > 0:
                h = horse.iloc[0]
                name = h['horse_name'][:20]
                driver = h['driver_name'][:15] if pd.notnull(h['driver_name']) else ''
                prob = h['model_prob'] * 100
                odds = h['decimal_odds']
                edge = h['edge'] * 100
                
                edge_str = f"+{edge:.1f}%" if edge > 0 else f"{edge:.1f}%"
                marker = "★" if edge > 0 else " "
                print(f"    {marker} {post:2d}. {name:20s} ({driver:15s}) — {prob:.1f}% | Odds {odds:.1f} | Edge {edge_str}")
        print()
    
    # Sammanfattning
    print(f"{'='*60}")
    spikar = sum(1 for v in selections.values() if len(v) == 1)
    garderat = len(races) - spikar
    print(f"  Spikar:     {spikar} lopp")
    print(f"  Garderat:   {garderat} lopp")
    print(f"  Totalt:     {total_rows} rader = {cost:.0f} kr")
    print(f"  Träffsäk:   {total_prob*100:.1f}%")
    print(f"{'='*60}")
    
    # Returnera data för API
    return {
        'selections': {int(k): sorted(v) for k, v in selections.items()},
        'total_rows': total_rows,
        'cost': cost,
        'win_probability': total_prob,
        'race_probabilities': {int(races[i]): race_probs[i] for i in range(len(races))},
    }


# ======================================================================
# MAIN
# ======================================================================

def main():
    parser = argparse.ArgumentParser(description='AI Radgenerator')
    parser.add_argument('--budget', type=float, default=500, help='Budget i kronor')
    parser.add_argument('--unit-cost', type=float, default=2.0, help='Kostnad per rad (kr)')
    parser.add_argument('--game', type=str, default=None, help='Speltyp: V75, V86, V64')
    parser.add_argument('--date', type=str, default=None, help='Datum: 2026-04-01')
    parser.add_argument('--risk', type=str, default='balanced', 
                       choices=['conservative', 'balanced', 'aggressive'],
                       help='Riskprofil')
    args = parser.parse_args()
    
    print("🎯 TRAV EDGE — AI RADGENERATOR")
    print(f"   Budget: {args.budget} kr | Risk: {args.risk}")
    print()
    
    # Hämta predictions
    print("[1/3] Hämtar modell-predictions...")
    df = get_race_predictions(args.date)
    
    if df is None or len(df) == 0:
        print("[ERROR] Inga data. Kör predict_upcoming.py först.")
        return
    
    # Filtrera / auto-välj speltyp
    if args.game:
        game_types = [args.game]
    else:
        # Auto: hitta alla speltyper och generera rader per typ
        available = df['race_type'].dropna().unique()
        # Prioritera: V75 > V86 > V85 > V64
        priority = ['V75', 'V86', 'V85', 'V64']
        game_types = [g for g in priority if g in available]
        if not game_types:
            game_types = list(available)
        print(f"   Tillgängliga spel: {', '.join(game_types)}")
    
    all_results = []
    for game_type in game_types:
        game_df = df[df['race_type'] == game_type]
        if len(game_df) == 0:
            continue
        
        n_races = game_df['race_number'].nunique()
        n_horses = len(game_df)
        print(f"\n{'─'*60}")
        print(f"   {game_type}: {n_races} lopp, {n_horses} hästar")
        
        # Optimera rader
        print(f"\n[2/3] Optimerar {game_type}-rad (budget: {args.budget} kr, risk: {args.risk})...")
        selections = greedy_row_optimizer(game_df, args.budget, args.unit_cost, args.risk)
        
        # Output
        print(f"\n[3/3] Genererar {game_type}-rad...")
        result = format_row_output(selections, game_df, args.budget, args.unit_cost)
        all_results.append(result)
    
    return all_results


if __name__ == "__main__":
    main()
