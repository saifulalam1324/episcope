
from pathlib import Path
import json

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.window import Window

ROOT = Path(__file__).resolve().parents[2]
BRONZE = ROOT / "data" / "lake" / "bronze" / "encounters"
FACILITIES = ROOT / "data" / "raw" / "generated" / "facilities.csv"
SILVER = ROOT / "data" / "lake" / "silver" / "encounters"
QUARANTINE = ROOT / "data" / "quarantine" / "encounters"
REPORT = ROOT / "data" / "reports" / "silver_quality.json"

spark = (
    SparkSession.builder
    .appName("EpiScope-Silver-Cleaning")
    .master("local[*]")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

try:
    df = spark.read.parquet(str(BRONZE))
    facilities = (
        spark.read.option("header", True)
        .csv(str(FACILITIES))
        .select("facility_id")
        .distinct()
        .withColumn("facility_exists", F.lit(True))
    )

    # Identify duplicate IDs before choosing one valid record.
    window = Window.partitionBy("encounter_id").orderBy(
        F.col("report_date").asc_nulls_last()
    )

    ranked = df.withColumn(
        "_row_number", F.row_number().over(window)
    )

    duplicate_rows = ranked.filter(
        F.col("_row_number") > 1
    ).drop("_row_number")

    unique = ranked.filter(
        F.col("_row_number") == 1
    ).drop("_row_number")

    checked = unique.join(
        F.broadcast(facilities), on="facility_id", how="left"
    )

    reasons = F.array_compact(F.array(
        F.when(
            F.col("encounter_id").isNull()
            | (F.trim(F.col("encounter_id")) == ""),
            F.lit("missing_encounter_id")
        ),
        F.when(
            F.col("patient_id").isNull()
            | (F.trim(F.col("patient_id")) == ""),
            F.lit("missing_patient_id")
        ),
        F.when(
            F.col("district_id").isNull()
            | (F.trim(F.col("district_id")) == ""),
            F.lit("missing_district_id")
        ),
        F.when(
            F.col("onset_date").isNull()
            | F.col("report_date").isNull(),
            F.lit("invalid_date")
        ),
        F.when(
            F.col("report_date") < F.col("onset_date"),
            F.lit("report_before_onset")
        ),
        F.when(
            F.col("age_years").isNull()
            | (F.col("age_years") < 0)
            | (F.col("age_years") > 120),
            F.lit("invalid_age")
        ),
        F.when(
            F.col("facility_exists").isNull(),
            F.lit("orphan_facility")
        ),
        F.when(
            ~F.col("lab_confirmed").isin(0, 1)
            | F.col("lab_confirmed").isNull(),
            F.lit("invalid_lab_flag")
        ),
        F.when(
            ~F.col("admitted").isin(0, 1)
            | F.col("admitted").isNull(),
            F.lit("invalid_admission_flag")
        ),
        F.when(
            ~F.col("sex").isin("M", "F"),
            F.lit("invalid_sex")
        ),
        F.when(
            F.col("icd10_code").isNull()
            | (F.trim(F.col("icd10_code")) == ""),
            F.lit("missing_icd10")
        ),
    )).alias("reasons")

    checked = checked.withColumn("reasons", reasons)

    rejected = checked.filter(F.size("reasons") > 0)
    valid = checked.filter(F.size("reasons") == 0)

    # Remove the temporary registry-match field before storage.
    valid = valid.drop("facility_exists")

    # Hash patient IDs with a configurable secret salt.
    # Set EPISCOPE_HASH_SALT to a private, random value.
    import os
    salt = os.environ.get("EPISCOPE_HASH_SALT")
    if not salt:
        raise RuntimeError(
            "Set EPISCOPE_HASH_SALT before running Silver."
        )

    valid = valid.withColumn(
        "patient_id_hash",
        F.sha2(F.concat(F.lit(salt), F.col("patient_id")), 256)
    ).drop("patient_id")

    duplicate_quarantine = duplicate_rows.withColumn(
        "reasons", F.array(F.lit("duplicate_encounter_id"))
    )

    # Save valid data and rejected records separately.
    valid.write.mode("overwrite").parquet(str(SILVER))
    (
        rejected.select(*df.columns, "reasons")
        .unionByName(
            duplicate_quarantine.select(*df.columns, "reasons")
        )
        .write.mode("overwrite").parquet(str(QUARANTINE))
    )

    input_count = df.count()
    duplicate_count = duplicate_rows.count()
    valid_count = valid.count()
    rejected_count = rejected.count()

    report = {
        "input_rows": input_count,
        "duplicate_rows_quarantined": duplicate_count,
        "invalid_unique_rows_quarantined": rejected_count,
        "valid_rows": valid_count,
        "quarantined_rows": duplicate_count + rejected_count,
        "rules": [
            "missing_encounter_id",
            "missing_patient_id",
            "missing_district_id",
            "invalid_date",
            "report_before_onset",
            "invalid_age",
            "orphan_facility",
            "invalid_lab_flag",
            "invalid_admission_flag",
            "invalid_sex",
            "missing_icd10",
            "duplicate_encounter_id",
        ],
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    print("Silver output:", SILVER)
    print("Quarantine:", QUARANTINE)

finally:
    spark.stop()
