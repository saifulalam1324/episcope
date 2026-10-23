from pathlib import Path
import json

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "dashboard"

GOLD_DIR = ROOT / "data" / "lake" / "gold" / "weekly_district_disease"
GEOJSON_FILE = ROOT / "data" / "reference" / "districts.geojson"

ALERTS_FILE = ROOT / "analytics" / "detection" / "ears_alerts.csv"
EVALUATION_FILE = ROOT / "analytics" / "detection" / "evaluation_results.csv"
FORECAST_FILE = ROOT / "analytics" / "forecast" / "forecasts.csv"
DEMAND_FILE = ROOT / "analytics" / "forecast" / "resource_demand.csv"
ALLOCATION_FILE = ROOT / "analytics" / "optimise" / "allocation_results.csv"

app = FastAPI(
    title="EpiScope API",
    description="Dashboard API for synthetic epidemiology data",
    version="1.0.0",
)

app.mount(
    "/static",
    StaticFiles(directory=str(DASHBOARD_DIR)),
    name="static",
)


def read_csv_or_empty(path: Path) -> pd.DataFrame:
    """Read an optional CSV output without crashing the dashboard."""
    if not path.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except (OSError, ValueError, pd.errors.ParserError):
        return pd.DataFrame()


def read_gold() -> pd.DataFrame:
    """Load the existing weekly Gold dataset."""
    if not GOLD_DIR.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Gold data not found: {GOLD_DIR}",
        )

    try:
        df = pd.read_parquet(GOLD_DIR)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not read Gold Parquet data: {exc}",
        ) from exc

    required = {"district_id", "disease", "week_start", "cases"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Gold dataset is missing columns: {sorted(missing)}",
        )

    df["week_start"] = pd.to_datetime(df["week_start"], errors="coerce")
    df["cases"] = pd.to_numeric(df["cases"], errors="coerce").fillna(0)
    df = df.dropna(subset=["week_start"])
    df["district_id"] = df["district_id"].astype(str)
    df["disease"] = df["disease"].astype(str)
    return df


def district_name_map() -> dict:
    """
    Reproduce the project's synthetic D001-D064 mapping:
    sort GeoJSON district names alphabetically, then assign IDs.

    IMPORTANT: this is a demo mapping, not a verified real-world
    relationship between generated case locations and actual districts.
    """
    if not GEOJSON_FILE.exists():
        return {}

    try:
        geo = json.loads(GEOJSON_FILE.read_text(encoding="utf-8"))
        names = []
        for feature in geo.get("features", []):
            props = feature.get("properties", {})
            name = props.get("shapeName")
            if name:
                names.append(str(name))

        names = sorted(set(names), key=str.casefold)
        return {
            f"D{i:03d}": name
            for i, name in enumerate(names, start=1)
        }
    except (OSError, json.JSONDecodeError):
        return {}


def records(df: pd.DataFrame) -> list:
    """Convert a DataFrame to JSON-safe records."""
    if df.empty:
        return []
    clean = df.astype(object).where(pd.notna(df), None)
    return clean.to_dict(orient="records")


@app.get("/")
def dashboard():
    return FileResponse(DASHBOARD_DIR / "index.html")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "gold_exists": GOLD_DIR.exists(),
        "geojson_exists": GEOJSON_FILE.exists(),
    }


@app.get("/api/summary")
def summary():
    df = read_gold()
    total_cases = int(df["cases"].sum())

    diseases = (
        df.groupby("disease", as_index=False)["cases"]
        .sum()
        .sort_values("cases", ascending=False)
    )

    alerts = read_csv_or_empty(ALERTS_FILE)
    if not alerts.empty and "alert" in alerts.columns:
        alert_values = alerts["alert"].astype(str).str.lower()
        alert_count = int(alert_values.isin(["true", "1", "yes"]).sum())
    else:
        alert_count = 0

    demand = read_csv_or_empty(DEMAND_FILE)
    beds_needed = (
        int(pd.to_numeric(demand.get("beds_needed", pd.Series(dtype=float)),
                          errors="coerce").fillna(0).sum())
        if not demand.empty else 0
    )

    return {
        "total_cases": total_cases,
        "districts": int(df["district_id"].nunique()),
        "diseases": int(df["disease"].nunique()),
        "alert_weeks": alert_count,
        "estimated_beds": beds_needed,
        "date_min": df["week_start"].min().date().isoformat(),
        "date_max": df["week_start"].max().date().isoformat(),
        "disease_totals": records(diseases),
    }


