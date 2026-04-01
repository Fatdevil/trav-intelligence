from config import DB_URL_SQLALCHEMY
from sqlalchemy import create_engine, text
import datetime

e = create_engine(DB_URL_SQLALCHEMY)
cutoff = (datetime.date.today() - datetime.timedelta(days=60)).isoformat()

with e.begin() as c:
    r = c.execute(text("SELECT COUNT(*) FROM features"))
    print(f"Features before: {r.fetchone()[0]}")
    
    # Slett gamla träningsfeatures - behåll bara senaste 60 dagar
    c.execute(text("DELETE FROM features WHERE look_ahead_cutoff_date < :cutoff"), {"cutoff": cutoff})
    
    r2 = c.execute(text("SELECT COUNT(*) FROM features"))
    print(f"Features after:  {r2.fetchone()[0]}")

print("Done! DB space freed.")
