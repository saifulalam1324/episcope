
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]

TRUTH_FILE = ROOT / "data/raw/generated/ground_truth_outbreaks.csv"
ALERT_FILE = ROOT / "analytics/detection/ears_alerts.csv"
GOLD_FILE = ROOT / "data/lake/gold/weekly_district_disease"
OUTPUT_FILE = ROOT / "analytics/detection/evaluation_results.csv"

# Load data
truth = pd.read_csv(TRUTH_FILE)
alerts = pd.read_csv(ALERT_FILE)
gold = pd.read_parquet(GOLD_FILE)

truth["start_date"] = pd.to_datetime(truth["start_date"])
truth["end_date"] = pd.to_datetime(truth["end_date"])
alerts["week_start"] = pd.to_datetime(alerts["week_start"])
gold["week_start"] = pd.to_datetime(gold["week_start"])

# Ensure alert values are interpreted as booleans
alerts["alert"] = (
    alerts["alert"].astype(str).str.lower().isin(["true", "1", "yes"])
)
alert_rows = alerts[alerts["alert"]].copy()

# A weekly record covers Monday through Sunday.
# It overlaps an outbreak if any day in that week overlaps its dates.
def overlaps(week_start, start_date, end_date):
    week_end = week_start + pd.Timedelta(days=6)
    return week_start <= end_date and week_end >= start_date


results = []

for _, event in truth.iterrows():
    matching_alerts = alert_rows[
        (alert_rows["district_id"] == event["district_id"])
        & (alert_rows["disease"] == event["disease"])
    ].copy()

    if not matching_alerts.empty:
        matching_alerts["overlap"] = matching_alerts["week_start"].apply(
            lambda week: overlaps(
                week, event["start_date"], event["end_date"]
            )
        )
        event_alerts = matching_alerts[matching_alerts["overlap"]]
    else:
        event_alerts = matching_alerts

    detected = not event_alerts.empty

    if detected:
        first_alert_week = event_alerts["week_start"].min()
        # Zero delay if the alert's week starts before the outbreak begins
        delay_days = max(
            0, (first_alert_week - event["start_date"]).days
        )
    else:
        first_alert_week = pd.NaT
        delay_days = None

    # Compare outbreak-period cases with the previous 7 calendar weeks
    series = gold[
        (gold["district_id"] == event["district_id"])
        & (gold["disease"] == event["disease"])
    ][["week_start", "cases"]].copy()

    series = (
        series.groupby("week_start", as_index=False)["cases"].sum()
        .set_index("week_start")
        .sort_index()
    )

    if not series.empty:
        all_weeks = pd.date_range(
            series.index.min(), series.index.max(), freq="W-MON"
        )
        series = series.reindex(all_weeks, fill_value=0)
        series.index.name = "week_start"

        during = series[
            (series.index <= event["end_date"])
            & (
                series.index + pd.Timedelta(days=6)
                >= event["start_date"]
            )
        ]["cases"]

        before = series[
            (series.index < event["start_date"])
            & (
                series.index
                >= event["start_date"] - pd.Timedelta(days=49)
            )
        ]["cases"]

        peak_during = int(during.max()) if not during.empty else 0
        baseline_mean = (
            float(before.mean()) if not before.empty else None
        )
        cases_above_baseline = (
            peak_during > baseline_mean
            if baseline_mean is not None
            else None
        )
    else:
        peak_during = 0
        baseline_mean = None
        cases_above_baseline = None

    results.append({
        "outbreak_id": event["outbreak_id"],
        "district_id": event["district_id"],
        "disease": event["disease"],
        "start_date": event["start_date"].date().isoformat(),
        "end_date": event["end_date"].date().isoformat(),
        "detected": detected,
        "first_alert_week": (
            first_alert_week.date().isoformat()
            if detected else ""
        ),
        "delay_days": delay_days,
        "peak_cases_during": peak_during,
        "baseline_mean_before": baseline_mean,
        "cases_above_baseline": cases_above_baseline,
    })

evaluation = pd.DataFrame(results)
OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
evaluation.to_csv(OUTPUT_FILE, index=False)

detected_events = int(evaluation["detected"].sum())
total_events = len(evaluation)
matched_alerts = int(
    alert_rows.apply(
        lambda alert: any(
            (event["district_id"] == alert["district_id"])
            and (event["disease"] == alert["disease"])
            and overlaps(
                alert["week_start"],
                event["start_date"],
                event["end_date"],
            )
            for _, event in truth.iterrows()
        ),
        axis=1,
    ).sum()
)

print("Ground-truth events:", total_events)
print("Events detected:", detected_events)
print(
    "Event detection recall:",
    f"{detected_events / total_events:.1%}"
    if total_events else "N/A",
)
print("Alert weeks:", len(alert_rows))
print("Alert weeks overlapping known events:", matched_alerts)
print(
    "Alert precision:",
    f"{matched_alerts / len(alert_rows):.1%}"
    if len(alert_rows) else "N/A",
)
print(
    "Events with cases above preceding baseline:",
    int((evaluation["cases_above_baseline"] == True).sum()),
)
print("Saved:", OUTPUT_FILE)
print()
print(evaluation.head(10).to_string(index=False))
