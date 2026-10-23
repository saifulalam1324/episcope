
from pathlib import Path
from datetime import datetime, timezone
import json

from pyspark.sql import SparkSession

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data" / "raw" / "generated" / "encounters.csv"
OUTPUT = ROOT / "data" / "lake" / "bronze" / "encounters"
REPORT = ROOT / "data" / "reports" / "bronze_ingestion.json"

if not INPUT.exists():
    raise FileNotFoundError(f"Input file not found: {INPUT}")

spark = (
    SparkSession.builder
    .appName("EpiScope-Bronze-Ingestion")
    .master("local[*]")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

try:
    df = (
        spark.read
        .option("header", True)
        .option("inferSchema", True)
        .option("dateFormat", "yyyy-MM-dd")
        .csv(str(INPUT))
    )

    count = df.count()

    # This prototype refreshes the derived Bronze output on each run.
    df.write.mode("overwrite").parquet(str(OUTPUT))

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "source": str(INPUT.relative_to(ROOT)),
        "output": str(OUTPUT.relative_to(ROOT)),
        "rows_read": count,
        "ingestion_time_utc": datetime.now(
            timezone.utc
        ).isoformat(),
        "format": "parquet",
        "status": "success",
    }
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Bronze ingestion successful")
    print("Rows:", count)
    print("Parquet:", OUTPUT)
    print("Report:", REPORT)

finally:
    spark.stop()
