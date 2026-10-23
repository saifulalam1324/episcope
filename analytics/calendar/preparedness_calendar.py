import pandas as pd

gold=pd.read_parquet("data/lake/gold/weekly_district_disease")

gold["week"]=pd.to_datetime(gold["week_start"]).dt.isocalendar().week

calendar=gold.groupby(["disease","week"])["cases"].mean().reset_index()

calendar.to_csv("analytics/calendar/preparedness_calendar.csv",index=False)

print(calendar.head())