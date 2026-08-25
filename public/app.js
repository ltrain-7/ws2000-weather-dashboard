const state = {
  config: null,
  devices: [],
  latestByMac: new Map(),
  selectedMac: localStorage.getItem("selectedMac") || "",
  chartMetric: localStorage.getItem("chartMetric") || "tempf",
  historyDate: "",
  historyRangeDays: 0,
  history: []
};

const els = {
  stationSelect: document.getElementById("stationSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusPill: document.getElementById("statusPill"),
  stationMeta: document.getElementById("stationMeta"),
  updatedAt: document.getElementById("updatedAt"),
  setupBanner: document.getElementById("setupBanner"),
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
  compassNeedle: document.getElementById("compassNeedle"),
  chartTitle: document.getElementById("chartTitle"),
  historyDate: document.getElementById("historyDate"),
  historyChart: document.getElementById("historyChart"),
  rawTable: document.getElementById("rawTable")
};

const metricConfig = {
  tempf: { label: "Temperature", unit: "F", color: "#d45d4c" },
  humidity: { label: "Humidity", unit: "%", color: "#0f8b8d" },
  windspeedmph: { label: "Wind speed", unit: "mph", color: "#2f6f9f" },
  dailyrainin: { label: "Daily rain", unit: "in", color: "#c9901e" }
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  setMetricButtons();
  els.historyDate.max = toDateInputValue(new Date());

  try {
    state.config = await fetchJson("/api/config");
    els.setupBanner.hidden = Boolean(state.config.configured);
    const latest = await fetchJson("/api/latest");
    applyState(latest);
    connectEventStream();
    await loadHistory();
  } catch (error) {
    setStatus("error", "Offline");
    els.stationMeta.textContent = error.message;
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
      await loadHistory();
    } catch (error) {
      els.stationMeta.textContent = error.message;
    } finally {
      els.refreshBtn.disabled = false;
    }
  });

  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartMetric = button.dataset.metric;
      localStorage.setItem("chartMetric", state.chartMetric);
      setMetricButtons();
      drawChart();
    });
  });

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

  window.addEventListener("resize", drawChart);
}

function connectEventStream() {
  const source = new EventSource("/api/events");
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
    setStatus("error", "Reconnecting");
  });
}

function applyState(payload) {
  if (!payload) return;

  state.devices = Array.isArray(payload.devices) ? payload.devices : [];
  state.latestByMac.clear();
  for (const item of payload.latest || []) {
    if (item && item.macAddress) {
      state.latestByMac.set(item.macAddress, item);
    }
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
}

async function loadHistory() {
  if (!state.selectedMac) {
    state.history = [];
    drawChart();
    return;
  }

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
  } catch {
    state.history = liveOnlyHistory();
  }
  drawChart();
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
    if (device) {
      els.stationMeta.textContent = stationSubtitle(device);
    }
    return;
  }

  els.stationMeta.textContent = device ? stationSubtitle(device) : shortMac(data.macAddress);
  els.updatedAt.textContent = data.dateutc ? `Updated ${formatTime(data.dateutc)}` : "--";
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
  els.windDirectionValue.textContent = compassText(data.winddir);
  els.compassNeedle.style.transform = `rotate(${Number(data.winddir || 0)}deg)`;
  renderRawTable(data);
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
  els.compassNeedle.style.transform = "rotate(0deg)";
  els.rawTable.innerHTML = `<tr><td colspan="2">Waiting for data</td></tr>`;
  els.updatedAt.textContent = "--";
}

function renderRawTable(data) {
  const visibleKeys = Object.keys(data)
    .filter((key) => !["macAddress", "source"].includes(key))
    .sort((a, b) => a.localeCompare(b));

  els.rawTable.innerHTML = "";
  for (const key of visibleKeys) {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    const value = document.createElement("td");
    label.textContent = key;
    value.textContent = formatRawValue(key, data[key]);
    row.append(label, value);
    els.rawTable.append(row);
  }
}

