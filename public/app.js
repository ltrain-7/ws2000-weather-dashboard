const state = {
  config: null,
  devices: [],
  latestByMac: new Map(),
  selectedMac: localStorage.getItem("selectedMac") || "",
  chartMetric: localStorage.getItem("chartMetric") || "tempf",
  historyDate: "",
  historyRangeDays: 0,
  history: [],
  comparisonHistory: [],
  analytics: null,
  stationHealthByMac: new Map(),
  comparePrevious: localStorage.getItem("comparePrevious") === "true",
  insightTab: localStorage.getItem("insightTab") || "summary",
  historyLoading: false,
  historyError: "",
  forecast: null,
  forecastLoading: false,
  forecastRetries: 0,
  eventStreamFailures: 0,
  eventStreamDisconnectedAt: null
};
const historyTime = window.WeatherHistoryTime;

let chartModel = null;

const els = {
  stationSelect: document.getElementById("stationSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusPill: document.getElementById("statusPill"),
  updatedAt: document.getElementById("updatedAt"),
  setupBanner: document.getElementById("setupBanner"),
  updateBanner: document.getElementById("updateBanner"),
  reloadUpdate: document.getElementById("reloadUpdate"),
  healthBanner: document.getElementById("healthBanner"),
  healthTitle: document.getElementById("healthTitle"),
  healthDetail: document.getElementById("healthDetail"),
  temperatureValue: document.getElementById("temperatureValue"),
  feelsLikeValue: document.getElementById("feelsLikeValue"),
  humidityValue: document.getElementById("humidityValue"),
  windValue: document.getElementById("windValue"),
  gustValue: document.getElementById("gustValue"),
  pressureValue: document.getElementById("pressureValue"),
  rainValue: document.getElementById("rainValue"),
  rainDetailValue: document.getElementById("rainDetailValue"),
  indoorValue: document.getElementById("indoorValue"),
  indoorHumidityValue: document.getElementById("indoorHumidityValue"),
  solarValue: document.getElementById("solarValue"),
  uvValue: document.getElementById("uvValue"),
  dewPointValue: document.getElementById("dewPointValue"),
  batteryValue: document.getElementById("batteryValue"),
  windDirectionValue: document.getElementById("windDirectionValue"),
  compass: document.getElementById("compass"),
  compassNeedle: document.getElementById("compassNeedle"),
  moreConditions: document.getElementById("moreConditions"),
  forecastSection: document.getElementById("forecastSection"),
  forecastTitle: document.getElementById("forecastTitle"),
  forecastStatus: document.getElementById("forecastStatus"),
  forecastGrid: document.getElementById("forecastGrid"),
  chartTitle: document.getElementById("chartTitle"),
  historyOptions: document.getElementById("historyOptions"),
  historyDate: document.getElementById("historyDate"),
  historyCoverage: document.getElementById("historyCoverage"),
  comparePrevious: document.getElementById("comparePrevious"),
  historyChart: document.getElementById("historyChart"),
  chartTooltip: document.getElementById("chartTooltip"),
  chartLegend: document.getElementById("chartLegend"),
  chartMessage: document.getElementById("chartMessage"),
  chartSummary: document.getElementById("chartSummary"),
  chartDataTable: document.getElementById("chartDataTable"),
  summaryGrid: document.getElementById("summaryGrid"),
  comparisonTitle: document.getElementById("comparisonTitle"),
  comparisonGrid: document.getElementById("comparisonGrid"),
  rainfallGrid: document.getElementById("rainfallGrid")
};

const metricConfig = {
  tempf: { label: "Temperature", unit: "°F", color: "#c75545" },
  humidity: { label: "Humidity", unit: "%", color: "#0f8b8d" },
  windspeedmph: { label: "Wind speed", unit: "mph", color: "#2f6f9f" },
  dailyrainin: { label: "Daily rain", unit: "in", color: "#a86f08" }
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  setMetricButtons();
  setInsightTab(state.insightTab);
  configureResponsiveDisclosures();
  els.comparePrevious.checked = state.comparePrevious;
  els.reloadUpdate.addEventListener("click", () => window.location.reload());

  try {
    state.config = await fetchJson("/api/config");
    els.historyDate.max = toDateInputValue(new Date(), state.config.stationTimezone);
    els.setupBanner.hidden = Boolean(state.config.configured);
    const latest = await fetchJson("/api/latest");
    applyState(latest);
    connectEventStream();
    await Promise.all([loadHistory(), loadForecast()]);
    registerServiceWorker();
  } catch (error) {
    setStatus("error", "Offline");
    els.healthTitle.textContent = "Weather service unavailable";
    els.healthDetail.textContent = error.message;
    renderEmpty();
  }
}

function bindEvents() {
  els.stationSelect.addEventListener("change", async () => {
    state.selectedMac = els.stationSelect.value;
    localStorage.setItem("selectedMac", state.selectedMac);
    render();
    await loadHistory();
  });

  els.refreshBtn.addEventListener("click", async () => {
    els.refreshBtn.disabled = true;
    try {
      const latest = await fetchJson("/api/refresh", { method: "POST" });
      applyState(latest);
      await Promise.all([loadHistory(), loadForecast()]);
    } catch (error) {
      els.healthDetail.textContent = error.message;
    } finally {
      els.refreshBtn.disabled = false;
    }
  });

  const metricButtons = Array.from(document.querySelectorAll("[data-metric]"));
  metricButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.chartMetric = button.dataset.metric;
      localStorage.setItem("chartMetric", state.chartMetric);
      setMetricButtons();
      drawChart();
    });
  });
  bindTabKeyboard(metricButtons, (button) => button.click());

  const insightButtons = Array.from(document.querySelectorAll("[data-insight]"));
  insightButtons.forEach((button) => {
    button.addEventListener("click", () => setInsightTab(button.dataset.insight));
  });
  bindTabKeyboard(insightButtons, (button) => button.click());

  els.historyDate.addEventListener("change", async () => {
    state.historyDate = els.historyDate.value;
    state.historyRangeDays = 0;
    setRangeButtons();
    await loadHistory();
  });

  document.querySelectorAll("[data-range-days]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.historyRangeDays = Number(button.dataset.rangeDays) || 0;
      state.historyDate = "";
      els.historyDate.value = "";
      setRangeButtons();
      await loadHistory();
    });
  });

  els.comparePrevious.addEventListener("change", async () => {
    state.comparePrevious = els.comparePrevious.checked;
    localStorage.setItem("comparePrevious", String(state.comparePrevious));
    await loadHistory();
    if (state.comparePrevious) setInsightTab("comparison");
  });

  els.historyChart.addEventListener("pointermove", showChartTooltip);
  els.historyChart.addEventListener("pointerleave", hideChartTooltip);
  els.historyChart.addEventListener("pointercancel", hideChartTooltip);
  window.addEventListener("resize", () => {
    hideChartTooltip();
    drawChart();
  });
}

