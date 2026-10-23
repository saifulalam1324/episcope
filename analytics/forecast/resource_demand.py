
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "analytics/forecast/forecasts.csv"
OUTPUT = ROOT / "analytics/forecast/resource_demand.csv"

forecast = pd.read_csv(INPUT)

demand = (
    forecast.groupby("district_id", as_index=False)
    .agg(
        forecast_cases=("forecast_cases", "sum"),
        forecast_week=("forecast_week", "first")
    )
)

# Illustrative planning assumptions only; replace with locally
# validated clinical and supply-planning requirements.
demand["beds_needed"] = np.ceil(demand["forecast_cases"] * 0.15).astype(int)
demand["saline_needed"] = demand["forecast_cases"] * 2
demand["ors_needed"] = demand["forecast_cases"] * 5

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
demand.to_csv(OUTPUT, index=False)

print("Districts:", len(demand))
print("Forecast week:", demand["forecast_week"].min())
print("Total forecast cases:", int(demand["forecast_cases"].sum()))
print("Total estimated beds:", int(demand["beds_needed"].sum()))
print("Saved:", OUTPUT)
print(demand.head(10).to_string(index=False))
