
from pathlib import Path

from pyspark.sql import SparkSession, functions as F

ROOT = Path(__file__).resolve().parents[2]
SILVER = ROOT / "data" / "lake" / "silver" / "encounters"
GOLD = ROOT / "data" / "lake" / "gold" / "weekly_district_disease"

spark = (
    SparkSession.builder
    .appName("EpiScope-Gold-Aggregation")
    .master("local[*]")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

try:
    df = spark.read.parquet(str(SILVER))

    df = df.withColumn(
        "disease",
        F.when(F.col("icd10_code").isin("A90", "A91"), "dengue")
        .when(F.col("icd10_code").isin("A00", "A09"), "diarrhoea")
        .when(F.col("icd10_code").isin("J10", "J11"), "influenza")
        .when(
            F.col("icd10_code").isin("B50", "B51", "B52", "B53", "B54"),
            "malaria"
        )
        .otherwise("other")
    )

    weekly = (
        df.withColumn(
            "week_start",
            F.to_date(F.date_trunc("week", F.col("onset_date")))
        )
        .groupBy("district_id", "disease", "week_start")
        .agg(
            F.count("*").alias("cases"),
            F.sum("admitted").alias("admissions"),
            F.sum("lab_confirmed").alias("lab_confirmed_cases"),
        )
        .withColumn(
            "year",
            F.year("week_start")
        )
    )

    (
        weekly.write
        .mode("overwrite")
        .partitionBy("year")
        .parquet(str(GOLD))
    )

    print("Gold aggregation successful")
    print("Weekly district-disease rows:", weekly.count())
    print("Output:", GOLD)
    weekly.orderBy(
        "week_start", "district_id", "disease"
    ).show(10, truncate=False)

finally:
    spark.stop()