async function loadForecast() {
  if (state.forecastLoading || state.config?.forecastEnabled === false) return;
  state.forecastLoading = true;
  try {
    state.forecast = await fetchJson("/api/forecast");
    renderForecast();
    if (state.forecast.enabled && !state.forecast.available && state.forecast.reason === "location-unavailable" && state.forecastRetries < 3) {
      state.forecastRetries += 1;
      window.setTimeout(loadForecast, state.forecastRetries * 5000);
    } else if (state.forecast.available) {
      state.forecastRetries = 0;
    }
  } catch {
    state.forecast = { enabled: true, available: false, reason: "provider-unavailable" };
    renderForecast();
  } finally {
    state.forecastLoading = false;
  }
}

function renderForecast() {
  const forecast = state.forecast;
  if (!forecast?.enabled) {
    els.forecastSection.hidden = true;
    return;
  }
  els.forecastSection.hidden = false;
  if (!forecast.available) {
    els.forecastTitle.textContent = "Local outlook";
    els.forecastStatus.textContent = forecast.reason === "location-unavailable"
      ? "Waiting for station location…"
      : "Forecast temporarily unavailable";
    els.forecastGrid.replaceChildren();
    return;
  }

  els.forecastTitle.textContent = forecast.locationName || "Local outlook";
  els.forecastStatus.textContent = `${forecast.stale ? "Last forecast" : "Updated"} ${formatTime(forecast.updatedAt)}`;
  const fragment = document.createDocumentFragment();
  for (const [index, day] of (forecast.days || []).entries()) {
    const view = window.WeatherForecast.cardView(day, index);
    const card = document.createElement("article");
    card.className = "forecast-card";
    card.setAttribute("aria-label", view.accessibleLabel);

    const heading = document.createElement("div");
    heading.className = "forecast-card-heading";
    const dayName = document.createElement("strong");
    dayName.textContent = view.dayLabel;
    const date = document.createElement("span");
    date.textContent = view.dateLabel;
    heading.append(dayName, date);

    const condition = document.createElement("div");
    condition.className = "forecast-condition";
    const icon = document.createElement("span");
    icon.className = "forecast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = view.icon;
    const description = document.createElement("span");
    description.textContent = view.condition;
    condition.append(icon, description);

    const temperatures = document.createElement("p");
    temperatures.className = "forecast-temperatures";
    temperatures.textContent = `${view.high} / ${view.low}`;
    const details = document.createElement("p");
    details.className = "forecast-details";
    details.textContent = `${view.rain} · ${view.gust}`;
    card.append(heading, condition, temperatures, details);
    fragment.append(card);
  }
  els.forecastGrid.replaceChildren(fragment);
}

