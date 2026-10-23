
const API = "/api";

const districtFilter = document.getElementById("districtFilter");
const diseaseFilter = document.getElementById("diseaseFilter");
const tooltip = d3.select("#tooltip");

const numberFormat = new Intl.NumberFormat("en-US");

let districtNames = {};
let mapGeoJSON = null;
let mapColorScale = null;
let mapSvg = null;
let mapPath = null;
let mapFeatures = [];

async function getJSON(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const error = await response.json();
      message = error.detail || message;
    } catch (_) {
    }

    throw new Error(message);
  }

  return response.json();
}

function showError(containerId, message) {
  const container = document.getElementById(containerId);

  if (!container) return;

  container.replaceChildren();

  const div = document.createElement("div");
  div.className = "error";
  div.textContent = message;

  container.appendChild(div);
}

function showEmpty(containerId, message) {
  const container = document.getElementById(containerId);

  if (!container) return;

  container.replaceChildren();

  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;

  container.appendChild(div);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showTooltip(event, html) {
  const tooltipWidth = 280;
  const left = Math.max(
    8,
    Math.min(event.clientX + 12, window.innerWidth - tooltipWidth)
  );

  const top = Math.max(
    8,
    Math.min(event.clientY + 12, window.innerHeight - 110)
  );

  tooltip
    .style("display", "block")
    .html(html)
    .style("left", `${left}px`)
    .style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.style("display", "none");
}

function selectedQuery() {
  const district = encodeURIComponent(districtFilter.value);
  const disease = encodeURIComponent(diseaseFilter.value);

  return `?district=${district}&disease=${disease}`;
}

function setOptions(select, rows, valueKey, labelKey, firstLabel) {
  const previousValue = select.value;

  select.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "ALL";
  allOption.textContent = firstLabel;

  select.appendChild(allOption);

  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = String(row[valueKey]);
    option.textContent = String(row[labelKey]);

    select.appendChild(option);
  });

  if (
    [...select.options].some(
      (option) => option.value === previousValue
    )
  ) {
    select.value = previousValue;
  }
}

async function loadFilters() {
  const [districts, summary] = await Promise.all([
    getJSON("/districts"),
    getJSON("/summary")
  ]);

  districtNames = {};

  districts.forEach((row) => {
    districtNames[row.district_id] = row.district_name;
  });

  const sortedDistricts = [...districts].sort((a, b) =>
    String(a.district_id).localeCompare(String(b.district_id))
  );

  setOptions(
    districtFilter,
    sortedDistricts,
    "district_id",
    "district_id",
    "All districts"
  );

  const diseases = [...(summary.disease_totals || [])].sort((a, b) =>
    String(a.disease).localeCompare(String(b.disease))
  );

  setOptions(
    diseaseFilter,
    diseases,
    "disease",
    "disease",
    "All diseases"
  );
}

async function loadSummary() {
  const data = await getJSON("/summary");

  document.getElementById("totalCases").textContent =
    numberFormat.format(data.total_cases ?? 0);

  document.getElementById("districtCount").textContent =
    numberFormat.format(data.districts ?? 0);

  document.getElementById("alertCount").textContent =
    numberFormat.format(data.alert_weeks ?? 0);

  document.getElementById("bedCount").textContent =
    numberFormat.format(data.estimated_beds ?? 0);

  document.getElementById("lastUpdated").textContent =
    `Data range: ${data.date_min || "—"} to ${data.date_max || "—"}`;

  renderDiseaseChart(data.disease_totals || []);
}

/* WEEKLY CASE TREND */

