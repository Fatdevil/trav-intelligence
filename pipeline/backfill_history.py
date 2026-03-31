"""
backfill_history.py — Hämtar 2 års ATG-historik (730 dagar)
Använder ATG:s publika Calendar + Game API.
Rate-limited: 1 sek pause mellan dagar, retry vid fel.
"""
import sys
import time
import datetime
from ingest import fetch_games_for_date, parse_and_ingest_game

def backfill(days_back=730, start_offset=0):
    today = datetime.date.today()
    total_races = 0
    total_horses = 0
    total_starters = 0
    skipped = 0
    errors = 0
    
    print("=" * 60)
    print(f"  TRAV EDGE — HISTORISK BACKFILL")
    print(f"  Period: {days_back} dagar ({today - datetime.timedelta(days=days_back)} → {today})")
    print("=" * 60)
    
    for i in range(start_offset, days_back):
        date = today - datetime.timedelta(days=days_back - i)
        date_str = date.strftime('%Y-%m-%d')
        
        # Progress
        pct = (i + 1) / days_back * 100
        sys.stdout.write(f"\r  [{pct:5.1f}%] {date_str} — {total_races} lopp, {total_starters} starter, {errors} fel")
        sys.stdout.flush()
        
        try:
            game_ids = fetch_games_for_date(date_str)
            
            if not game_ids:
                skipped += 1
                time.sleep(0.3)  # Liten paus även vid tomma dagar
                continue
            
            for game_id in game_ids:
                try:
                    r, h, s = parse_and_ingest_game(game_id)
                    total_races += r
                    total_horses += h
                    total_starters += s
                except Exception as e:
                    errors += 1
                    if errors <= 5:
                        print(f"\n  [WARN] {game_id}: {e}")
                time.sleep(0.5)  # Rate limit mellan spel
            
            time.sleep(1.0)  # Rate limit mellan dagar
            
        except KeyboardInterrupt:
            print(f"\n\n  [AVBROTT] Stannade vid dag {i} ({date_str})")
            print(f"  Kör igen med: python backfill_history.py --offset {i}")
            break
        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"\n  [ERROR] {date_str}: {e}")
            time.sleep(2)
    
    print(f"\n\n{'=' * 60}")
    print(f"  BACKFILL KLAR!")
    print(f"  Lopp:     {total_races}")
    print(f"  Hästar:   {total_horses}")
    print(f"  Starter:  {total_starters}")
    print(f"  Skippade: {skipped} dagar (inga spel)")
    print(f"  Fel:      {errors}")
    print(f"{'=' * 60}")

if __name__ == '__main__':
    days = 730
    offset = 0
    
    for arg in sys.argv[1:]:
        if arg.startswith('--days='):
            days = int(arg.split('=')[1])
        elif arg.startswith('--offset'):
            idx = sys.argv.index(arg)
            if idx + 1 < len(sys.argv):
                offset = int(sys.argv[idx + 1])
    
    backfill(days_back=days, start_offset=offset)