function connectEventStream() {
  const source = new EventSource("/api/events");
  source.addEventListener("open", () => {
    state.eventStreamFailures = 0;
    state.eventStreamDisconnectedAt = null;
  });
  source.addEventListener("state", (event) => applyState(JSON.parse(event.data)));
  source.addEventListener("update", (event) => {
    const payload = JSON.parse(event.data);
    applyState(payload.state);
    if (
      !state.historyDate &&
      !state.historyRangeDays &&
      payload.data &&
      payload.data.macAddress === state.selectedMac
    ) {
      mergeHistoryPoint(payload.data);
      drawChart();
    }
  });
  source.addEventListener("error", () => {
    if (!state.config?.configured) return;
    state.eventStreamFailures += 1;
    state.eventStreamDisconnectedAt ||= Date.now();
    const extendedOutage = state.eventStreamFailures >= 5
      || Date.now() - state.eventStreamDisconnectedAt >= 30000;
    setStatus("error", extendedOutage ? "Still reconnecting" : "Reconnecting");
    if (extendedOutage) {
      els.healthDetail.textContent = "Live updates are still unavailable. Try Refresh if the connection does not recover.";
    }
  });
}

function applyState(payload) {
  if (!payload) return;

  state.devices = Array.isArray(payload.devices) ? payload.devices : [];
  state.latestByMac.clear();
  state.stationHealthByMac.clear();
  for (const item of payload.latest || []) {
    if (item && item.macAddress) {
      state.latestByMac.set(item.macAddress, item);
    }
  }
  for (const health of payload.stationHealth || []) {
    if (health?.macAddress) state.stationHealthByMac.set(health.macAddress, health);
  }

  if (!state.selectedMac) {
    state.selectedMac =
      payload.targetMac ||
      state.devices[0]?.macAddress ||
      state.latestByMac.keys().next().value ||
      "";
  }

  const realtime = payload.realtime || {};
  const rest = payload.rest || {};
  const status = realtime.status || rest.status || "idle";
  const label = statusLabel(status);
  setStatus(status, label);

  if (!payload.configured) {
    els.setupBanner.hidden = false;
  }

  renderStationOptions();
  render();
  if (state.config?.forecastEnabled && state.forecast?.reason === "location-unavailable" && !state.forecastLoading) {
    window.setTimeout(loadForecast, 0);
  }
}

async function loadHistory() {
  if (!state.selectedMac) {
    state.history = [];
    state.comparisonHistory = [];
    drawChart();
    return;
  }

  state.historyLoading = true;
  state.historyError = "";
  drawChart();
  try {
    const historicalView = Boolean(state.historyDate || state.historyRangeDays);
    const limit = historicalView ? 10000 : state.config?.historyLimit || 96;
    const dateRange = state.historyDate
      ? historyDateRange(state.historyDate)
      : rollingDateRange(state.historyRangeDays);
    const dateParams = dateRange
      ? `&startDate=${encodeURIComponent(dateRange.start)}&endDate=${encodeURIComponent(dateRange.end)}&maxPoints=${state.config?.historyMaxPoints || 480}&source=local`
      : "";
    const result = await fetchJson(
      `/api/history?mac=${encodeURIComponent(state.selectedMac)}&limit=${limit}${dateParams}`
    );
    state.history = normalizeHistory(result.data || result.fallback?.data || []);
    state.comparisonHistory = [];
    if ((state.comparePrevious || state.historyDate) && dateRange) {
      const comparisonRange = previousDateRange(dateRange);
      try {
        const comparison = await fetchJson(
          `/api/history?mac=${encodeURIComponent(state.selectedMac)}&limit=${limit}&startDate=${encodeURIComponent(comparisonRange.start)}&endDate=${encodeURIComponent(comparisonRange.end)}&maxPoints=${state.config?.historyMaxPoints || 480}&source=local`
        );
        state.comparisonHistory = normalizeHistory(comparison.data || []);
      } catch {}
    }
    try {
      state.analytics = await fetchJson(
        `/api/analytics?mac=${encodeURIComponent(state.selectedMac)}&days=${state.historyRangeDays || 1}`
      );
    } catch {
      state.analytics = null;
    }
  } catch {
    state.historyError = "Stored history could not be loaded. Showing the latest available reading.";
    state.history = liveOnlyHistory();
    state.comparisonHistory = [];
  } finally {
    state.historyLoading = false;
  }
  setRangeButtons();
  drawChart();
  renderInsights();
}

