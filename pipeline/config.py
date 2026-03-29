import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(BASE_DIR, '.env.local')
load_dotenv(dotenv_path)
# Also load .env as fallback
load_dotenv(os.path.join(BASE_DIR, '.env'))

raw_url = os.environ.get("DATABASE_URL", "file:./dev.db")
db_file = os.path.join(BASE_DIR, "prisma", "dev.db")

# Detect if we're using PostgreSQL or SQLite
IS_POSTGRES = "postgresql" in raw_url or "postgres" in raw_url

if IS_POSTGRES:
    DB_URL_SQLALCHEMY = raw_url
    DB_PATH = raw_url
else:
    DB_URL_SQLALCHEMY = f"sqlite:///{db_file}"
    DB_PATH = db_file

ATG_BASE_URL = "https://www.atg.se/services/racinginfo/v1/api"
ATG_CALENDAR_URL = f"{ATG_BASE_URL}/programs"
ATG_RESULTS_URL = f"{ATG_BASE_URL}/results"

def get_connection():
    """Universal databaskoppling — fungerar med bade SQLite och PostgreSQL."""
    if IS_POSTGRES:
        import psycopg2
        return psycopg2.connect(raw_url)
    else:
        import sqlite3
        return sqlite3.connect(db_file)

def read_sql(query, conn):
    """Läs SQL-query till pandas DataFrame — hanterar bade SQLite och PostgreSQL."""
    import pandas as pd
    return pd.read_sql(query, conn)

class EnsembleCalibrator:
    """Ensemble av tva modeller med individuell kalibrering."""
    def __init__(self, lgbm_cal, logreg_cal, lgbm_weight=0.6, logreg_weight=0.4):
        self.lgbm_cal = lgbm_cal
        self.logreg_cal = logreg_cal
        self.lgbm_weight = lgbm_weight
        self.logreg_weight = logreg_weight
    
    def predict_proba(self, X):
        p1 = self.lgbm_cal.predict_proba(X)
        p2 = self.logreg_cal.predict_proba(X)
        return self.lgbm_weight * p1 + self.logreg_weight * p2
