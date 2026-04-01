"""
Frigor diskutrymme pa Neon - ta bort alla gamla features och vacuuma.
Modellen ar redan trand och sparad i calibrator_v1.pkl.
"""
from config import DB_URL_SQLALCHEMY
import psycopg2

db_url = DB_URL_SQLALCHEMY.replace("postgresql+psycopg2://", "postgresql://")
conn = psycopg2.connect(db_url)
conn.autocommit = True  # Kravs for VACUUM
cur = conn.cursor()

# Kolla storlek fore
cur.execute("SELECT COUNT(*) FROM features")
before = cur.fetchone()[0]
print(f"Features before: {before}")

# Ta bort ALLA features utom de allra senast beraknade (last 7 days)
cur.execute("""
    DELETE FROM features 
    WHERE look_ahead_cutoff_date < (CURRENT_DATE - INTERVAL '7 days')
""")
print(f"Deleted old rows: {cur.rowcount}")

# VACUUM for att faktiskt frigora diskutrymme (kravs AUTOCOMMIT)
print("Running VACUUM FULL to reclaim disk space...")
cur.execute("VACUUM FULL features")
print("VACUUM done!")

cur.execute("SELECT COUNT(*) FROM features")
after = cur.fetchone()[0]
print(f"Features after VACUUM: {after}")

cur.close()
conn.close()
print("Done! Disk space reclaimed.")
