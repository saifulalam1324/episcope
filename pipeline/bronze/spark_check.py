
from pyspark.sql import SparkSession

spark = (
    SparkSession.builder
    .appName("EpiScope-Bronze-Test")
    .master("local[*]")
    .getOrCreate()
)

input_path = "data/raw/generated/encounters.csv"

df = (
    spark.read
    .option("header", True)
    .option("inferSchema", True)
    .csv(input_path)
)

print("Total encounter records:", df.count())
print("Encounter schema:")
df.printSchema()

print("Cases by district:")
df.groupBy("district_id").count().orderBy(
    "district_id"
).show(10)

spark.stop()