function renderLineChart(rows) {
  const container = d3.select("#trendChart");
  container.selectAll("*").remove();

  if (!rows.length) {
    showEmpty("trendChart", "No weekly case data found.");
    return;
  }

  const data = rows
    .map((row) => ({
      date: new Date(`${row.week_start}T00:00:00`),
      cases: Number(row.cases) || 0
    }))
    .filter((row) => !Number.isNaN(+row.date))
    .sort((a, b) => a.date - b.date);

  if (!data.length) {
    showEmpty("trendChart", "No valid weekly dates found.");
    return;
  }

  const width = Math.max(container.node().clientWidth, 300);
  const height = 280;
  const margin = { top: 16, right: 20, bottom: 42, left: 48 };

  const svg = container.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Weekly reported case trend");

  let dateDomain = d3.extent(data, (d) => d.date);

  if (+dateDomain[0] === +dateDomain[1]) {
    dateDomain = [
      new Date(+dateDomain[0] - 7 * 86400000),
      new Date(+dateDomain[1] + 7 * 86400000)
    ];
  }

  const x = d3.scaleTime()
    .domain(dateDomain)
    .range([margin.left, width - margin.right]);

  const maxCases = d3.max(data, (d) => d.cases) || 1;

  const y = d3.scaleLinear()
    .domain([0, maxCases * 1.1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(Math.max(2, Math.floor(width / 100)))
        .tickFormat(d3.timeFormat("%Y-%m"))
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  const line = d3.line()
    .x((d) => x(d.date))
    .y((d) => y(d.cases))
    .curve(d3.curveMonotoneX);

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#178477")
    .attr("stroke-width", 2.5)
    .attr("d", line);

  const points = data.filter((_, index) =>
    data.length < 35 ||
    index % Math.ceil(data.length / 30) === 0
  );

  svg.selectAll(".trend-point")
    .data(points)
    .join("circle")
    .attr("class", "trend-point")
    .attr("cx", (d) => x(d.date))
    .attr("cy", (d) => y(d.cases))
    .attr("r", 3.5)
    .attr("fill", "#178477")
    .on("mousemove", (event, d) => {
      showTooltip(
        event,
        `<strong>${d3.timeFormat("%Y-%m-%d")(d.date)}</strong><br>` +
        `Cases: ${numberFormat.format(d.cases)}`
      );
    })
    .on("mouseleave", hideTooltip);
}

async function loadTrend() {
  const rows = await getJSON(`/weekly${selectedQuery()}`);
  renderLineChart(rows);
}

/* REUSABLE HORIZONTAL DISEASE BAR CHART */

function renderDiseaseBarChart(containerId, rows) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();

  const data = rows
    .map((row) => ({
      disease: String(row.disease ?? "Unknown"),
      cases: Number(row.cases) || 0
    }))
    .sort((a, b) => a.cases - b.cases);

  if (!data.length) {
    showEmpty(containerId, "No disease counts available.");
    return;
  }

  const width = Math.max(container.node().clientWidth, 300);
  const rowHeight = 38;
  const margin = { top: 12, right: 45, bottom: 30, left: 100 };
  const height = Math.max(
    220,
    data.length * rowHeight + margin.top + margin.bottom
  );

  const svg = container.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Disease case counts");

  const maxCases = d3.max(data, (d) => d.cases) || 1;

  const x = d3.scaleLinear()
    .domain([0, maxCases])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((d) => d.disease))
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(4));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  svg.selectAll(".disease-bar")
    .data(data)
    .join("rect")
    .attr("class", "disease-bar")
    .attr("x", margin.left)
    .attr("y", (d) => y(d.disease))
    .attr("width", (d) => Math.max(0, x(d.cases) - margin.left))
    .attr("height", y.bandwidth())
    .attr("rx", 4)
    .attr("fill", "#2d8c80")
    .on("mousemove", (event, d) => {
      showTooltip(
        event,
        `<strong>${escapeHTML(d.disease)}</strong><br>` +
        `Cases: ${numberFormat.format(d.cases)}`
      );
    })
    .on("mouseleave", hideTooltip);

  svg.selectAll(".bar-label")
    .data(data)
    .join("text")
    .attr("class", "bar-label")
    .attr("x", (d) => x(d.cases) + 5)
    .attr("y", (d) => y(d.disease) + y.bandwidth() / 2 + 4)
    .text((d) => numberFormat.format(d.cases));
}

function renderDiseaseChart(rows) {
  renderDiseaseBarChart("diseaseChart", rows);
}

/* SELECTED DISTRICT DISEASE COUNTS */

