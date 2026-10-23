
import json
from pathlib import Path

import requests

OUTPUT_DIR = Path("data/reference")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

url = (
    "https://www.geoboundaries.org/api/current/"
    "gbOpen/BGD/ADM2/"
)

response = requests.get(url, timeout=60)
response.raise_for_status()
metadata = response.json()

if isinstance(metadata, list):
    metadata = metadata[0]

download_url = (
    metadata.get("simplifiedGeometryGeoJSON")
    or metadata.get("gjDownloadURL")
)

if not download_url:
    raise RuntimeError(
        "GeoJSON download URL not found in API response."
    )

geo_response = requests.get(download_url, timeout=120)
geo_response.raise_for_status()
geojson = geo_response.json()

output_file = OUTPUT_DIR / "districts.geojson"

with output_file.open("w", encoding="utf-8") as file:
    json.dump(geojson, file)

print("Saved:", output_file)
print("District features:", len(geojson.get("features", [])))
print("Attribution: geoBoundaries")
