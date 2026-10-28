/* =========================================================
   EpiScope Dashboard — Complete JavaScript
   Synthetic epidemiological surveillance demo for Bangladesh
   All displayed epidemiological data must be treated as synthetic.
   ========================================================= */

const API = "/api";

const districtFilter = document.getElementById("districtFilter");
const diseaseFilter = document.getElementById("diseaseFilter");
const tooltip = d3.select("#tooltip");

const numberFormat = new Intl.NumberFormat("en-US");

const DISEASE_COLORS = [
  "#176b64",
  "#e58a32",
  "#7970c9",
  "#d34d5c",
  "#2878b5",
  "#a16a35",
  "#329b78",
  "#c04f9b",
  "#758b27",
  "#526579",
];

let districtNames = {};
let mapGeoJSON = null;
let mapSvg = null;
let mapFeatures = [];
let refreshVersion = 0;

/* =========================================================
   API AND GENERAL HELPERS
   ========================================================= */

async function getJSON(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const error = await response.json();
      message = error.detail || message;
    } catch (_) {
      // Response did not contain JSON.
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
    "'": "&#39;",
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
  return (
    `?district=${encodeURIComponent(districtFilter.value)}` +
    `&disease=${encodeURIComponent(diseaseFilter.value)}`
  );
}

function setOptions(select, rows, valueKey, labelKey, firstLabel) {
  if (!select) return;

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

  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

/* =========================================================
   FILTERS
   ========================================================= */

async function loadFilters() {
  const [districts, summary] = await Promise.all([
    getJSON("/districts"),
    getJSON("/summary"),
  ]);

  districtNames = {};

  districts.forEach((row) => {
    districtNames[String(row.district_id)] = row.district_name;
  });

  const sortedDistricts = [...districts].sort((a, b) =>
    String(a.district_name).localeCompare(String(b.district_name))
  );

  setOptions(
    districtFilter,
    sortedDistricts,
    "district_id",
    "district_name",
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

/* =========================================================
   SUMMARY CARDS
   ========================================================= */

async function loadSummary() {
  const data = await getJSON("/summary");

  const totalCases = document.getElementById("totalCases");
  const districtCount = document.getElementById("districtCount");
  const alertCount = document.getElementById("alertCount");
  const bedCount = document.getElementById("bedCount");
  const lastUpdated = document.getElementById("lastUpdated");

  if (totalCases) {
    totalCases.textContent = numberFormat.format(data.total_cases ?? 0);
  }

  if (districtCount) {
    districtCount.textContent = numberFormat.format(data.districts ?? 0);
  }

  if (alertCount) {
    alertCount.textContent = numberFormat.format(data.alert_weeks ?? 0);
  }

  if (bedCount) {
    bedCount.textContent = numberFormat.format(data.estimated_beds ?? 0);
  }

  if (lastUpdated) {
    lastUpdated.textContent =
      `Data range: ${data.date_min || "—"} to ${data.date_max || "—"}`;
  }
}

/* =========================================================
   ORIGINAL TOP WEEKLY CASE TREND
   ========================================================= */

function renderLineChart(rows) {
  const container = d3.select("#trendChart");
  container.selectAll("*").remove();

  if (!rows || !rows.length) {
    showEmpty("trendChart", "No weekly case data found.");
    return;
  }

  const data = rows
    .map((row) => ({
      date: new Date(`${row.week_start}T00:00:00`),
      cases: Number(row.cases) || 0,
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

  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("role", "img")
    .attr("aria-label", "Weekly synthetic case trend");

  let dateDomain = d3.extent(data, (d) => d.date);

  if (+dateDomain[0] === +dateDomain[1]) {
    dateDomain = [
      new Date(+dateDomain[0] - 7 * 86400000),
      new Date(+dateDomain[1] + 7 * 86400000),
    ];
  }

  const x = d3
    .scaleTime()
    .domain(dateDomain)
    .range([margin.left, width - margin.right]);

  const maxCases = d3.max(data, (d) => d.cases) || 1;

  const y = d3
    .scaleLinear()
    .domain([0, maxCases * 1.1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(Math.max(2, Math.floor(width / 100)))
        .tickFormat(d3.timeFormat("%Y-%m"))
    );

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  const line = d3
    .line()
    .x((d) => x(d.date))
    .y((d) => y(d.cases))
    .curve(d3.curveMonotoneX);

  svg
    .append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#178477")
    .attr("stroke-width", 2.5)
    .attr("d", line);

  const points = data.filter(
    (_, index) => data.length < 35 || index % Math.ceil(data.length / 30) === 0
  );

  svg
    .selectAll(".trend-point")
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
        `Synthetic cases: ${numberFormat.format(d.cases)}`
      );
    })
    .on("mouseleave", hideTooltip);
}

async function loadTrend() {
  const rows = await getJSON(`/weekly${selectedQuery()}`);
  renderLineChart(rows);
}

/* =========================================================
   ORIGINAL CASES-BY-DISEASE BAR CHART
   ========================================================= */

function renderDiseaseBarChart(containerId, rows) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();

  const data = (rows || [])
    .map((row) => ({
      disease: String(row.disease ?? "Unknown"),
      cases: Number(row.cases) || 0,
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

  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("role", "img")
    .attr("aria-label", "Synthetic case counts by disease");

  const maxCases = d3.max(data, (d) => d.cases) || 1;

  const x = d3
    .scaleLinear()
    .domain([0, maxCases])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3
    .scaleBand()
    .domain(data.map((d) => d.disease))
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(4));

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  svg
    .selectAll(".disease-bar")
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
        `Synthetic cases: ${numberFormat.format(d.cases)}`
      );
    })
    .on("mouseleave", hideTooltip);

  svg
    .selectAll(".bar-label")
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

async function loadDiseaseChartByDistrict() {
  const chart = document.getElementById("diseaseChart");
  if (!chart) return;

  chart.innerHTML = "<p class='muted'>Loading disease cases...</p>";

  const district = districtFilter.value;
  const selectedDisease = diseaseFilter.value;

  const rows = await getJSON(
    `/disease-counts?district=${encodeURIComponent(district)}`
  );

  const filteredRows =
    selectedDisease === "ALL"
      ? rows
      : rows.filter(
          (row) =>
            String(row.disease).toLowerCase() ===
            String(selectedDisease).toLowerCase()
        );

  if (!filteredRows.length) {
    showEmpty("diseaseChart", "No disease cases available for these filters.");
    return;
  }

  renderDiseaseChart(filteredRows);
}

/* =========================================================
   NEW MULTI-DISEASE TREND CHART
   Uses the existing /weekly endpoint.
   This chart is separate from the original top trend chart.
   ========================================================= */

async function loadMultiDiseaseTrend() {
  const chartId = "mapTrendChart";
  const legend = document.getElementById("mapTrendLegend");
  const container = d3.select(`#${chartId}`);

  if (!container.node()) return;

  container.selectAll("*").remove();

  if (legend) {
    legend.replaceChildren();
  }

  try {
    const district = districtFilter.value;

    // Fetch the full disease list, not just the selected disease.
    const summary = await getJSON("/summary");

    const diseases = [...new Set(
      (summary.disease_totals || [])
        .map((row) => String(row.disease || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    if (!diseases.length) {
      showEmpty(chartId, "No disease data available.");
      return;
    }

    // Ask the existing weekly endpoint for each disease separately.
    const results = await Promise.all(
      diseases.map(async (disease) => {
        const params = new URLSearchParams({
          district,
          disease,
        });

        const rows = await getJSON(`/weekly?${params.toString()}`);

        return {
          disease,
          values: (rows || [])
            .map((row) => ({
              date: new Date(`${row.week_start}T00:00:00`),
              cases: Number(row.cases) || 0,
            }))
            .filter((row) => !Number.isNaN(+row.date))
            .sort((a, b) => a.date - b.date),
        };
      })
    );

    const series = results.filter((item) => item.values.length > 0);

    if (!series.length) {
      showEmpty(chartId, "No weekly disease trends found.");
      return;
    }

    const color = d3
      .scaleOrdinal()
      .domain(series.map((item) => item.disease))
      .range(DISEASE_COLORS);

    // Build the legend.
    if (legend) {
      series.forEach((item) => {
        const legendItem = document.createElement("span");
        legendItem.className = "trend-legend-item";

        const swatch = document.createElement("span");
        swatch.className = "trend-legend-swatch";
        swatch.style.backgroundColor = color(item.disease);

        const label = document.createElement("span");
        label.textContent = item.disease;

        legendItem.append(swatch, label);
        legend.appendChild(legendItem);
      });
    }

    const allValues = series.flatMap((item) => item.values);

    let dateDomain = d3.extent(allValues, (d) => d.date);

    if (+dateDomain[0] === +dateDomain[1]) {
      dateDomain = [
        new Date(+dateDomain[0] - 7 * 86400000),
        new Date(+dateDomain[1] + 7 * 86400000),
      ];
    }

    const width = Math.max(container.node().clientWidth, 280);
    const height = 230;
    const margin = { top: 12, right: 16, bottom: 38, left: 46 };

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("role", "img")
      .attr("aria-label", "Weekly synthetic case trends by disease");

    const x = d3
      .scaleTime()
      .domain(dateDomain)
      .range([margin.left, width - margin.right]);

    const maxCases = d3.max(allValues, (d) => d.cases) || 1;

    const y = d3
      .scaleLinear()
      .domain([0, maxCases * 1.1])
      .nice()
      .range([height - margin.bottom, margin.top]);

    svg
      .append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-(width - margin.left - margin.right))
          .tickFormat("")
      );

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.max(2, Math.floor(width / 100)))
          .tickFormat(d3.timeFormat("%Y-%m"))
      );

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5));

    const line = d3
      .line()
      .defined((d) => Number.isFinite(d.cases))
      .x((d) => x(d.date))
      .y((d) => y(d.cases))
      .curve(d3.curveMonotoneX);

    series.forEach((item) => {
      const diseaseColor = color(item.disease);

      svg
        .append("path")
        .datum(item.values)
        .attr("fill", "none")
        .attr("stroke", diseaseColor)
        .attr("stroke-width", 2.2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", line);

      const points = item.values.filter(
        (_, index) =>
          item.values.length < 35 ||
          index % Math.ceil(item.values.length / 25) === 0
      );

      svg
        .selectAll(`.point-${series.indexOf(item)}`)
        .data(points)
        .join("circle")
        .attr("class", `point-${series.indexOf(item)}`)
        .attr("cx", (d) => x(d.date))
        .attr("cy", (d) => y(d.cases))
        .attr("r", 2.8)
        .attr("fill", diseaseColor)
        .on("mousemove", (event, d) => {
          showTooltip(
            event,
            `<strong>${escapeHTML(item.disease)}</strong><br>` +
            `${d3.timeFormat("%Y-%m-%d")(d.date)}<br>` +
            `Synthetic cases: ${numberFormat.format(d.cases)}`
          );
        })
        .on("mouseleave", hideTooltip);
    });
  } catch (error) {
    console.error("Could not load multi-disease trend:", error);
    showError(chartId, `Could not load disease trends: ${error.message}`);
  }
}

/* =========================================================
   DISTRICT DISEASE COUNTS TABLE
   ========================================================= */

async function loadDistrictDiseaseCounts() {
  const district = districtFilter.value;
  const title = document.getElementById("selectedDistrictTitle");
  const table = document.getElementById("districtDiseaseTable");

  if (!table) return;

  if (title) {
    title.textContent =
      district === "ALL"
        ? "Disease totals across all districts"
        : `Disease counts for ${districtNames[district] || district}`;
  }

  const rows = await getJSON(
    `/disease-counts?district=${encodeURIComponent(district)}`
  );

  table.replaceChildren();

  if (!rows.length) {
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
    casesCell.textContent = numberFormat.format(Number(row.cases) || 0);

    tr.append(diseaseCell, casesCell);
    table.appendChild(tr);
  });
}

/* =========================================================
   BANGLADESH DISTRICT MAP
   ========================================================= */

function renderMap(geojson) {
  const container = d3.select("#districtMap");

  if (!container.node()) return;

  container.selectAll("*").remove();

  const mapData = JSON.parse(JSON.stringify(geojson));

  mapData.features = (mapData.features || []).filter(
    (feature) =>
      feature.geometry &&
      ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
  );

  if (!mapData.features.length) {
    showEmpty("districtMap", "No valid district polygons found.");
    return;
  }

  mapData.features.forEach((feature) => {
    if (d3.geoArea(feature) > 2 * Math.PI) {
      const geometry = feature.geometry;

      function reverseRings(polygonCoordinates) {
        polygonCoordinates.forEach((ring) => ring.reverse());
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
  const height = Math.max(400, Math.min(720, width * 0.95));

  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("role", "img")
    .attr("aria-label", "Bangladesh district boundaries");

  const projection = d3.geoMercator().fitExtent(
    [
      [12, 12],
      [width - 12, height - 12],
    ],
    mapData
  );

  const path = d3.geoPath(projection);

  mapSvg = svg;
  mapGeoJSON = mapData;

  const maxCases =
    d3.max(
      mapFeatures,
      (feature) => Number(feature.properties?.total_cases) || 0
    ) || 1;

  const mapColorScale = d3
    .scaleSequential()
    .domain([0, maxCases])
    .interpolator(d3.interpolateOrRd);

  svg
    .selectAll("path.district")
    .data(mapFeatures)
    .join("path")
    .attr("class", "district")
    .attr("d", path)
    .attr("fill", (feature) =>
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
      const id = String(feature.properties?.district_id ?? "");

      if ([...districtFilter.options].some((option) => option.value === id)) {
        districtFilter.value = id;
        refreshFilteredViews();
      }
    });

  svg
    .selectAll("text.district-label")
    .data(mapFeatures)
    .join("text")
    .attr("class", "district-label")
    .attr("transform", (feature) => {
      const center = path.centroid(feature);

      if (!center.every(Number.isFinite)) {
        return "translate(-100,-100)";
      }

      return `translate(${center[0]},${center[1]})`;
    })
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .text(
      (feature) =>
        feature.properties?.shapeName ||
        districtNames[feature.properties?.district_id] ||
        ""
    );

  updateMapSelection();

  const mapMessage = document.getElementById("mapMessage");

  if (mapMessage) {
    mapMessage.textContent =
      `${mapFeatures.length} district shapes loaded. ` +
      "Case totals are synthetic demo values.";
  }
}

function updateMapSelection() {
  if (!mapSvg) return;

  const selectedDistrict = districtFilter.value;

  mapSvg.selectAll(".district").classed("selected", (feature) => {
    const id = String(feature.properties?.district_id ?? "");
    return selectedDistrict !== "ALL" && id === selectedDistrict;
  });
}

async function loadMap() {
  const geojson = await getJSON("/map");
  renderMap(geojson);
}

/* =========================================================
   ALERT TABLE
   ========================================================= */

async function loadAlerts() {
  const rows = await getJSON("/alerts?limit=100");
  const body = document.getElementById("alertsTable");

  if (!body) return;

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
      numberFormat.format(Number(row.cases) || 0),
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

/* =========================================================
   RESOURCE TABLE
   ========================================================= */

async function loadResources() {
  const rows = await getJSON("/resources");
  const body = document.getElementById("resourcesTable");

  if (!body) return;

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

  rows.sort(
    (a, b) => (Number(b.beds_needed) || 0) - (Number(a.beds_needed) || 0)
  );

  rows.slice(0, 30).forEach((row) => {
    const tr = document.createElement("tr");

    const values = [
      row.district_id || "—",
      numberFormat.format(Number(row.beds_needed) || 0),
      numberFormat.format(Number(row.allocated_beds) || 0),
      numberFormat.format(Number(row.unmet_beds) || 0),
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

/* =========================================================
   EVALUATION METRICS
   ========================================================= */

async function loadEvaluation() {
  const data = await getJSON("/evaluation");
  const container = document.getElementById("evaluationSummary");

  if (!container) return;

  container.replaceChildren();

  const metrics = data.available
    ? [
        ["Ground-truth events", data.event_count ?? 0],
        ["Events detected", data.detected_count ?? 0],
        [
          "Recall",
          data.event_count
            ? `${(
                (data.detected_count / data.event_count) *
                100
              ).toFixed(1)}%`
            : "N/A",
        ],
      ]
    : [["Evaluation", "Not available"]];

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

/* =========================================================
   FILTER REFRESH
   Defined ONCE so all three charts refresh correctly.
   ========================================================= */

async function refreshFilteredViews() {
  const currentVersion = ++refreshVersion;

  updateMapSelection();

  const tasks = [
    ["trendChart", loadTrend],
    ["diseaseChart", loadDiseaseChartByDistrict],
    ["districtDiseaseTable", loadDistrictDiseaseCounts],
    ["mapTrendChart", loadMultiDiseaseTrend],
  ];

  const results = await Promise.allSettled(
    tasks.map(([, task]) => task())
  );

  // Ignore older refresh results if the user changed filters again.
  if (currentVersion !== refreshVersion) return;

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const [containerId] = tasks[index];
      console.error(`Failed to refresh ${containerId}:`, result.reason);

      showError(
        containerId,
        `Could not load data: ${result.reason?.message || "Unknown error"}`
      );
    }
  });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

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
      ["diseaseChart", loadDiseaseChartByDistrict],
      ["districtDiseaseTable", loadDistrictDiseaseCounts],
      ["mapTrendChart", loadMultiDiseaseTrend],
      ["districtMap", loadMap],
      ["alertsTable", loadAlerts],
      ["resourcesTable", loadResources],
      ["evaluationSummary", loadEvaluation],
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
    showError("trendChart", `Could not start the dashboard: ${error.message}`);
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

districtFilter.addEventListener("change", refreshFilteredViews);
diseaseFilter.addEventListener("change", refreshFilteredViews);

document.getElementById("resetFilters")?.addEventListener("click", () => {
  districtFilter.value = "ALL";
  diseaseFilter.value = "ALL";
  refreshFilteredViews();
});

document.getElementById("clearMapSelection")?.addEventListener("click", () => {
  districtFilter.value = "ALL";
  refreshFilteredViews();
});

let resizeTimer;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(async () => {
    if (mapGeoJSON) {
      renderMap(mapGeoJSON);
    }

    await Promise.allSettled([
      loadTrend(),
      loadMultiDiseaseTrend(),
    ]);
  }, 180);
});

/* =========================================================
   START DASHBOARD
   ========================================================= */

init();