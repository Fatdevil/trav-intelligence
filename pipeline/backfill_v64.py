"""
V64 Backfill — Hämtar 12 månader av V64-lopp för att stärka modellen.
V64 körs nästan varje vardag = 200+ loppdagar × 6 lopp = 1200+ lopp.
"""
import sys, os, datetime, time, requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ingest import fetch_games_for_date, parse_and_ingest_game
from config import get_connection

# Check current V64 coverage
conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT race_type, MIN(race_date)::text, MAX(race_date)::text, COUNT(*) FROM races GROUP BY race_type ORDER BY race_type")
print("Current data coverage:")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1][:10]} → {row[2][:10]} ({row[3]} races)")
conn.close()

# Backfill V64 for 12 months
end_date = datetime.date(2026, 3, 29)  # Yesterday
start_date = datetime.date(2025, 3, 30) # 12 months back

total_races = 0
total_starters = 0
days_checked = 0
days_with_v64 = 0

print(f"\n[BACKFILL V64] Scanning {start_date} → {end_date} (365 days)")
print("=" * 60)

current = start_date
while current <= end_date:
    date_str = current.isoformat()
    days_checked += 1
    
    # Only process weekdays (V64 runs Mon-Fri typically)
    if current.weekday() < 5:  # Mon=0, Fri=4
        try:
            url = f"https://www.atg.se/services/racinginfo/v1/api/calendar/day/{date_str}"
            resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                games = data.get('games', {})
                
                v64_games = games.get('V64', [])
                for g in v64_games:
                    if g.get('status') == 'results':
                        game_id = g['id']
                        r, h, s = parse_and_ingest_game(game_id)
                        total_races += r
                        total_starters += s
                        days_with_v64 += 1
                        
                        if days_with_v64 % 10 == 0:
                            print(f"  [{days_with_v64} V64-dagar] {date_str} - Totalt: {total_races} lopp, {total_starters} starters")
        except Exception as e:
            pass  # Skip failed days silently
    
    current += datetime.timedelta(days=1)
    
    # Small delay to be nice to ATG API
    if days_checked % 20 == 0:
        time.sleep(0.5)

print(f"\n{'='*60}")
print(f"  V64 BACKFILL KLAR!")
print(f"{'='*60}")
print(f"  Dagar kontrollerade: {days_checked}")
print(f"  V64-dagar hittade:   {days_with_v64}")
print(f"  Nya lopp:            {total_races}")
print(f"  Nya starters:        {total_starters}")

# Show updated stats
conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT race_type, COUNT(*) FROM races GROUP BY race_type ORDER BY COUNT(*) DESC")
print(f"\nUppdaterad datafördelning:")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]} races")
conn.close()
