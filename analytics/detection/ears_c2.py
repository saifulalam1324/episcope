
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data/lake/gold/weekly_district_disease"
OUTPUT = ROOT / "analytics/detection/ears_alerts.csv"

gold = pd.read_parquet(INPUT)
gold["week_start"] = pd.to_datetime(gold["week_start"])
gold = gold.sort_values(["district_id", "disease", "week_start"])

all_weeks = pd.date_range(
    gold["week_start"].min(),
    gold["week_start"].max(),
    freq="W-MON"
)

results = []

for (district, disease), group in gold.groupby(["district_id", "disease"]):
    group = group.set_index("week_start").sort_index()
    group = group.reindex(all_weeks)
    group.index.name = "week_start"

    group["district_id"] = district
    group["disease"] = disease

    for column in ["cases", "admissions", "lab_confirmed_cases"]:
        group[column] = group[column].fillna(0)

    group["cases"] = group["cases"].astype(int)

    # Use only previous weeks to establish the baseline.
    group["baseline_mean"] = (
        group["cases"].rolling(window=7, min_periods=4).mean().shift(1)
    )
    group["baseline_std"] = (
        group["cases"].rolling(window=7, min_periods=4).std(ddof=0).shift(1)
    )

    # Require a rise of at least 2 cases above the baseline,
    # or 2 standard deviations when that is a larger threshold.
    group["alert_threshold"] = (
        group["baseline_mean"]
        + np.maximum(2, 2 * group["baseline_std"].fillna(0))
    )

    group["alert"] = (
        group["baseline_mean"].notna()
        & (group["cases"] >= group["alert_threshold"])
        & (group["cases"] >= 2)
    )

    group["z"] = np.where(
        group["baseline_std"] > 0,
        (group["cases"] - group["baseline_mean"]) / group["baseline_std"],
        np.nan
    )

    results.append(group.reset_index())

alerts = pd.concat(results, ignore_index=True)
alerts["year"] = alerts["week_start"].dt.year

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
alerts.to_csv(OUTPUT, index=False)

print("Weekly district-disease records:", len(alerts))
print("Alerts:", int(alerts["alert"].sum()))
print("Output:", OUTPUT)
print(
    alerts.loc[alerts["alert"], [
        "district_id", "disease", "week_start", "cases",
        "baseline_mean", "alert_threshold"
    ]].head(10).to_string(index=False)
)
