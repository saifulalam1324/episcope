import pandas as pd

weather=pd.read_csv("data/weather/weather_daily.csv")

weather["date"]=pd.to_datetime(weather["date"])

weather["week_start"]=weather["date"]-pd.to_timedelta(weather["date"].dt.weekday,unit="D")

weekly=weather.groupby(
    ["district_name","week_start"],
    as_index=False
).agg({
    "temperature_mean_c":"mean",
    "precipitation_mm":"sum"
})

weekly.to_csv("data/weather/weather_weekly.csv",index=False)

print(weekly.head())
print("Rows:",len(weekly))