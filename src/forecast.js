const DEFAULT_ORIGIN = "https://api.open-meteo.com";
const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_gusts_10m_max",
  "sunrise",
  "sunset"
];

function createForecastService(options = {}) {
  const enabled = options.enabled !== false;
  const timezone = options.timezone || "auto";
  const days = clamp(Number(options.days || 5), 3, 7);
  const cacheTtlMs = clamp(Number(options.cacheTtlMs || 60 * 60 * 1000), 15 * 60 * 1000, 6 * 60 * 60 * 1000);
  const failureBackoffMs = clamp(Number(options.failureBackoffMs || 60 * 1000), 15 * 1000, 15 * 60 * 1000);
  const origin = options.origin || DEFAULT_ORIGIN;
  const fetchImpl = options.fetchImpl || fetch;
  const nowMs = options.now || Date.now;
  const configuredLocation = normalizeLocation({
    latitude: options.latitude,
    longitude: options.longitude,
    name: options.locationName,
    source: "environment"
  });
  let location = configuredLocation;
  let cached = null;
  let lastError = null;
  let lastFailureAt = null;

  function useDevice(device) {
    if (!enabled || configuredLocation) return false;
    const detected = locationFromDevice(device);
    if (!detected) return false;
    const changed = !location
      || location.latitude !== detected.latitude
      || location.longitude !== detected.longitude;
    location = detected;
    if (changed) {
      cached = null;
      lastError = null;
      lastFailureAt = null;
    }
    return changed;
  }

  async function getForecast() {
    if (!enabled) return { enabled: false, available: false };
    if (!location) {
      return { enabled: true, available: false, reason: "location-unavailable" };
    }
    const now = nowMs();
    if (cached && now - Date.parse(cached.updatedAt) < cacheTtlMs) {
      return { ...cached, cached: true };
    }
    if (lastFailureAt !== null && now - lastFailureAt < failureBackoffMs) {
      if (cached) return { ...cached, cached: true, stale: true };
      const error = new Error("Forecast provider retry is temporarily delayed.");
      error.retryAfterSeconds = Math.ceil((failureBackoffMs - (now - lastFailureAt)) / 1000);
      throw error;
    }

    try {
      const url = forecastUrl(origin, location, timezone, days);
      const response = await fetchWithTimeout(fetchImpl, url, 12000);
      if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
      const payload = await response.json();
      cached = normalizeForecast(payload, location, days, new Date(now).toISOString());
      lastError = null;
      lastFailureAt = null;
      return { ...cached, cached: false };
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      lastFailureAt = now;
      if (cached) return { ...cached, cached: true, stale: true };
      throw error;
    }
  }

  function status() {
    return {
      enabled,
      available: Boolean(location),
      locationName: location?.name || null,
      locationSource: location?.source || null,
      lastUpdatedAt: cached?.updatedAt || null,
      lastError,
      lastFailureAt: lastFailureAt === null ? null : new Date(lastFailureAt).toISOString(),
      retryAt: lastFailureAt === null ? null : new Date(lastFailureAt + failureBackoffMs).toISOString()
    };
  }

  return { getForecast, status, useDevice };
}

function forecastUrl(origin, location, timezone, days) {
  const url = new URL("/v1/forecast", origin);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("daily", DAILY_FIELDS.join(","));
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", String(days));
  return url;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "ws2000-weather-dashboard" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeForecast(payload, location, maximumDays, updatedAt) {
  const daily = payload?.daily || {};
  if (!Array.isArray(daily.time) || daily.time.length === 0) {
    throw new Error("Open-Meteo returned no daily forecast data");
  }
  const days = daily.time.slice(0, maximumDays).map((date, index) => ({
    date: String(date),
    weatherCode: numberOrNull(daily.weather_code?.[index]),
    highF: numberOrNull(daily.temperature_2m_max?.[index]),
    lowF: numberOrNull(daily.temperature_2m_min?.[index]),
    precipitationProbability: numberOrNull(daily.precipitation_probability_max?.[index]),
    precipitationIn: numberOrNull(daily.precipitation_sum?.[index]),
    maximumGustMph: numberOrNull(daily.wind_gusts_10m_max?.[index]),
    sunrise: stringOrNull(daily.sunrise?.[index]),
    sunset: stringOrNull(daily.sunset?.[index])
  }));
  return {
    enabled: true,
    available: true,
    provider: "Open-Meteo",
    providerUrl: "https://open-meteo.com/",
    locationName: location.name,
    timezone: payload.timezone || null,
    updatedAt,
    stale: false,
    days
  };
}

function locationFromDevice(device) {
  const info = device?.info || {};
  const coordinatePairs = [
    [info.coords?.coords?.lat, info.coords?.coords?.lon],
    [info.coords?.lat, info.coords?.lon],
    [info.latitude, info.longitude],
    [info.coords?.geo?.coordinates?.[1], info.coords?.geo?.coordinates?.[0]],
    [info.geo?.coordinates?.[1], info.geo?.coordinates?.[0]]
  ];
  for (const [latitude, longitude] of coordinatePairs) {
    const normalized = normalizeLocation({
      latitude,
      longitude,
      name: info.location || info.name || "Local forecast",
      source: "station"
    });
    if (normalized) return normalized;
  }
  return null;
}

function normalizeLocation(value) {
  if (value.latitude === undefined || value.latitude === null || value.latitude === "") return null;
  if (value.longitude === undefined || value.longitude === null || value.longitude === "") return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return {
    latitude,
    longitude,
    name: clean(value.name) || "Local forecast",
    source: value.source || "unknown"
  };
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

module.exports = { createForecastService, forecastUrl, locationFromDevice, normalizeForecast };