function renderStationOptions() {
  const currentValue = els.stationSelect.value;
  const known = state.devices.length
    ? state.devices
    : state.selectedMac
      ? [{ macAddress: state.selectedMac, info: { name: state.selectedMac } }]
      : [];

  els.stationSelect.innerHTML = "";
  if (!known.length) {
    const option = document.createElement("option");
    option.textContent = "No station yet";
    option.value = "";
    els.stationSelect.append(option);
    els.stationSelect.disabled = true;
    return;
  }

  els.stationSelect.disabled = false;
  for (const device of known) {
    const option = document.createElement("option");
    option.value = device.macAddress;
    option.textContent = stationName(device);
    els.stationSelect.append(option);
  }

  if (known.some((device) => device.macAddress === state.selectedMac)) {
    els.stationSelect.value = state.selectedMac;
  } else if (known.some((device) => device.macAddress === currentValue)) {
    state.selectedMac = currentValue;
    els.stationSelect.value = currentValue;
  } else {
    state.selectedMac = known[0].macAddress;
    els.stationSelect.value = state.selectedMac;
  }
}

function render() {
  const device = selectedDevice();
  const data = selectedData();

  if (!data) {
    renderEmpty();
    return;
  }

  els.updatedAt.textContent = data.dateutc ? formatTime(data.dateutc) : "--";
  if (data.dateutc) {
    els.updatedAt.dateTime = new Date(Number(data.dateutc)).toISOString();
    els.updatedAt.setAttribute("aria-label", `Exact update time ${formatTime(data.dateutc)}`);
  }
  els.temperatureValue.textContent = formatTemp(data.tempf);
  els.feelsLikeValue.textContent = `Feels like ${formatTemp(data.feelsLike)}`;
  els.humidityValue.textContent = formatPercent(data.humidity);
  els.windValue.textContent = formatWind(data.windspeedmph);
  els.gustValue.textContent = `Gust ${formatWind(data.windgustmph)}`;
  els.pressureValue.textContent = formatPressure(data.baromrelin);
  els.rainValue.textContent = formatRain(data.dailyrainin);
  els.rainDetailValue.textContent = `Hour ${formatRain(data.hourlyrainin)}`;
  els.indoorValue.textContent = formatTemp(data.tempinf);
  els.indoorHumidityValue.textContent = `Humidity ${formatPercent(data.humidityin)}`;
  els.solarValue.textContent = formatSolar(data.solarradiation);
  els.uvValue.textContent = `UV ${formatValue(data.uv)}`;
  els.dewPointValue.textContent = formatTemp(data.dewPoint);
  els.batteryValue.textContent = formatBattery(data.battout);
  const direction = compassText(data.winddir);
  els.windDirectionValue.textContent = direction;
  els.compass.setAttribute("aria-label", Number.isFinite(Number(data.winddir)) ? `Wind direction ${direction}, ${Math.round(Number(data.winddir))} degrees` : "Wind direction unavailable");
  els.compassNeedle.style.transform = `rotate(${Number(data.winddir || 0)}deg)`;
  renderHealth();
}

function renderEmpty() {
  els.temperatureValue.textContent = "--";
  els.feelsLikeValue.textContent = "Feels like --";
  els.humidityValue.textContent = "--";
  els.windValue.textContent = "--";
  els.gustValue.textContent = "Gust --";
  els.pressureValue.textContent = "--";
  els.rainValue.textContent = "--";
  els.rainDetailValue.textContent = "Today";
  els.indoorValue.textContent = "--";
  els.indoorHumidityValue.textContent = "Humidity --";
  els.solarValue.textContent = "--";
  els.uvValue.textContent = "UV --";
  els.dewPointValue.textContent = "--";
  els.batteryValue.textContent = "--";
  els.windDirectionValue.textContent = "--";
  els.compass.setAttribute("aria-label", "Wind direction unavailable");
  els.compassNeedle.style.transform = "rotate(0deg)";
  els.updatedAt.textContent = "--";
  renderHealth();
}

