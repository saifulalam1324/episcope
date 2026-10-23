
import csv
import json
import time
from pathlib import Path

import requests
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = ROOT / "data" / "reference" / "districts.geojson"
OUT = ROOT / "data" / "weather" / "weather_daily.csv"
FAILED = ROOT / "data" / "weather" / "weather_failures.csv"

START_DATE = "2021-01-01"
END_DATE = "2025-12-31"
EXPECTED_DAYS = 1826
API_URL = "https://archive-api.open-meteo.com/v1/archive"

if not GEOJSON.exists():
    raise FileNotFoundError(f"Missing boundary file: {GEOJSON}")

geo = json.loads(GEOJSON.read_text(encoding="utf-8"))
OUT.parent.mkdir(parents=True, exist_ok=True)

fields = [
    "district_name", "district_iso", "latitude", "longitude",
    "date", "temperature_mean_c", "precipitation_mm"
]

session = requests.Session()
session.headers.update({"User-Agent": "EpiScope-coursework/1.0"})


def load_completed_districts():
    if not OUT.exists():
        return set()

    counts = {}
    dates_by_district = {}

    with OUT.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row.get("district_name")
            day = row.get("date")
            if name and day:
                counts[name] = counts.get(name, 0) + 1
                dates_by_district.setdefault(name, set()).add(day)

    return {
        name for name, count in counts.items()
        if count == EXPECTED_DAYS
        and len(dates_by_district[name]) == EXPECTED_DAYS
    }


def fetch_weather(name, params):
    last_error = "Unknown error"

    for attempt in range(5):
        try:
            response = session.get(API_URL, params=params, timeout=90)
            response.raise_for_status()
            payload = response.json()

            if payload.get("error"):
                raise ValueError(payload.get("reason", "API error"))

            daily = payload.get("daily") or {}
            dates = daily.get("time") or []
            temps = daily.get("temperature_2m_mean")
            rain = daily.get("precipitation_sum")

            if (
                not dates
                or temps is None
                or rain is None
                or len(dates) != EXPECTED_DAYS
                or len(dates) != len(temps)
                or len(dates) != len(rain)
                or len(set(dates)) != EXPECTED_DAYS
            ):
                raise ValueError(
                    f"Expected {EXPECTED_DAYS} daily records; "
                    f"received dates={len(dates)}, "
                    f"temperatures={len(temps) if temps is not None else 'missing'}, "
                    f"precipitation={len(rain) if rain is not None else 'missing'}"
                )

            return dates, temps, rain

        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)
            if attempt < 4:
                wait = 2 ** attempt
                print(
                    f"Retry {attempt + 1}/4 for {name} "
                    f"in {wait}s: {last_error}"
                )
                time.sleep(wait)

    raise RuntimeError(last_error)


completed = load_completed_districts()
print(f"Already completed: {len(completed)} districts")

file_exists = OUT.exists() and OUT.stat().st_size > 0

with OUT.open(
    "a" if file_exists else "w",
    newline="",
    encoding="utf-8"
) as f:
    writer = csv.DictWriter(f, fieldnames=fields)

    if not file_exists:
        writer.writeheader()

    for index, feature in enumerate(geo["features"], start=1):
        props = feature["properties"]
        geom = shape(feature["geometry"])
        point = geom.representative_point()

        name = props.get("shapeName", f"District_{index}")
        iso = props.get("shapeISO", "")

        if name in completed:
            print(f"{index}/64 skipped: {name} (already complete)")
            continue

        params = {
            "latitude": point.y,
            "longitude": point.x,
            "start_date": START_DATE,
            "end_date": END_DATE,
            "daily": "temperature_2m_mean,precipitation_sum",
            "timezone": "Asia/Dhaka",
        }

        try:
            dates, temps, rain = fetch_weather(name, params)

            rows = [
                {
                    "district_name": name,
                    "district_iso": iso,
                    "latitude": point.y,
                    "longitude": point.x,
                    "date": day,
                    "temperature_mean_c": temp,
                    "precipitation_mm": precipitation,
                }
                for day, temp, precipitation in zip(dates, temps, rain)
            ]

            writer.writerows(rows)
            f.flush()
            completed.add(name)

            print(f"{index}/64 downloaded: {name} ({len(rows)} days)")

        except RuntimeError as exc:
            print(f"{index}/64 FAILED: {name}: {exc}")

            with FAILED.open("a", newline="", encoding="utf-8") as ff:
                failure_writer = csv.writer(ff)
                if ff.tell() == 0:
                    failure_writer.writerow(["district_name", "error"])
                failure_writer.writerow([name, str(exc)])

        time.sleep(0.5)

print(f"Completed districts: {len(completed)}/{len(geo['features'])}")
print(f"Weather CSV: {OUT}")
print(f"Failure log: {FAILED}")
