
from pathlib import Path
import pandas as pd
import pulp

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "analytics/forecast/resource_demand.csv"
OUTPUT = ROOT / "analytics/optimise/allocation_results.csv"

CAPACITY = 500

demand = pd.read_csv(INPUT)
needs = demand.set_index("district_id")["beds_needed"].to_dict()
districts = list(needs.keys())

model = pulp.LpProblem("DistrictBedAllocation", pulp.LpMinimize)

allocated = {
    d: pulp.LpVariable(
        f"allocated_{d}", lowBound=0, cat=pulp.LpInteger
    )
    for d in districts
}
unmet = {
    d: pulp.LpVariable(
        f"unmet_{d}", lowBound=0, cat=pulp.LpInteger
    )
    for d in districts
}

# Minimize the number of beds that remain unmet.
model += pulp.lpSum(unmet[d] for d in districts)

for d in districts:
    model += allocated[d] <= int(needs[d])
    model += allocated[d] + unmet[d] == int(needs[d])

model += pulp.lpSum(allocated[d] for d in districts) <= CAPACITY

status = model.solve(pulp.PULP_CBC_CMD(msg=False))

if pulp.LpStatus[status] != "Optimal":
    raise RuntimeError(f"Optimization failed: {pulp.LpStatus[status]}")

results = pd.DataFrame([
    {
        "district_id": d,
        "beds_needed": int(needs[d]),
        "allocated_beds": int(round(pulp.value(allocated[d]))),
        "unmet_beds": int(round(pulp.value(unmet[d])))
    }
    for d in districts
])

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
results.to_csv(OUTPUT, index=False)

print("Solver status:", pulp.LpStatus[status])
print("Capacity:", CAPACITY)
print("Beds allocated:", int(results["allocated_beds"].sum()))
print("Beds unmet:", int(results["unmet_beds"].sum()))
print("Saved:", OUTPUT)
print(results.sort_values("unmet_beds", ascending=False).head(10).to_string(index=False))
