const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { AdminAuth } = require("./auth");
const { createDeploymentStatus } = require("./deployment-status");
const { createForecastService } = require("./forecast");
const { createHttpResponder } = require("./http-response");
const { createWeatherStore } = require("./storage");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PACKAGE = require(path.join(ROOT_DIR, "package.json"));
const STARTED_AT = new Date().toISOString();

loadDotEnv(path.join(ROOT_DIR, ".env"));

const STATION_TIMEZONE = timezoneFromEnv();
process.env.TZ = STATION_TIMEZONE;
const PORT = numberFromEnv("PORT", 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TLS_ENABLED = booleanFromEnv("TLS_ENABLED", false);
const TLS_CERT_PATH = clean(process.env.TLS_CERT_PATH) || "/app/certs/fullchain.pem";
const TLS_KEY_PATH = clean(process.env.TLS_KEY_PATH) || "/app/certs/privkey.pem";
const ADMIN_AUTH_ENABLED = booleanFromEnv("ADMIN_AUTH_ENABLED", false);
const ADMIN_TRUST_PROXY = booleanFromEnv("ADMIN_TRUST_PROXY", false);
const ADMIN_USERNAME = clean(process.env.ADMIN_USERNAME) || "admin";
const ADMIN_SESSION_TTL_MINUTES = clamp(
  numberFromEnv("ADMIN_SESSION_TTL_MINUTES", 480),
  5,
  1440
);
const ADMIN_PASSWORD_HASH = loadAdminPasswordHash();
const APPLICATION_KEY = clean(process.env.AMBIENT_APPLICATION_KEY);
const API_KEYS = parseApiKeys();
const DEFAULT_DEVICE_MAC = clean(process.env.AMBIENT_DEVICE_MAC);
const REST_ORIGIN = process.env.AMBIENT_REST_ORIGIN || "https://rt.ambientweather.net";
const REALTIME_ORIGIN =
  process.env.AMBIENT_REALTIME_ORIGIN || "https://rt2.ambientweather.net";
const POLL_INTERVAL_MS = clamp(
  numberFromEnv("AMBIENT_POLL_INTERVAL_MS", 60000),
  30000,
  60 * 60 * 1000
);
const HISTORY_LIMIT = clamp(numberFromEnv("AMBIENT_HISTORY_LIMIT", 96), 1, 288);
const HISTORY_MAX_POINTS = clamp(numberFromEnv("HISTORY_MAX_POINTS", 480), 120, 2000);
const LIVE_HISTORY_LIMIT = clamp(numberFromEnv("LIVE_HISTORY_LIMIT", 192), 24, 288);
const HISTORY_RETENTION_DAYS = clamp(numberFromEnv("HISTORY_RETENTION_DAYS", 365), 0, 3650);
const SQLITE_DB_PATH =
  clean(process.env.SQLITE_DB_PATH) || path.join(ROOT_DIR, "data", "weather.db");
const BACKUP_DIR = clean(process.env.BACKUP_DIR) || path.join(ROOT_DIR, "backups");
const BACKUP_INTERVAL_HOURS = clamp(numberFromEnv("BACKUP_INTERVAL_HOURS", 24), 0, 24 * 30);
const BACKUP_RETENTION_DAYS = clamp(numberFromEnv("BACKUP_RETENTION_DAYS", 90), 0, 3650);
const BACKUP_MAX_FILES = clamp(numberFromEnv("BACKUP_MAX_FILES", 12), 0, 1000);
const STATION_STALE_MINUTES = clamp(numberFromEnv("STATION_STALE_MINUTES", 15), 2, 1440);
const FORECAST_ENABLED = booleanFromEnv("FORECAST_ENABLED", true);
const FORECAST_DAYS = clamp(numberFromEnv("FORECAST_DAYS", 5), 3, 7);
const FORECAST_REFRESH_MINUTES = clamp(numberFromEnv("FORECAST_REFRESH_MINUTES", 60), 15, 360);
const ADMIN_COOKIE_NAME = "__Host-weather_session";
const PROTECTED_ADMIN_ASSETS = new Set(["/admin.html", "/admin.js"]);
const { redirect, securityHeaders, sendJson, sendText, serveStatic } = createHttpResponder({
  publicDir: PUBLIC_DIR,
  strictTransport: TLS_ENABLED || ADMIN_TRUST_PROXY
});

if (ADMIN_AUTH_ENABLED && !ADMIN_PASSWORD_HASH) {
  throw new Error(
    "ADMIN_AUTH_ENABLED is true but ADMIN_PASSWORD_HASH or ADMIN_PASSWORD_HASH_FILE is not configured."
  );
}

const adminAuth = new AdminAuth({
  enabled: ADMIN_AUTH_ENABLED,
  username: ADMIN_USERNAME,
  passwordHash: ADMIN_PASSWORD_HASH,
  sessionTtlMs: ADMIN_SESSION_TTL_MINUTES * 60 * 1000
});

const configured = Boolean(APPLICATION_KEY && API_KEYS.length);
const clients = new Set();
const devicesByMac = new Map();
const latestByMac = new Map();
const apiKeyByMac = new Map();
const liveHistoryByMac = new Map();
const storage = createWeatherStore({
  dbPath: SQLITE_DB_PATH,
  retentionDays: HISTORY_RETENTION_DAYS
});
const deploymentStatus = createDeploymentStatus({
  backupDir: BACKUP_DIR,
  metadataPath: clean(process.env.DEPLOYMENT_STATUS_PATH)
    || path.join(path.dirname(SQLITE_DB_PATH), "deployment.json"),
  packageInfo: PACKAGE,
  startedAt: STARTED_AT
});
const forecastService = createForecastService({
  enabled: FORECAST_ENABLED,
  latitude: clean(process.env.FORECAST_LATITUDE),
  longitude: clean(process.env.FORECAST_LONGITUDE),
  locationName: clean(process.env.FORECAST_LOCATION_NAME),
  timezone: STATION_TIMEZONE,
  days: FORECAST_DAYS,
  cacheTtlMs: FORECAST_REFRESH_MINUTES * 60 * 1000,
  origin: clean(process.env.FORECAST_ORIGIN) || undefined
});

const state = {
  configured,
  targetMac: DEFAULT_DEVICE_MAC,
  rest: {
    status: configured ? "idle" : "missing-config",
    lastSync: null,
    message: configured ? "" : "Ambient API keys are not configured."
  },
  realtime: {
    status: configured ? "idle" : "missing-config",
    lastEvent: null,
    message: configured ? "" : "Ambient API keys are not configured.",
    invalidApiKeyCount: 0
  },
  storage: storage.getStatus(),
  errors: [],
  backup: {
    running: false,
    lastResult: null,
    lastError: null
  },
  backfill: {
    running: false,
    requestedDays: null,
    pages: 0,
    oldestReadingAt: null,
    lastError: null,
    completedAt: null
  }
};

const requestHandler = async (req, res) => {
  try {
    const protocol = TLS_ENABLED ? "https" : "http";
    const requestUrl = new URL(req.url, `${protocol}://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/admin") {
      redirect(res, "/admin.html");
      return;
    }

    if (requestUrl.pathname === "/login.html" && !ADMIN_AUTH_ENABLED) {
      redirect(res, "/admin.html");
      return;
    }

    if (PROTECTED_ADMIN_ASSETS.has(requestUrl.pathname) && ADMIN_AUTH_ENABLED) {
      const session = adminSession(req);
      if (!session) {
        if (requestUrl.pathname === "/admin.html") {
          redirect(res, "/login.html?next=%2Fadmin.html");
        } else {
          sendText(res, 401, "Authentication required.", { "cache-control": "no-store" });
        }
        return;
      }
    }

    await serveStatic(requestUrl, res);
  } catch (error) {
    const statusCode = Number(error.statusCode);
    if (statusCode >= 400 && statusCode < 500) {
      sendJson(res, statusCode, { error: error.message }, { "cache-control": "no-store" });
    } else {
      recordError(error);
      sendJson(res, 500, { error: "Unexpected server error." });
    }
  }
};

const server = TLS_ENABLED
  ? https.createServer(loadTlsOptions(), requestHandler)
  : http.createServer(requestHandler);

hydrateFromStorage();

server.listen(PORT, HOST, () => {
  const protocol = TLS_ENABLED ? "https" : "http";
  console.log(`WS-2000 dashboard listening on ${protocol}://${HOST}:${PORT}`);
  console.log(storage.getStatus().message);
  if (!configured) {
    console.log("Ambient keys are not configured. Set AMBIENT_APPLICATION_KEY and AMBIENT_API_KEY.");
  }
});

if (configured) {
  refreshDevices("startup").catch(recordError);
  startRealtime();
  setInterval(() => {
    refreshDevices("poll").catch(recordError);
  }, POLL_INTERVAL_MS);
}

if (storage.enabled && HISTORY_RETENTION_DAYS > 0) {
  try {
    storage.prune();
  } catch (error) {
    recordError(error);
  }
  setInterval(() => {
    try {
      storage.prune();
    } catch (error) {
      recordError(error);
    }
  }, 60 * 60 * 1000);
}

if (storage.enabled && BACKUP_INTERVAL_HOURS > 0) {
  setTimeout(() => runBackup("scheduled").catch(recordError), 60 * 1000).unref();
  setInterval(
    () => runBackup("scheduled").catch(recordError),
    BACKUP_INTERVAL_HOURS * 60 * 60 * 1000
  ).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function handleApi(req, res, requestUrl) {
  if (requestUrl.pathname.startsWith("/api/auth/")) {
    await handleAuthApi(req, res, requestUrl);
    return;
  }

  let authenticatedAdmin = null;
  if (requestUrl.pathname === "/api/admin" || requestUrl.pathname.startsWith("/api/admin/")) {
    authenticatedAdmin = requireAdminSession(req, res);
    if (!authenticatedAdmin) return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      configured,
      deviceCount: devicesByMac.size,
      realtime: state.realtime.status,
      rest: state.rest.status,
      storage: storage.getStatus(),
      forecast: forecastService.status()
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(res, 200, {
      configured,
      hasApplicationKey: Boolean(APPLICATION_KEY),
      apiKeyCount: API_KEYS.length,
      defaultDeviceMac: DEFAULT_DEVICE_MAC || null,
      pollIntervalMs: POLL_INTERVAL_MS,
      historyLimit: HISTORY_LIMIT,
      historyMaxPoints: HISTORY_MAX_POINTS,
      liveHistoryLimit: LIVE_HISTORY_LIMIT,
      historyRetentionDays: HISTORY_RETENTION_DAYS,
      stationTimezone: STATION_TIMEZONE,
      tlsEnabled: TLS_ENABLED,
      adminAuthEnabled: ADMIN_AUTH_ENABLED,
      forecastEnabled: FORECAST_ENABLED,
      forecastDays: FORECAST_DAYS,
      stationStaleMinutes: STATION_STALE_MINUTES,
      storage: storage.getStatus()
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/storage") {
    sendJson(res, 200, storage.getStats());
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/forecast") {
    try {
      sendJson(res, 200, await forecastService.getForecast());
    } catch (error) {
      recordError(error);
      sendJson(res, 502, {
        ...forecastService.status(),
        available: false,
        error: "Local forecast is temporarily unavailable."
      });
    }
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/analytics") {
    sendJson(res, 200, analyticsResponse(requestUrl));
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/admin") {
    sendJson(res, 200, adminStatus(), { "cache-control": "no-store" });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/backup") {
    if (!authorizeAdminMutation(req, res, authenticatedAdmin)) return;
    sendJson(res, 202, await runBackup("manual"));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/integrity") {
    if (!authorizeAdminMutation(req, res, authenticatedAdmin)) return;
    sendJson(res, 200, storage.integrityCheck());
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/backfill") {
    if (!authorizeAdminMutation(req, res, authenticatedAdmin)) return;
    const days = clamp(Number(requestUrl.searchParams.get("days") || 90), 1, 365);
    const macAddress = clean(requestUrl.searchParams.get("mac")) || firstKnownMac();
    if (!configured || !macAddress) {
      sendJson(res, 400, { error: "A configured weather station is required." });
      return;
    }
    if (state.backfill.running) {
      sendJson(res, 409, { error: "A backfill is already running.", backfill: state.backfill });
      return;
    }
    runBackfill(macAddress, days).catch(recordError);
    sendJson(res, 202, { accepted: true, macAddress, days });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/events") {
    openEventStream(req, res);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/latest") {
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/devices") {
    if (requestUrl.searchParams.get("refresh") === "1") {
      await refreshDevices("manual");
    }
    sendJson(res, 200, { devices: publicDevices() });
    return;
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    requestUrl.pathname === "/api/refresh"
  ) {
    await refreshDevices("manual");
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/history") {
    await handleHistory(res, requestUrl);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

async function handleHistory(res, requestUrl) {
  const macAddress =
    clean(requestUrl.searchParams.get("mac")) || DEFAULT_DEVICE_MAC || firstKnownMac();
  if (!macAddress) {
    sendJson(res, 400, { error: "No weather station is available yet." });
    return;
  }

  const limit = clamp(Number(requestUrl.searchParams.get("limit") || HISTORY_LIMIT), 1, 10000);
  const endDate = clean(requestUrl.searchParams.get("endDate"));
  const startDate = clean(requestUrl.searchParams.get("startDate"));
  const maxPoints = clamp(Number(requestUrl.searchParams.get("maxPoints") || 0), 0, 2000);
  const source = clean(requestUrl.searchParams.get("source"));
  const apiKey = apiKeyByMac.get(macAddress) || API_KEYS[0];
  const localHistory = readLocalHistory(macAddress, {
    limit,
    startDate,
    endDate,
    maxPoints
  });

  if (source !== "ambient" && (localHistory.length >= limit || !configured || source === "local")) {
    sendJson(res, 200, {
      macAddress,
      source: storage.enabled ? "sqlite" : "memory",
      count: localHistory.length,
      data: localHistory
    });
    return;
  }

  try {
    const ambientLimit = clamp(limit, 1, 288);
    const history = await fetchDeviceHistory(macAddress, apiKey, { limit: ambientLimit, endDate });
    for (const item of history) {
      const sanitized = sanitizeData({ ...item, macAddress }, macAddress);
      persistReading(sanitized, "ambient-history");
    }
    let mergedHistory = storage.enabled
      ? readLocalHistory(macAddress, { limit, startDate, endDate, maxPoints })
      : [];
    let responseSource = storage.enabled ? "sqlite+ambient-backfill" : "rest";
    if (!mergedHistory.length) {
      mergedHistory = history.map((item) => sanitizeData(item, macAddress));
      responseSource = "rest";
    }

    sendJson(res, 200, {
      macAddress,
      source: responseSource,
      count: mergedHistory.length,
      data: mergedHistory
    });
  } catch (error) {
    recordError(error);
    sendJson(res, localHistory.length ? 200 : 502, {
      error: "Unable to fetch Ambient device history.",
      detail: error.message,
      source: storage.enabled ? "sqlite-fallback" : "memory-fallback",
      count: localHistory.length,
      data: localHistory,
      fallback: liveHistoryFor(macAddress)
    });
  }
}

async function refreshDevices(reason) {
  if (!configured) return [];

  state.rest.status = "syncing";
  state.rest.message = reason === "manual" ? "Refreshing from Ambient REST API." : "";
  broadcast("state", publicState());

  const allDevices = [];

  for (let index = 0; index < API_KEYS.length; index += 1) {
    if (index > 0) {
      await sleep(1100);
    }

    const apiKey = API_KEYS[index];
    const devices = await fetchUserDevices(apiKey);
    for (const device of devices) {
      apiKeyByMac.set(device.macAddress, apiKey);
      upsertDevice(device);
      if (device.lastData) {
        upsertData(
          {
            ...device.lastData,
            macAddress: device.macAddress,
            device
          },
          "rest",
          false
        );
      }
    }
    allDevices.push(...devices);
  }

  state.rest.status = "ok";
  state.rest.lastSync = new Date().toISOString();
  state.rest.message = `Loaded ${allDevices.length} device${allDevices.length === 1 ? "" : "s"}.`;
  broadcast("state", publicState());
  return allDevices;
}

function startRealtime() {
  let io;
  try {
    io = require("socket.io-client");
  } catch {
    state.realtime.status = "dependency-missing";
    state.realtime.message =
      "Install socket.io-client with npm install, or run the Docker image.";
    broadcast("state", publicState());
    return;
  }

  const socket = io(REALTIME_ORIGIN, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
    query: {
      api: "1",
      applicationKey: APPLICATION_KEY
    }
  });

  socket.on("connect", () => {
    state.realtime.status = "connected";
    state.realtime.message = "Connected to Ambient realtime API.";
    socket.emit("subscribe", { apiKeys: API_KEYS });
    broadcast("state", publicState());
  });

  socket.on("subscribed", (payload = {}) => {
    state.realtime.status = "subscribed";
    state.realtime.lastEvent = new Date().toISOString();
    state.realtime.invalidApiKeyCount = Array.isArray(payload.invalidApiKeys)
      ? payload.invalidApiKeys.length
      : 0;
    state.realtime.message =
      state.realtime.invalidApiKeyCount > 0
        ? `${state.realtime.invalidApiKeyCount} Ambient API key failed validation.`
        : "Subscribed to Ambient station updates.";

    for (const device of payload.devices || []) {
      if (device.apiKey) {
        apiKeyByMac.set(device.macAddress, device.apiKey);
      }
      upsertDevice(device);
      if (device.lastData) {
        upsertData(
          {
            ...device.lastData,
            macAddress: device.macAddress,
            device
          },
          "realtime-subscription",
          false
        );
      }
    }
    broadcast("state", publicState());
  });

  socket.on("data", (data) => {
    state.realtime.status = "live";
    state.realtime.lastEvent = new Date().toISOString();
    state.realtime.message = "Receiving station data.";
    upsertData(data, "realtime", true);
  });

  socket.on("disconnect", (reason) => {
    state.realtime.status = "disconnected";
    state.realtime.message = `Realtime connection closed: ${reason}`;
    broadcast("state", publicState());
  });

  socket.on("connect_error", (error) => {
    state.realtime.status = "error";
    state.realtime.message = error.message;
    recordError(error);
    broadcast("state", publicState());
  });
}

async function fetchUserDevices(apiKey) {
  const url = new URL("/v1/devices", REST_ORIGIN);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("applicationKey", APPLICATION_KEY);
  return fetchJson(url);
}

async function fetchDeviceHistory(macAddress, apiKey, options) {
  const url = new URL(`/v1/devices/${encodeURIComponent(macAddress)}`, REST_ORIGIN);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("applicationKey", APPLICATION_KEY);
  url.searchParams.set("limit", String(options.limit));
  if (options.endDate) {
    url.searchParams.set("endDate", options.endDate);
  }
  return fetchJson(url);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ws2000-synology-dashboard/1.0"
      },
      signal: controller.signal
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `Ambient API returned ${response.status}: ${body.slice(0, 180) || response.statusText}`
      );
    }

    return body ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}

function upsertDevice(device) {
  if (!device || !device.macAddress) return;

  forecastService.useDevice(device);

  const existing = devicesByMac.get(device.macAddress) || {};
  const merged = {
    ...existing,
    ...sanitizeDevice(device),
    lastSeen: new Date().toISOString()
  };
  devicesByMac.set(device.macAddress, merged);
  persistDevice(merged);
}

function upsertData(data, source, shouldBroadcast) {
  if (!data) return;

  const macAddress = data.macAddress || data.device?.macAddress;
  if (!macAddress) return;

  if (data.device) {
    upsertDevice(data.device);
  }

  const sanitized = sanitizeData(data, macAddress);
  sanitized.source = source;
  latestByMac.set(macAddress, sanitized);
  pushLiveHistory(macAddress, sanitized);
  persistReading(sanitized, source);

  const device = devicesByMac.get(macAddress);
  if (device) {
    device.lastData = sanitized;
    device.lastSeen = new Date().toISOString();
  }

  if (shouldBroadcast) {
    broadcast("update", {
      device: device || null,
      data: sanitized,
      state: publicState()
    });
  }
}

function sanitizeDevice(device) {
  if (!device) return null;
  const info = device.info || {};
  return {
    macAddress: device.macAddress,
    info: {
      name: info.name || "Weather Station",
      location: info.location || "",
      elevation: valueOrNull(info.elevation)
    },
    lastData: sanitizeData(device.lastData, device.macAddress)
  };
}

function sanitizeData(data, macAddress) {
  if (!data) return null;
  const output = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "apiKey") continue;
    if (key === "device") continue;
    output[key] = value;
  }
  output.macAddress = macAddress || data.macAddress || data.device?.macAddress || null;
  return output;
}

function pushLiveHistory(macAddress, data) {
  const points = liveHistoryByMac.get(macAddress) || [];
  if (points.length && points[points.length - 1].dateutc === data.dateutc) {
    points[points.length - 1] = data;
  } else {
    points.push(data);
  }

  while (points.length > LIVE_HISTORY_LIMIT) {
    points.shift();
  }
  liveHistoryByMac.set(macAddress, points);
}

function liveHistoryFor(macAddress) {
  const selectedMac = clean(macAddress) || DEFAULT_DEVICE_MAC || firstKnownMac();
  return {
    macAddress: selectedMac || null,
    source: "memory",
    data: selectedMac ? liveHistoryByMac.get(selectedMac) || [] : []
  };
}

function publicState() {
  return {
    configured,
    generatedAt: new Date().toISOString(),
    targetMac: DEFAULT_DEVICE_MAC || null,
    rest: state.rest,
    realtime: state.realtime,
    storage: storage.getStatus(),
    devices: publicDevices(),
    latest: Array.from(latestByMac.values()).filter(Boolean),
    stationHealth: stationHealth(),
    errors: state.errors.slice(-5)
  };
}

function stationHealth() {
  const now = Date.now();
  return Array.from(latestByMac.values()).filter(Boolean).map((reading) => {
    const observedAt = Number(reading.dateutc) || Date.parse(reading.date || "");
    const ageMinutes = Number.isFinite(observedAt) ? Math.max(0, (now - observedAt) / 60000) : null;
    const batteryValue = reading.battout;
    const batteryLow = batteryValue !== undefined && batteryValue !== null && batteryValue !== "" && Number(batteryValue) !== 1;
    let status = "online";
    if (ageMinutes === null || ageMinutes > STATION_STALE_MINUTES * 4) status = "offline";
    else if (ageMinutes > STATION_STALE_MINUTES || batteryLow) status = "warning";
    return {
      macAddress: reading.macAddress,
      status,
      observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null,
      ageMinutes: ageMinutes === null ? null : Number(ageMinutes.toFixed(1)),
      staleAfterMinutes: STATION_STALE_MINUTES,
      batteryLow,
      batteryValue: valueOrNull(batteryValue),
      source: reading.source || null
    };
  });
}

function analyticsResponse(requestUrl) {
  const macAddress = clean(requestUrl.searchParams.get("mac")) || DEFAULT_DEVICE_MAC || firstKnownMac();
  if (!macAddress) return { macAddress: null, current: null, previous: null, rainfall: {} };
  const days = clamp(Number(requestUrl.searchParams.get("days") || 30), 1, 3650);
  const end = Date.now();
  const start = end - days * 86400000;
  const previousStart = start - days * 86400000;
  const currentDate = new Date(end);
  const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
  const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getTime();
  const startOfYear = new Date(currentDate.getFullYear(), 0, 1).getTime();
  const rainfall = {
    day: storage.getAnalytics(macAddress, startOfDay, end),
    week: storage.getAnalytics(macAddress, end - 7 * 86400000, end),
    month: storage.getAnalytics(macAddress, startOfMonth, end),
    year: storage.getAnalytics(macAddress, startOfYear, end)
  };
  return {
    macAddress,
    days,
    timezone: STATION_TIMEZONE,
    generatedAt: new Date(end).toISOString(),
    coverage: storage.getReadingStats(macAddress),
    current: storage.getAnalytics(macAddress, start, end),
    previous: storage.getAnalytics(macAddress, previousStart, start),
    rainfall
  };
}

function adminStatus() {
  const deployment = deploymentStatus.status();
  return {
    application: {
      name: PACKAGE.name,
      version: PACKAGE.version,
      revision: deployment.revision,
      nodeVersion: process.version,
      stationTimezone: STATION_TIMEZONE,
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
      tlsEnabled: TLS_ENABLED,
      adminAuthEnabled: ADMIN_AUTH_ENABLED
    },
    deployment,
    forecast: forecastService.status(),
    configured,
    connections: { rest: state.rest, realtime: state.realtime },
    stationHealth: stationHealth(),
    storage: { ...storage.getStats(), integrity: storage.integrityCheck() },
    backups: {
      enabled: BACKUP_INTERVAL_HOURS > 0,
      intervalHours: BACKUP_INTERVAL_HOURS,
      retentionDays: BACKUP_RETENTION_DAYS,
      maxFiles: BACKUP_MAX_FILES,
      files: deploymentStatus.listBackups(),
      state: state.backup
    },
    backfill: state.backfill,
    recentErrors: state.errors.slice(-10)
  };
}

async function handleAuthApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/auth/status") {
    const session = adminSession(req);
    sendJson(
      res,
      200,
      {
        enabled: ADMIN_AUTH_ENABLED,
        authenticated: !ADMIN_AUTH_ENABLED || Boolean(session),
        username: session?.username || null,
        csrfToken: session?.csrfToken || null,
        secure: isRequestSecure(req),
        requiresHttps: ADMIN_AUTH_ENABLED && !isRequestSecure(req)
      },
      { "cache-control": "no-store" }
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    if (!ADMIN_AUTH_ENABLED) {
      sendJson(res, 404, { error: "Administrator authentication is not enabled." }, { "cache-control": "no-store" });
      return;
    }
    if (!isRequestSecure(req)) {
      sendJson(
        res,
        400,
        { error: "Administrator login requires HTTPS." },
        { "cache-control": "no-store" }
      );
      return;
    }
    if (!isSameOriginAdminRequest(req)) {
      sendJson(res, 403, { error: "Cross-origin login requests are not allowed." }, { "cache-control": "no-store" });
      return;
    }

    const body = await readJsonBody(req, 8192);
    const username = clean(body.username).slice(0, 128);
    const password = typeof body.password === "string" ? body.password.slice(0, 1024) : "";
    const clientKey = `${clientAddress(req)}|${username.toLowerCase() || "unknown"}`;
    const result = await adminAuth.authenticate(username, password, clientKey);
    if (!result.ok) {
      if (result.delayMs) await sleep(result.delayMs);
      const rateLimited = result.reason === "rate-limited" || result.allowed === false;
      sendJson(
        res,
        rateLimited ? 429 : 401,
        { error: rateLimited ? "Too many login attempts. Try again later." : "Invalid username or password." },
        {
          "cache-control": "no-store",
          ...(rateLimited ? { "retry-after": String(result.retryAfterSeconds || 60) } : {})
        }
      );
      return;
    }

    sendJson(
      res,
      200,
      {
        authenticated: true,
        username: result.session.username,
        csrfToken: result.session.csrfToken,
        expiresAt: new Date(result.session.expiresAt).toISOString()
      },
      {
        "cache-control": "no-store",
        "set-cookie": sessionCookie(result.token)
      }
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    const session = requireAdminSession(req, res);
    if (!session) return;
    if (!authorizeAdminMutation(req, res, session)) return;
    adminAuth.destroySession(cookieValue(req, ADMIN_COOKIE_NAME));
    sendJson(
      res,
      200,
      { authenticated: false },
      { "cache-control": "no-store", "set-cookie": clearSessionCookie() }
    );
    return;
  }

  sendJson(res, 404, { error: "Not found." }, { "cache-control": "no-store" });
}

function requireAdminSession(req, res) {
  if (!ADMIN_AUTH_ENABLED) return { authDisabled: true, username: null, csrfToken: null };
  const session = adminSession(req);
  if (session) return session;
  sendJson(res, 401, { error: "Administrator authentication is required." }, { "cache-control": "no-store" });
  return null;
}

function authorizeAdminMutation(req, res, session) {
  if (!isSameOriginAdminRequest(req)) {
    sendJson(res, 403, { error: "Cross-origin administration requests are not allowed." }, { "cache-control": "no-store" });
    return false;
  }
  if (
    ADMIN_AUTH_ENABLED &&
    (!session?.csrfToken || clean(req.headers["x-csrf-token"]) !== session.csrfToken)
  ) {
    sendJson(res, 403, { error: "A valid CSRF token is required." }, { "cache-control": "no-store" });
    return false;
  }
  return true;
}

function adminSession(req) {
  return adminAuth.getSession(cookieValue(req, ADMIN_COOKIE_NAME));
}

function cookieValue(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function sessionCookie(token) {
  const maxAge = Math.round(ADMIN_SESSION_TTL_MINUTES * 60);
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

function isRequestSecure(req) {
  if (TLS_ENABLED || req.socket.encrypted) return true;
  if (!ADMIN_TRUST_PROXY) return false;
  return clean(req.headers["x-forwarded-proto"]).split(",")[0].toLowerCase() === "https";
}

function clientAddress(req) {
  if (ADMIN_TRUST_PROXY) {
    const forwarded = clean(req.headers["x-forwarded-for"]).split(",")[0];
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

async function readJsonBody(req, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function isSameOriginAdminRequest(req) {
  const fetchSite = clean(req.headers["sec-fetch-site"]).toLowerCase();
  if (fetchSite) return fetchSite === "same-origin";
  const origin = clean(req.headers.origin);
  if (!origin) return true;
  try {
    const forwardedHost = clean(req.headers["x-forwarded-host"]).split(",")[0];
    return new URL(origin).host === (forwardedHost || req.headers.host);
  } catch {
    return false;
  }
}

async function runBackup(reason) {
  if (state.backup.running) return { accepted: false, message: "A backup is already running." };
  state.backup.running = true;
  state.backup.lastError = null;
  try {
    const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const result = storage.createBackup(path.join(BACKUP_DIR, `weather-${stamp}.db`));
    deploymentStatus.pruneBackups(BACKUP_RETENTION_DAYS, BACKUP_MAX_FILES);
    state.backup.lastResult = { ...result, path: undefined, reason };
    return { accepted: true, backup: state.backup.lastResult };
  } catch (error) {
    state.backup.lastError = error.message;
    throw error;
  } finally {
    state.backup.running = false;
  }
}

async function runBackfill(macAddress, days) {
  const cutoff = Date.now() - days * 86400000;
  const stats = storage.getReadingStats(macAddress);
  let oldest = stats.firstReadingAt ? Date.parse(stats.firstReadingAt) : Date.now();
  let cursor = oldest - 1;
  state.backfill = {
    running: true,
    requestedDays: days,
    pages: 0,
    oldestReadingAt: new Date(oldest).toISOString(),
    lastError: null,
    completedAt: null
  };
  try {
    while (oldest > cutoff) {
      const history = await fetchDeviceHistory(macAddress, apiKeyByMac.get(macAddress) || API_KEYS[0], {
        limit: 288,
        endDate: new Date(cursor).toISOString()
      });
      const timestamps = [];
      for (const item of history || []) {
        const sanitized = sanitizeData({ ...item, macAddress }, macAddress);
        persistReading(sanitized, "ambient-backfill");
        const timestamp = Number(sanitized.dateutc) || Date.parse(sanitized.date || "");
        if (Number.isFinite(timestamp)) timestamps.push(timestamp);
      }
      if (!timestamps.length) break;
      const nextOldest = Math.min(...timestamps);
      if (nextOldest >= oldest) break;
      oldest = nextOldest;
      cursor = oldest - 1;
      state.backfill.pages += 1;
      state.backfill.oldestReadingAt = new Date(oldest).toISOString();
      if (oldest > cutoff) await sleep(2200);
    }
    state.backfill.completedAt = new Date().toISOString();
  } catch (error) {
    state.backfill.lastError = error.message;
    throw error;
  } finally {
    state.backfill.running = false;
  }
}

function publicDevices() {
  return Array.from(devicesByMac.values()).filter(Boolean);
}

function firstKnownMac() {
  return devicesByMac.keys().next().value || null;
}

function hydrateFromStorage() {
  if (!storage.enabled) return;

  try {
    for (const device of storage.getDevices()) {
      if (device && device.macAddress) {
        devicesByMac.set(device.macAddress, device);
      }
    }

    for (const reading of storage.getLatestReadings()) {
      if (!reading || !reading.macAddress) continue;
      latestByMac.set(reading.macAddress, reading);

      const device = devicesByMac.get(reading.macAddress);
      if (device) {
        device.lastData = reading;
      } else {
        devicesByMac.set(reading.macAddress, {
          macAddress: reading.macAddress,
          info: {
            name: "Weather Station",
            location: "",
            elevation: null
          },
          lastData: reading,
          lastSeen: reading.date || new Date(reading.dateutc).toISOString()
        });
      }
    }
  } catch (error) {
    recordError(error);
  }
}

function readLocalHistory(macAddress, options) {
  if (!storage.enabled) {
    return liveHistoryFor(macAddress).data;
  }

  try {
    return storage.getHistory(macAddress, options);
  } catch (error) {
    recordError(error);
    return liveHistoryFor(macAddress).data;
  }
}

function persistDevice(device) {
  try {
    storage.saveDevice(device);
  } catch (error) {
    recordError(error);
  }
}

function persistReading(reading, source) {
  try {
    storage.saveReading(reading, source);
  } catch (error) {
    recordError(error);
  }
}

function openEventStream(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...securityHeaders()
  });
  res.write(": connected\n\n");

  const client = { res };
  clients.add(client);
  sendEvent(client, "state", publicState());

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

function broadcast(event, payload) {
  for (const client of clients) {
    sendEvent(client, event, payload);
  }
}

function sendEvent(client, event, payload) {
  client.res.write(`event: ${event}\n`);
  client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function recordError(error) {
  const message = error && error.message ? error.message : String(error);
  state.errors.push({ at: new Date().toISOString(), message });
  while (state.errors.length > 20) {
    state.errors.shift();
  }
  console.error(message);
}

function shutdown() {
  adminAuth.clearSessions();
  storage.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

function parseApiKeys() {
  const combined = process.env.AMBIENT_API_KEYS || process.env.AMBIENT_API_KEY || "";
  return combined
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function loadAdminPasswordHash() {
  const configuredFile = clean(process.env.ADMIN_PASSWORD_HASH_FILE);
  if (!configuredFile) return clean(process.env.ADMIN_PASSWORD_HASH);
  const filePath = path.isAbsolute(configuredFile)
    ? configuredFile
    : path.resolve(ROOT_DIR, configuredFile);
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    throw new Error(`Unable to read ADMIN_PASSWORD_HASH_FILE: ${error.message}`);
  }
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function timezoneFromEnv() {
  const value = clean(process.env.STATION_TIMEZONE) || clean(process.env.TZ) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error(`STATION_TIMEZONE must be a valid IANA timezone; received ${value}.`);
  }
}

function booleanFromEnv(name, fallback) {
  const value = clean(process.env[name]).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function loadTlsOptions() {
  try {
    return {
      cert: fs.readFileSync(TLS_CERT_PATH),
      key: fs.readFileSync(TLS_KEY_PATH),
      minVersion: "TLSv1.2"
    };
  } catch (error) {
    throw new Error(
      `TLS is enabled but its certificate could not be loaded: ${error.message}`
    );
  }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