function drawChart() {
  hideChartTooltip();
  const canvas = els.historyChart;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(240, Math.floor(rect.height || canvas.height));
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  chartModel = null;

  const metric = metricConfig[state.chartMetric] || metricConfig.tempf;
  const rangeTitle = state.historyDate
    ? formatSelectedDate(state.historyDate)
    : state.historyRangeDays
      ? rangeLabel(state.historyRangeDays)
      : "Latest readings";
  els.chartTitle.textContent = `${rangeTitle}${trendMethodLabel()}`;
  canvas.setAttribute("aria-label", `${metric.label} history chart: ${els.chartTitle.textContent}`);
  els.chartLegend.innerHTML = "";
  els.chartMessage.textContent = "";
  els.chartSummary.textContent = "";
  els.chartDataTable.innerHTML = "";

  const rawPoints = normalizeHistory(state.history)
    .map((item) => ({
      at: Number(item.dateutc || Date.parse(item.date || "")),
      value: Number(item[state.chartMetric])
    }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value));
  const points = trendPoints(rawPoints);
  const comparisonPoints = trendPointsFor(
    normalizeHistory(state.comparisonHistory)
      .map((item) => ({ at: Number(item.dateutc || Date.parse(item.date || "")), value: Number(item[state.chartMetric]) }))
      .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value))
  );

  const pad = { left: 48, right: 18, top: 20, bottom: 34 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  drawChartFrame(ctx, width, height, pad);

  if (state.historyLoading) {
    els.chartMessage.textContent = "Loading chart data…";
    drawEmptyChartLabel(ctx, pad.left, height / 2, "Loading chart data…");
    return;
  }

  if (points.length < 2) {
    const message = state.historyError || (state.historyDate || state.historyRangeDays
      ? "No readings are stored for this period."
      : "Waiting for enough readings to draw a trend.");
    els.chartMessage.textContent = message;
    drawEmptyChartLabel(ctx, pad.left, height / 2, message);
    renderChartData(points, comparisonPoints, metric);
    return;
  }

  const values = [...points, ...comparisonPoints].map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const currentMin = Math.min(...points.map((point) => point.value));
  const currentMax = Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const yMin = min - span * 0.12;
  const yMax = max + span * 0.12;
  const xMin = points[0].at;
  const xMax = points[points.length - 1].at;

  drawYAxis(ctx, pad, chartWidth, chartHeight, yMin, yMax, metric.unit);

  const currentProjection = projectSeries(points, pad, chartWidth, chartHeight, yMin, yMax);
  const previousProjection = comparisonPoints.length > 1
    ? projectSeries(comparisonPoints, pad, chartWidth, chartHeight, yMin, yMax)
    : [];
  drawProjectedSeries(ctx, currentProjection, metric.color, false);
  drawProjectedSeries(ctx, previousProjection, "#707c7f", true);

  const last = currentProjection[currentProjection.length - 1];
  ctx.fillStyle = metric.color;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#667579";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(formatTime(points[0].at), pad.left, height - 10);
  const endLabel = formatTime(points[points.length - 1].at);
  ctx.fillText(endLabel, width - pad.right - ctx.measureText(endLabel).width, height - 10);

  chartModel = {
    metric,
    bounds: { left: pad.left, right: width - pad.right, top: pad.top, bottom: height - pad.bottom },
    points: [
      ...currentProjection.map((point) => ({ ...point, series: "Current period" })),
      ...previousProjection.map((point) => ({ ...point, series: "Previous period" }))
    ]
  };
  renderChartLegend(metric, previousProjection.length > 1);
  els.chartMessage.textContent = state.historyError;
  const latest = points[points.length - 1];
  els.chartSummary.textContent = `${metric.label}: ${points.length} plotted values from ${formatTime(xMin)} to ${formatTime(xMax)}. Minimum ${formatMetricValue(metric, currentMin)}, maximum ${formatMetricValue(metric, currentMax)}, latest ${formatMetricValue(metric, latest.value)}.`;
  renderChartData(points, comparisonPoints, metric);
}

function drawEmptyChartLabel(ctx, x, y, message) {
  ctx.fillStyle = "#59696d";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(message, x, y);
}

function drawChartFrame(ctx, width, height, pad) {
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  ctx.strokeStyle = "#d8ded9";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, chartWidth, chartHeight);
  ctx.strokeStyle = "#edf1ee";
  for (let index = 1; index < 4; index += 1) {
    const y = pad.top + (chartHeight / 4) * index;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
}

function drawYAxis(ctx, pad, chartWidth, chartHeight, min, max, unit) {
  ctx.fillStyle = "#667579";
  ctx.font = "12px system-ui, sans-serif";
  for (let index = 0; index <= 4; index += 1) {
    const value = max - ((max - min) / 4) * index;
    const y = pad.top + (chartHeight / 4) * index + 4;
    const label = formatUnitValue(value, unit);
    ctx.fillText(label, 6, y);
  }
}

function selectedDevice() {
  return state.devices.find((device) => device.macAddress === state.selectedMac) || null;
}

function selectedData() {
  return state.latestByMac.get(state.selectedMac) || selectedDevice()?.lastData || null;
}

