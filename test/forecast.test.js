const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createForecastService, locationFromDevice } = require("../src/forecast");

const providerPayload = {
  timezone: "America/New_York",
  daily: {
    time: ["2026-09-03", "2026-09-04"],
    weather_code: [2, 61],
    temperature_2m_max: [78.4, 74],
    temperature_2m_min: [60.7, 58],
    precipitation_probability_max: [42, 60],
    precipitation_sum: [0.02, 0.3],
    wind_gusts_10m_max: [12, 18],
    sunrise: ["2026-09-03T06:27", "2026-09-04T06:28"],
    sunset: ["2026-09-03T19:27", "2026-09-04T19:25"]
  }
};

test("forecast uses private station coordinates, imperial units, and a server cache", async () => {
  const requests = [];
  const service = createForecastService({
    timezone: "America/New_York",
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => providerPayload };
    }
  });

  assert.equal(service.useDevice({
    info: {
      name: "Back Yard",
      coords: { coords: { lat: 40.123, lon: -75.456 } }
    }
  }), true);

  const first = await service.getForecast();
  const second = await service.getForecast();
  assert.equal(requests.length, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.locationName, "Back Yard");
  assert.equal(first.days[0].precipitationProbability, 42);
  assert.doesNotMatch(JSON.stringify(first), /40\.123|-75\.456|latitude|longitude/);

  const url = new URL(requests[0]);
  assert.equal(url.pathname, "/v1/forecast");
  assert.equal(url.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(url.searchParams.get("wind_speed_unit"), "mph");
  assert.equal(url.searchParams.get("precipitation_unit"), "inch");
  assert.equal(url.searchParams.get("timezone"), "America/New_York");
  assert.equal(service.status().locationSource, "station");
});

test("forecast stays gracefully unavailable until a valid location exists", async () => {
  let fetchCount = 0;
  const service = createForecastService({ fetchImpl: async () => { fetchCount += 1; } });
  assert.equal(locationFromDevice({ info: { coords: { coords: { lat: "", lon: "" } } } }), null);
  assert.equal(locationFromDevice({ info: { coords: { coords: { lat: 0, lon: 0 } } } }), null);
  assert.deepEqual(await service.getForecast(), {
    enabled: true,
    available: false,
    reason: "location-unavailable"
  });
  assert.equal(fetchCount, 0);
});

test("forecast returns its last successful result when the provider is temporarily unavailable", async () => {
  let clock = Date.parse("2026-09-03T12:00:00Z");
  let shouldFail = false;
  let fetchCount = 0;
  const service = createForecastService({
    latitude: 40,
    longitude: -75,
    cacheTtlMs: 15 * 60 * 1000,
    now: () => clock,
    fetchImpl: async () => {
      fetchCount += 1;
      if (shouldFail) throw new Error("temporary outage");
      return { ok: true, json: async () => providerPayload };
    }
  });
  await service.getForecast();
  clock += 16 * 60 * 1000;
  shouldFail = true;
  const fallback = await service.getForecast();
  assert.equal(fallback.cached, true);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.days.length, 2);
  assert.equal(service.status().lastError, "temporary outage");
  const repeatedFallback = await service.getForecast();
  assert.equal(repeatedFallback.stale, true);
  assert.equal(fetchCount, 2);
});

test("forecast failures are throttled before the first successful response", async () => {
  let clock = Date.parse("2026-09-03T12:00:00Z");
  let fetchCount = 0;
  const service = createForecastService({
    latitude: 40,
    longitude: -75,
    failureBackoffMs: 15000,
    now: () => clock,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("provider unavailable");
    }
  });
  await assert.rejects(service.getForecast(), /provider unavailable/);
  await assert.rejects(service.getForecast(), /temporarily delayed/);
  assert.equal(fetchCount, 1);
  assert.ok(service.status().retryAt);
  clock += 15001;
  await assert.rejects(service.getForecast(), /provider unavailable/);
  assert.equal(fetchCount, 2);
});

test("forecast cards convert weather codes into concise accessible labels", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/forecast.js"), "utf8");
  const context = { window: {}, Intl };
  vm.runInNewContext(source, context);
  const card = context.window.WeatherForecast.cardView(providerPayload.daily.time.length ? {
    date: "2026-09-03",
    weatherCode: 2,
    highF: 78.4,
    lowF: 60.7,
    precipitationProbability: 42,
    maximumGustMph: 12
  } : {}, 0);
  assert.equal(card.dayLabel, "Today");
  assert.equal(card.condition, "Partly cloudy");
  assert.equal(card.high, "78°");
  assert.match(card.accessibleLabel, /High 78°, low 61°\. 42% rain\. Gust 12 mph\./);
  const missing = context.window.WeatherForecast.cardView({ date: "2026-09-04", weatherCode: null }, 1);
  assert.equal(missing.condition, "Forecast unavailable");
  assert.equal(missing.high, "--");
  assert.equal(missing.rain, "Rain --");
});