function drawChart() {
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

  const metric = metricConfig[state.chartMetric] || metricConfig.tempf;
  const rangeTitle = state.historyDate
    ? `${metric.label} · ${formatSelectedDate(state.historyDate)}`
    : state.historyRangeDays
      ? `${metric.label} · Last ${state.historyRangeDays} days`
    : `${metric.label} history`;
  els.chartTitle.textContent = `${rangeTitle}${trendMethodLabel()}`;

  const rawPoints = normalizeHistory(state.history)
    .map((item) => ({
      at: item.dateutc || Date.parse(item.date || ""),
      value: Number(item[state.chartMetric])
    }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value));
  const points = trendPoints(rawPoints);

  const pad = { left: 48, right: 18, top: 20, bottom: 34 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  drawChartFrame(ctx, width, height, pad);

  if (points.length < 2) {
    ctx.fillStyle = "#667579";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(
      state.historyDate || state.historyRangeDays
        ? "No readings stored for this period"
        : "Waiting for enough readings",
      pad.left,
      height / 2
    );
    return;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const yMin = min - span * 0.12;
  const yMax = max + span * 0.12;
  const xMin = points[0].at;
  const xMax = points[points.length - 1].at;
  const xSpan = xMax - xMin || 1;

  drawYAxis(ctx, pad, chartWidth, chartHeight, yMin, yMax, metric.unit);

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad.left + ((point.at - xMin) / xSpan) * chartWidth;
    const y = pad.top + (1 - (point.value - yMin) / (yMax - yMin)) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = metric.color;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const last = points[points.length - 1];
  const lastX = pad.left + ((last.at - xMin) / xSpan) * chartWidth;
  const lastY = pad.top + (1 - (last.value - yMin) / (yMax - yMin)) * chartHeight;
  ctx.fillStyle = metric.color;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#667579";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(formatTime(points[0].at), pad.left, height - 10);
  const endLabel = formatTime(points[points.length - 1].at);
  ctx.fillText(endLabel, width - pad.right - ctx.measureText(endLabel).width, height - 10);
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
    const label = `${compactNumber(value)} ${unit}`;
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
    button.classList.toggle("active", button.dataset.metric === state.chartMetric);
  });
}

function setRangeButtons() {
  document.querySelectorAll("[data-range-days]").forEach((button) => {
    const days = Number(button.dataset.rangeDays) || 0;
    button.classList.toggle(
      "active",
      !state.historyDate && days === state.historyRangeDays
    );
  });
}

function trendPoints(points) {
  if (state.historyRangeDays < 30 || points.length < 2) return points;
  if (state.chartMetric === "dailyrainin") return dailyRainTotals(points);

  const smoothingHours = state.historyRangeDays >= 180
    ? 48
    : state.historyRangeDays >= 90
      ? 24
      : 6;
  return rollingAverage(points, smoothingHours * 60 * 60 * 1000);
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
  return device.info?.name || shortMac(device.macAddress);
}

function stationSubtitle(device) {
  const pieces = [stationName(device)];
  if (device.info?.location) pieces.push(device.info.location);
  pieces.push(shortMac(device.macAddress));
  return pieces.filter(Boolean).join(" | ");
}

function shortMac(macAddress) {
  if (!macAddress) return "";
  const parts = macAddress.split(":");
  return parts.length > 2 ? `...${parts.slice(-3).join(":")}` : macAddress;
}

function formatTemp(value) {
  return Number.isFinite(Number(value)) ? `${round(value)} F` : "--";
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${round(value)}%` : "--";
}

function formatWind(value) {
  return Number.isFinite(Number(value)) ? `${round(value)} mph` : "--";
}

function formatPressure(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} inHg` : "--";
}

function formatRain(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} in` : "--";
}

function formatSolar(value) {
  return Number.isFinite(Number(value)) ? `${round(value)} W/m2` : "--";
}

function formatBattery(value) {
  if (value === undefined || value === null || value === "") return "--";
  return Number(value) === 1 ? "OK" : "Low";
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "--";
  return Number.isFinite(Number(value)) ? compactNumber(value) : String(value);
}

function formatRawValue(key, value) {
  if (key === "dateutc") return `${value} (${formatTime(value)})`;
  if (key === "date") return formatTime(Date.parse(value));
  if (key.includes("temp") || key.includes("feelsLike") || key.includes("dewPoint")) {
    return formatTemp(value);
  }
  if (key.includes("humidity") || key.includes("hum")) return formatPercent(value);
  if (key.includes("rain")) return formatRain(value);
  if (key.includes("wind") && key.includes("mph")) return formatWind(value);
  if (key.includes("barom")) return formatPressure(value);
  return formatValue(value);
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
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function historyDateRange(value) {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00`);
  const end = new Date(`${value}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

function rollingDateRange(days) {
  if (!days) return null;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSelectedDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
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