async function loadDistrictDiseaseCounts() {
  const district = districtFilter.value;
  const title = document.getElementById("selectedDistrictTitle");
  const table = document.getElementById("districtDiseaseTable");

  title.textContent = district === "ALL"
    ? "Disease totals across all districts"
    : `Disease counts for ${district}`;

  const rows = await getJSON(
    `/disease-counts?district=${encodeURIComponent(district)}`
  );

  table.replaceChildren();

  if (!rows.length) {
    showEmpty("districtDiseaseChart", "No disease counts available.");

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = "No disease counts available.";

    tr.appendChild(td);
    table.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const diseaseCell = document.createElement("td");
    diseaseCell.textContent = row.disease ?? "Unknown";

    const casesCell = document.createElement("td");
    casesCell.textContent = numberFormat.format(
      Number(row.cases) || 0
    );

    tr.append(diseaseCell, casesCell);
    table.appendChild(tr);
  });

  renderDiseaseBarChart("districtDiseaseChart", rows);
}

/* BANGLADESH DISTRICT MAP */



function renderMap(geojson) {
  const container = d3.select("#districtMap");
  container.selectAll("*").remove();

  // Work on a copy so the original API response is not modified.
  const mapData = JSON.parse(JSON.stringify(geojson));

  // Keep valid district polygon geometries.
  mapData.features = (mapData.features || []).filter(feature =>
    feature.geometry &&
    ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
  );

  if (!mapData.features.length) {
    showEmpty("districtMap", "No valid district polygons found.");
    return;
  }

  // D3 expects exterior rings clockwise and interior rings counterclockwise.
  // Some GeoJSON sources use the opposite orientation.
  mapData.features.forEach(feature => {
    if (d3.geoArea(feature) > 2 * Math.PI) {
      const geometry = feature.geometry;

      function reverseRings(polygonCoordinates) {
        polygonCoordinates.forEach(ring => ring.reverse());
      }

      if (geometry.type === "Polygon") {
        reverseRings(geometry.coordinates);
      } else if (geometry.type === "MultiPolygon") {
        geometry.coordinates.forEach(reverseRings);
      }
    }
  });

  mapFeatures = mapData.features;

  const width = Math.max(container.node().clientWidth, 320);
  const height = Math.max(400, Math.min(650, width * 0.85));

  const svg = container.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Bangladesh district boundaries");

  // Let D3 calculate the projection scale and position from the full country.
  const projection = d3.geoMercator()
    .fitExtent(
      [[20, 20], [width - 20, height - 20]],
      mapData
    );

  const path = d3.geoPath(projection);

  mapSvg = svg;
  mapPath = path;
  mapGeoJSON = mapData;

  const maxCases =
    d3.max(mapFeatures, feature =>
      Number(feature.properties?.total_cases) || 0
    ) || 1;

  mapColorScale = d3.scaleSequential()
    .domain([0, maxCases])
    .interpolator(d3.interpolateOrRd);

  // Draw the district boundaries.
  svg.selectAll("path.district")
    .data(mapFeatures)
    .join("path")
    .attr("class", "district")
    .attr("d", path)
    .attr("fill", feature =>
      mapColorScale(Number(feature.properties?.total_cases) || 0)
    )
    .on("mousemove", (event, feature) => {
      const props = feature.properties || {};

      showTooltip(
        event,
        `<strong>${escapeHTML(props.district_id || "Unmapped")}</strong><br>` +
        `${escapeHTML(props.shapeName || "District")}<br>` +
        `Synthetic cases: ${numberFormat.format(
          Number(props.total_cases) || 0
        )}`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, feature) => {
      const id = feature.properties?.district_id;

      if (
        id &&
        [...districtFilter.options].some(option => option.value === id)
      ) {
        districtFilter.value = id;
        refreshFilteredViews();
      }
    });

  // Label each district with its demo ID.
  svg.selectAll("text.district-label")
    .data(mapFeatures)
    .join("text")
    .attr("class", "district-label")
    .attr("transform", feature => {
      const center = path.centroid(feature);

      if (!center.every(Number.isFinite)) {
        return "translate(-100,-100)";
      }

      return `translate(${center[0]},${center[1]})`;
    })
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .text(feature => feature.properties?.district_id || "")
    .style("pointer-events", "none");

  updateMapSelection();

  document.getElementById("mapMessage").textContent =
    `${mapFeatures.length} district shapes loaded. ` +
    "IDs and case counts use a synthetic demo mapping.";
}

function updateMapSelection() {
  if (!mapSvg) return;

  const selectedDistrict = districtFilter.value;

  mapSvg.selectAll(".district")
    .classed("selected", (feature) => {
      const id = feature.properties?.district_id;

      return selectedDistrict !== "ALL" &&
        id === selectedDistrict;
    });
}

async function loadMap() {
  const geojson = await getJSON("/map");
  renderMap(geojson);
}

/* ALERT TABLE */

async function loadAlerts() {
  const rows = await getJSON("/alerts?limit=100");
  const body = document.getElementById("alertsTable");

  body.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "No alert rows available.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.slice(0, 20).forEach((row) => {
    const tr = document.createElement("tr");

    const values = [
      row.week_start || "—",
      row.district_id || "—",
      row.disease || "—",
      numberFormat.format(Number(row.cases) || 0)
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

/* RESOURCE TABLE */

async function loadResources() {
  const rows = await getJSON("/resources");
  const body = document.getElementById("resourcesTable");

  body.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent =
      "Resource output unavailable. Run forecasting and allocation first.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.sort((a, b) =>
    (Number(b.beds_needed) || 0) -
    (Number(a.beds_needed) || 0)
  );

  rows.slice(0, 30).forEach((row) => {
    const tr = document.createElement("tr");

    const values = [
      row.district_id || "—",
      numberFormat.format(Number(row.beds_needed) || 0),
      numberFormat.format(Number(row.allocated_beds) || 0),
      numberFormat.format(Number(row.unmet_beds) || 0)
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

/* EVALUATION METRICS */

async function loadEvaluation() {
  const data = await getJSON("/evaluation");
  const container = document.getElementById("evaluationSummary");

  container.replaceChildren();

  const metrics = data.available
    ? [
        ["Ground-truth events", data.event_count ?? 0],
        ["Events detected", data.detected_count ?? 0],
        [
          "Recall",
          data.event_count
            ? `${(
                (data.detected_count / data.event_count) * 100
              ).toFixed(1)}%`
            : "N/A"
        ]
      ]
    : [
        ["Evaluation", "Not available"]
      ];

  metrics.forEach(([label, value]) => {
    const chip = document.createElement("div");
    chip.className = "metric-chip";

    const labelNode = document.createElement("span");
    labelNode.textContent = label;

    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);

    chip.append(labelNode, valueNode);
    container.appendChild(chip);
  });
}

/* FILTER REFRESH */

async function refreshFilteredViews() {
  updateMapSelection();

  const results = await Promise.allSettled([
    loadTrend(),
    loadDistrictDiseaseCounts()
  ]);

  if (results[0].status === "rejected") {
    showError("trendChart", results[0].reason.message);
  }

  if (results[1].status === "rejected") {
    showError("districtDiseaseChart", results[1].reason.message);
    showError("districtDiseaseTable", results[1].reason.message);
  }
}

/* INITIALIZE DASHBOARD */

async function init() {
  try {
    const health = await getJSON("/health");

    if (health.status !== "ok") {
      throw new Error("API health check failed.");
    }

    await loadFilters();

    const tasks = [
      ["summary", loadSummary],
      ["trendChart", loadTrend],
      ["districtDiseaseChart", loadDistrictDiseaseCounts],
      ["districtMap", loadMap],
      ["alertsTable", loadAlerts],
      ["resourcesTable", loadResources],
      ["evaluationSummary", loadEvaluation]
    ];

    await Promise.all(
      tasks.map(async ([containerId, task]) => {
        try {
          await task();
        } catch (error) {
          console.error(`Failed to load ${containerId}:`, error);
          showError(containerId, error.message);
        }
      })
    );
  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    showError(
      "trendChart",
      `Could not start the dashboard: ${error.message}`
    );
  }
}

/* EVENT LISTENERS */

districtFilter.addEventListener("change", refreshFilteredViews);
diseaseFilter.addEventListener("change", refreshFilteredViews);

document.getElementById("resetFilters").addEventListener("click", () => {
  districtFilter.value = "ALL";
  diseaseFilter.value = "ALL";

  refreshFilteredViews();
});

document.getElementById("clearMapSelection").addEventListener("click", () => {
  districtFilter.value = "ALL";
  refreshFilteredViews();
});

window.addEventListener("resize", () => {
  if (mapGeoJSON) {
    renderMap(mapGeoJSON);
  }

  refreshFilteredViews();
});

init();
