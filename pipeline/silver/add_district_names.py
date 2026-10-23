from pyspark.sql import SparkSession

spark=SparkSession.builder.master("local[*]").appName("DistrictMapping").getOrCreate()

silver=spark.read.parquet("data/lake/silver/encounters")
mapping=spark.read.option("header",True).csv("data/reference/district_mapping.csv")

result=silver.join(mapping,"district_id")

result.write.mode("overwrite").parquet("data/lake/silver/encounters_named")

print("Rows:",result.count())
result.select("district_id","district_name").show(10)