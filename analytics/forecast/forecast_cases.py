
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data/lake/gold/weekly_district_disease"
OUTPUT = ROOT / "analytics/forecast/forecasts.csv"

gold = pd.read_parquet(INPUT)
gold["week_start"] = pd.to_datetime(gold["week_start"])

weeks = pd.date_range(
    gold["week_start"].min(),
    gold["week_start"].max(),
    freq="W-MON"
)
last_week = weeks[-1]

records = []

for (district, disease), group in gold.groupby(["district_id", "disease"]):
    series = (
        group.set_index("week_start")["cases"]
        .reindex(weeks)
        .fillna(0)
    )

    records.append({
        "district_id": district,
        "disease": disease,
        "last_observed_week": last_week.date().isoformat(),
        "forecast_week": (last_week + pd.Timedelta(days=7)).date().isoformat(),
        "last_week_cases": int(series.iloc[-1]),
        "forecast_cases": int(series.iloc[-1]),
        "method": "persistence_baseline"
    })

forecast = pd.DataFrame(records)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
forecast.to_csv(OUTPUT, index=False)

print("Forecast rows:", len(forecast))
print("Forecast week:", forecast["forecast_week"].min())
print("Total forecast cases:", int(forecast["forecast_cases"].sum()))
print(forecast.head(10).to_string(index=False))
print("Saved:", OUTPUT)
