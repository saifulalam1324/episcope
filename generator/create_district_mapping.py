import json
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

geojson = json.loads(
    (ROOT/"data/reference/districts.geojson").read_text(encoding="utf-8")
)

names = sorted([f["properties"]["shapeName"] for f in geojson["features"]])

mapping = pd.DataFrame({
    "district_id":[f"D{i:03d}" for i in range(1,65)],
    "district_name":names
})

out = ROOT/"data/reference/district_mapping.csv"
mapping.to_csv(out,index=False)

print(mapping.head())
print("Saved:",out)