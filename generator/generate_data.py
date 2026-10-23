
import argparse
import csv
import random
from pathlib import Path
from datetime import date, timedelta

parser = argparse.ArgumentParser()
parser.add_argument("--scale", type=float, default=0.001)
parser.add_argument("--seed", type=int, default=42)
args = parser.parse_args()

if not 0 < args.scale <= 1:
    raise ValueError("Scale must be greater than 0 and at most 1.")

random.seed(args.seed)

OUT = Path("data/raw/generated")
OUT.mkdir(parents=True, exist_ok=True)

districts = [f"D{i:03d}" for i in range(1, 65)]
diseases = {
    "dengue": ["A90", "A91"],
    "diarrhoea": ["A00", "A09"],
    "influenza": ["J10", "J11"],
    "malaria": ["B50", "B51", "B52", "B53", "B54"],
    "other": ["Z00"],
}

start = date(2021, 1, 1)
end = date(2025, 12, 31)
days = (end - start).days + 1
record_count = int(25_000_000 * args.scale)
facility_count = 600

# Create synthetic facilities.
with (OUT / "facilities.csv").open(
    "w", newline="", encoding="utf-8"
) as f:
    writer = csv.writer(f)
    writer.writerow([
        "facility_id", "district_id", "facility_type",
        "beds", "icu_beds"
    ])

    for i in range(1, facility_count + 1):
        writer.writerow([
            f"F{i:04d}",
            random.choice(districts),
            random.choice([
                "hospital", "upazila_health_complex", "clinic"
            ]),
            random.randint(10, 300),
            random.randint(0, 30),
        ])

# Create reproducible synthetic encounters in chunks.
ground_truth = []

for i in range(30):
    outbreak_start = start + timedelta(
        days=random.randint(0, days - 60)
    )
    ground_truth.append([
        f"OB{i+1:03d}",
        random.choice(districts),
        random.choice(["dengue", "diarrhoea", "influenza", "malaria"]),
        outbreak_start.isoformat(),
        (outbreak_start + timedelta(days=random.randint(14, 45))).isoformat(),
    ])

with (OUT / "ground_truth_outbreaks.csv").open(
    "w", newline="", encoding="utf-8"
) as f:
    writer = csv.writer(f)
    writer.writerow([
        "outbreak_id", "district_id", "disease",
        "start_date", "end_date"
    ])
    writer.writerows(ground_truth)

outbreaks = [
    (
        row[1], row[2],
        date.fromisoformat(row[3]),
        date.fromisoformat(row[4]),
    )
    for row in ground_truth
]

with (OUT / "encounters.csv").open(
    "w", newline="", encoding="utf-8"
) as f:
    writer = csv.writer(f)
    writer.writerow([
        "encounter_id", "patient_id", "facility_id",
        "district_id", "onset_date", "report_date",
        "age_years", "sex", "icd10_code",
        "lab_confirmed", "admitted", "outcome"
    ])

    for batch_start in range(0, record_count, 100_000):
        batch_end = min(batch_start + 100_000, record_count)

        for i in range(batch_start, batch_end):
            onset = start + timedelta(days=random.randrange(days))
            district = random.choice(districts)

            weights = [0.30, 0.20, 0.20, 0.10, 0.20]
            disease = random.choices(
                list(diseases), weights=weights, k=1
            )[0]

            # Inject increased case probability during known outbreaks.
            if random.random() < 0.15:
                for d, illness, first, last in outbreaks:
                    if (
                        d == district and illness == disease
                        and first <= onset <= last
                    ):
                        disease = illness
                        break

            delay = min(
                int(random.expovariate(0.25)), 21
            )
            report = onset + timedelta(days=delay)

            # Approximately 2% duplicate encounter IDs.
            encounter_id = (
                f"E{random.randint(0, i-1):09d}"
                if i > 0 and random.random() < 0.02
                else f"E{i:09d}"
            )

            # Approximately 0.5% orphan facility keys.
            facility_num = (
                601 if random.random() < 0.005
                else random.randint(1, facility_count)
            )

            age = (
                212 if random.random() < 0.01
                else random.randint(0, 95)
            )

            writer.writerow([
                encounter_id,
                f"P{random.randint(1, max(1, record_count // 2)):09d}",
                f"F{facility_num:04d}",
                district,
                onset.isoformat(),
                report.isoformat(),
                age,
                random.choice(["M", "F"]),
                random.choice(diseases[disease]),
                random.choice([0, 1]),
                random.choice([0, 1]),
                random.choice(["recovered", "admitted", "unknown"]),
            ])

print(f"Generated {record_count:,} encounters.")
print("Output directory:", OUT.resolve())
print("Synthetic outbreak events:", len(ground_truth))