function mergeHistoryPoint(point) {
  state.history = normalizeHistory([...state.history, point]).slice(-288);
}

function liveOnlyHistory() {
  const latest = selectedData();
  return latest ? [latest] : [];
}

function normalizeHistory(history) {
  const deduped = new Map();
  for (const item of history || []) {
    const key = item.dateutc || item.date || JSON.stringify(item);
    deduped.set(key, item);
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const left = a.dateutc || Date.parse(a.date || "");
    const right = b.dateutc || Date.parse(b.date || "");
    return left - right;
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function setMetricButtons() {
  document.querySelectorAll("[data-metric]").forEach((button) => {
    const selected = button.dataset.metric === state.chartMetric;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function setRangeButtons() {
  const firstReadingAt = Date.parse(state.analytics?.coverage?.firstReadingAt || "");
  const availableDays = Number.isFinite(firstReadingAt)
    ? Math.max(1, Math.ceil((Date.now() - firstReadingAt) / 86400000))
    : 0;
  document.querySelectorAll("[data-range-days]").forEach((button) => {
    const days = Number(button.dataset.rangeDays) || 0;
    button.classList.toggle(
      "active",
      !state.historyDate && days === state.historyRangeDays
    );
    button.setAttribute("aria-pressed", String(!state.historyDate && days === state.historyRangeDays));
    const partial = days > 0 && availableDays > 0 && availableDays < days;
    button.classList.toggle("partial", partial);
    if (partial) button.title = `${availableDays} days of stored data are currently available`;
    else button.removeAttribute("title");
  });
  renderHistoryCoverage(firstReadingAt, availableDays);
}

function renderHistoryCoverage(firstReadingAt, availableDays) {
  if (!Number.isFinite(firstReadingAt)) {
    els.historyCoverage.textContent = "Stored history will appear after the first saved reading.";
    return;
  }
  const since = formatTimestampDate(firstReadingAt);
  if (state.historyRangeDays > 0 && availableDays < state.historyRangeDays) {
    els.historyCoverage.textContent = `Partial range: ${availableDays} of ${state.historyRangeDays} days available since ${since}.`;
    return;
  }
  els.historyCoverage.textContent = `Data available since ${since}. 1D is a rolling 24-hour period.`;
}

function setInsightTab(value) {
  const allowed = ["summary", "comparison", "rainfall"];
  state.insightTab = allowed.includes(value) ? value : "summary";
  localStorage.setItem("insightTab", state.insightTab);
  document.querySelectorAll("[data-insight]").forEach((button) => {
    const selected = button.dataset.insight === state.insightTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[data-insight-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.insightPanel !== state.insightTab;
  });
}

function bindTabKeyboard(buttons, activate) {
  buttons.forEach((button, index) => {
    button.addEventListener("keydown", (event) => {
      let next = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % buttons.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      if (next === null) return;
      event.preventDefault();
      activate(buttons[next]);
      buttons[next].focus();
    });
  });
}

function configureResponsiveDisclosures() {
  const mobile = window.matchMedia("(max-width: 760px)");
  const shortDesktop = window.matchMedia("(min-width: 761px) and (max-height: 900px)");
  const apply = () => {
    const compactConditions = mobile.matches || shortDesktop.matches;
    if (!compactConditions) {
      els.moreConditions.open = true;
    } else if (mobile.matches) {
      els.moreConditions.open = localStorage.getItem("moreConditionsOpen") === "true";
    } else {
      els.moreConditions.open = localStorage.getItem("shortDesktopConditionsOpen") === "true";
    }
    els.historyOptions.open = mobile.matches
      ? localStorage.getItem("historyOptionsOpen") === "true"
      : true;
  };
  els.moreConditions.addEventListener("toggle", () => {
    if (mobile.matches) {
      localStorage.setItem("moreConditionsOpen", String(els.moreConditions.open));
    } else if (shortDesktop.matches) {
      localStorage.setItem("shortDesktopConditionsOpen", String(els.moreConditions.open));
    }
  });
  els.historyOptions.addEventListener("toggle", () => {
    if (mobile.matches) localStorage.setItem("historyOptionsOpen", String(els.historyOptions.open));
  });
  mobile.addEventListener("change", apply);
  shortDesktop.addEventListener("change", apply);
  apply();
}

function trendPoints(points) {
  return trendPointsFor(points);
}

function trendPointsFor(points) {
  if (state.historyRangeDays < 30 || points.length < 2) return points;
  if (state.chartMetric === "dailyrainin") return dailyRainTotals(points);

  const smoothingHours = state.historyRangeDays >= 180
    ? 48
    : state.historyRangeDays >= 90
      ? 24
      : 6;
  return rollingAverage(points, smoothingHours * 60 * 60 * 1000);
}

function projectSeries(points, pad, chartWidth, chartHeight, yMin, yMax) {
  if (!points.length) return [];
  const firstAt = points[0].at;
  const timeSpan = points[points.length - 1].at - firstAt || 1;
  return points.map((point) => ({
    ...point,
    x: pad.left + ((point.at - firstAt) / timeSpan) * chartWidth,
    y: pad.top + (1 - (point.value - yMin) / (yMax - yMin)) * chartHeight
  }));
}

function drawProjectedSeries(ctx, points, color, dashed) {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = dashed ? 2 : 3;
  ctx.setLineDash(dashed ? [7, 6] : []);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.setLineDash([]);
}

function renderChartLegend(metric, hasPrevious) {
  const current = `<span class="legend-item"><span class="legend-swatch" style="background:${metric.color}"></span>Current period</span>`;
  const previous = hasPrevious ? `<span class="legend-item"><span class="legend-swatch previous"></span>Previous period</span>` : "";
  els.chartLegend.innerHTML = current + previous;
}

function renderChartData(points, comparisonPoints, metric) {
  const fragment = document.createDocumentFragment();
  for (const [label, series] of [["Current", points], ["Previous", comparisonPoints]]) {
    for (const point of series) {
      const row = document.createElement("tr");
      for (const text of [label, formatTime(point.at), formatMetricValue(metric, point.value)]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      fragment.append(row);
    }
  }
  if (!fragment.childNodes.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No chart data for this period.";
    row.append(cell);
    fragment.append(row);
  }
  els.chartDataTable.replaceChildren(fragment);
}

function showChartTooltip(event) {
  if (!chartModel?.points.length) return;
  const rect = els.historyChart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { bounds } = chartModel;
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
    hideChartTooltip();
    return;
  }
  const closest = chartModel.points.reduce((best, point) => {
    const distance = Math.hypot(point.x - x, (point.y - y) * 0.7);
    return !best || distance < best.distance ? { point, distance } : best;
  }, null)?.point;
  if (!closest) return;
  els.chartTooltip.textContent = `${closest.series} · ${formatTime(closest.at)} · ${formatMetricValue(chartModel.metric, closest.value)}`;
  els.chartTooltip.style.left = `${Math.min(rect.width - 80, Math.max(80, closest.x))}px`;
  els.chartTooltip.style.top = `${Math.max(36, closest.y)}px`;
  els.chartTooltip.hidden = false;
}

function hideChartTooltip() {
  els.chartTooltip.hidden = true;
}

function renderHealth() {
  const health = state.stationHealthByMac.get(state.selectedMac);
  const device = selectedDevice();
  const data = selectedData();
  els.healthBanner.className = `station-status ${health?.status || "unknown"}`;
  els.healthTitle.textContent = device ? stationSubtitle(device) : "Weather station";
  if (!health) {
    els.healthDetail.textContent = data?.dateutc ? formatRelativeAge(data.dateutc) : "Waiting for the first reading.";
    return;
  }
  els.statusPill.className = `status-pill ${health.status}`;
  els.statusPill.textContent = health.status === "online" ? "Online" : health.status === "warning" ? "Attention" : "Offline";
  const details = [];
  if (data?.dateutc) details.push(formatRelativeAge(data.dateutc));
  else if (Number.isFinite(health.ageMinutes)) details.push(formatAgeMinutes(health.ageMinutes));
  details.push(health.batteryLow ? "Battery low" : "Battery OK");
  els.healthDetail.textContent = details.join(" · ");
}

function renderInsights() {
  const view = window.WeatherInsights.render({
    analytics: state.analytics,
    comparisonHistory: state.comparisonHistory,
    history: state.history,
    historyDate: state.historyDate,
    historyRangeDays: state.historyRangeDays,
    normalizeHistory
  }, { formatDateOnly, formatSelectedDate, formatTime, formatUnitValue, rangeLabel });
  els.summaryGrid.innerHTML = view.summaryHtml;
  els.comparisonGrid.innerHTML = view.comparisonHtml;
  els.comparisonTitle.textContent = view.comparisonTitle;
  els.rainfallGrid.innerHTML = view.rainfallHtml;
}

function rollingAverage(points, windowMs) {
  const smoothed = [];
  let startIndex = 0;
  let sum = 0;

  for (let index = 0; index < points.length; index += 1) {
    sum += points[index].value;
    while (points[index].at - points[startIndex].at > windowMs) {
      sum -= points[startIndex].value;
      startIndex += 1;
    }
    smoothed.push({
      at: points[index].at,
      value: sum / (index - startIndex + 1)
    });
  }
  return smoothed;
}

function dailyRainTotals(points) {
  const days = new Map();
  for (const point of points) {
    const date = new Date(point.at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const current = days.get(key);
    if (!current || point.value >= current.value) days.set(key, point);
  }
  return Array.from(days.values()).sort((left, right) => left.at - right.at);
}

function trendMethodLabel() {
  if (state.historyRangeDays < 30) return "";
  if (state.chartMetric === "dailyrainin") return " · Daily totals";
  if (state.historyRangeDays >= 180) return " · 48h average";
  if (state.historyRangeDays >= 90) return " · 24h average";
  return " · 6h average";
}

function setStatus(status, label) {
  els.statusPill.className = `status-pill ${status}`;
  els.statusPill.textContent = label;
}

function statusLabel(status) {
  const labels = {
    live: "Live",
    subscribed: "Subscribed",
    connected: "Connected",
    ok: "Online",
    syncing: "Syncing",
    idle: "Idle",
    "missing-config": "Setup",
    "dependency-missing": "Install",
    disconnected: "Offline",
    error: "Error"
  };
  return labels[status] || status;
}

function stationName(device) {
  return device.info?.name || "Weather station";
}

function stationSubtitle(device) {
  const pieces = [stationName(device)];
  if (device.info?.location) pieces.push(device.info.location);
  return pieces.filter(Boolean).join(" | ");
}

function formatTemp(value) {
  return hasNumericValue(value) ? `${round(value)}°F` : "--";
}

function formatPercent(value) {
  return hasNumericValue(value) ? `${round(value)}%` : "--";
}

function formatWind(value) {
  return hasNumericValue(value) ? `${round(value)} mph` : "--";
}

function formatPressure(value) {
  return hasNumericValue(value) ? `${Number(value).toFixed(2)} inHg` : "--";
}

function formatRain(value) {
  return hasNumericValue(value) ? `${Number(value).toFixed(2)} in` : "--";
}

function formatSolar(value) {
  return hasNumericValue(value) ? `${round(value)} W/m²` : "--";
}

function formatBattery(value) {
  if (value === undefined || value === null || value === "") return "--";
  return Number(value) === 1 ? "OK" : "Low";
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "--";
  return Number.isFinite(Number(value)) ? compactNumber(value) : String(value);
}

function compassText(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return "--";
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW"
  ];
  return directions[Math.round(value / 22.5) % 16];
}

function formatTime(value) {
  return historyTime.formatTimestamp(value, state.config?.stationTimezone);
}

function formatRelativeAge(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "Update time unavailable";
  return formatAgeMinutes(Math.max(0, (Date.now() - timestamp) / 60000));
}

function formatAgeMinutes(value) {
  const minutes = Math.max(0, Number(value));
  if (!Number.isFinite(minutes)) return "Update time unavailable";
  if (minutes < 1.5) return "Updated just now";
  if (minutes < 60) return `Updated ${Math.round(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function formatUnitValue(value, unit, digits = null) {
  if (!hasNumericValue(value)) return "--";
  const numeric = Number(value);
  const rendered = digits === null ? compactNumber(numeric) : numeric.toFixed(digits);
  return ["%", "°F"].includes(unit) ? `${rendered}${unit}` : `${rendered} ${unit}`;
}

function formatMetricValue(metric, value) {
  const digits = metric.unit === "in" ? 2 : null;
  return formatUnitValue(value, metric.unit, digits);
}

function historyDateRange(value) {
  const timezone = state.config?.stationTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return historyTime.historyDateRange(value, timezone);
}

function rollingDateRange(days) {
  return historyTime.rollingDateRange(days);
}

function rangeLabel(days) {
  return historyTime.rangeLabel(days);
}

function previousDateRange(range) {
  return historyTime.previousDateRange(range);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).then((registration) => {
      registration.update().catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) els.updateBanner.hidden = false;
      }, { once: true });
    }).catch(() => {});
  }
}

function toDateInputValue(date, timezone) {
  return historyTime.toDateInputValue(date, timezone);
}

function formatTimestampDate(value) {
  return historyTime.formatTimestampDate(value, state.config?.stationTimezone);
}

function formatSelectedDate(value) {
  return historyTime.formatSelectedDate(value);
}

function formatDateOnly(value) {
  return historyTime.formatDateOnly(value);
}

function round(value) {
  const number = Number(value);
  return Math.abs(number) >= 100 ? Math.round(number) : Number(number.toFixed(1));
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 100) return String(Math.round(number));
  return String(Number(number.toFixed(1)));
}

function hasNumericValue(value) {
  return value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
}