@app.get("/api/weekly")
def weekly(
    district: str = Query(default="ALL"),
    disease: str = Query(default="ALL"),
):
    df = read_gold()

    if district != "ALL":
        df = df[df["district_id"] == district]
    if disease != "ALL":
        df = df[df["disease"] == disease]

    result = (
        df.groupby("week_start", as_index=False)["cases"]
        .sum()
        .sort_values("week_start")
    )
    result["week_start"] = result["week_start"].dt.strftime("%Y-%m-%d")
    return records(result)


@app.get("/api/districts")
def districts():
    df = read_gold()
    mapping = district_name_map()

    result = (
        df.groupby("district_id", as_index=False)["cases"]
        .sum()
        .sort_values("district_id")
    )
    result["district_name"] = result["district_id"].map(mapping).fillna("Unmapped")
    result = result.sort_values("cases", ascending=False)
    return records(result)


@app.get("/api/map")
def district_map():
    if not GEOJSON_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail=f"District GeoJSON not found: {GEOJSON_FILE}",
        )

    try:
        geo = json.loads(GEOJSON_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail="The district GeoJSON file is not valid JSON.",
        ) from exc

    mapping = district_name_map()
    reverse_mapping = {name: district_id for district_id, name in mapping.items()}

    df = read_gold()
    totals = (
        df.groupby("district_id", as_index=False)["cases"]
        .sum()
    )
    totals_by_id = {
        row["district_id"]: int(row["cases"])
        for row in records(totals)
    }

    for feature in geo.get("features", []):
        props = feature.setdefault("properties", {})
        name = str(props.get("shapeName", ""))
        district_id = reverse_mapping.get(name)
        props["district_id"] = district_id
        props["total_cases"] = totals_by_id.get(district_id, 0)

    return geo


@app.get("/api/alerts")
def alerts(limit: int = Query(default=100, ge=1, le=1000)):
    df = read_csv_or_empty(ALERTS_FILE)
    if df.empty:
        return []

    if "alert" in df.columns:
        flags = df["alert"].astype(str).str.lower().isin(["true", "1", "yes"])
        df = df[flags]

    if "week_start" in df.columns:
        df = df.sort_values("week_start", ascending=False)

    return records(df.head(limit))


@app.get("/api/resources")
def resources():
    demand = read_csv_or_empty(DEMAND_FILE)
    allocation = read_csv_or_empty(ALLOCATION_FILE)

    if not demand.empty and "district_id" in demand.columns:
        result = demand.copy()
        if not allocation.empty and "district_id" in allocation.columns:
            extra = [
                col for col in ["district_id", "allocated_beds", "unmet_beds"]
                if col in allocation.columns
            ]
            result = result.merge(
                allocation[extra].drop_duplicates("district_id"),
                on="district_id",
                how="left",
            )
        result = result.fillna(0)
        return records(result)

    return []


@app.get("/api/evaluation")
def evaluation():
    df = read_csv_or_empty(EVALUATION_FILE)
    if df.empty:
        return {
            "available": False,
            "events": [],
            "event_count": 0,
            "detected_count": 0,
        }

    detected_count = 0
    if "detected" in df.columns:
        detected_count = int(
            df["detected"].astype(str).str.lower()
            .isin(["true", "1", "yes"]).sum()
        )

    return {
        "available": True,
        "events": records(df),
        "event_count": len(df),
        "detected_count": detected_count,
    }
    

@app.get("/api/disease-counts")
def disease_counts(
    district: str = Query(default="ALL"),
):
    df = read_gold()

    if district != "ALL":
        df = df[df["district_id"] == district]

    result = (
        df.groupby("disease", as_index=False)["cases"]
        .sum()
        .sort_values("cases", ascending=False)
    )

    result["cases"] = result["cases"].astype(int)

    return records(result)

