const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createWeatherStore } = require("../src/storage");

test("analytics aggregate rainfall by local day and create a verified backup", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-storage-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createWeatherStore({
    dbPath: path.join(directory, "weather.db"),
    retentionDays: 365
  });
  context.after(() => store.close());

  assert.equal(store.enabled, true, store.message);
  const macAddress = "AA:BB:CC:DD:EE:FF";
  const readings = [
    ["2026-08-23T12:00:00Z", 0.1, 70, 10],
    ["2026-08-23T23:00:00Z", 0.35, 74, 18],
    ["2026-08-24T12:00:00Z", 0.2, 76, 15]
  ];
  for (const [date, rain, temperature, gust] of readings) {
    store.saveReading(
      {
        macAddress,
        dateutc: Date.parse(date),
        tempf: temperature,
        humidity: 60,
        windspeedmph: 4,
        windgustmph: gust,
        dailyrainin: rain,
        hourlyrainin: rain
      },
      "test"
    );
  }

  const analytics = store.getAnalytics(
    macAddress,
    Date.parse("2026-08-23T00:00:00Z"),
    Date.parse("2026-08-25T00:00:00Z")
  );
  assert.equal(analytics.readingCount, 3);
  assert.equal(analytics.maximumGustMph, 18);
  assert.equal(analytics.minimumTempAt, "2026-08-23T12:00:00.000Z");
  assert.equal(analytics.maximumTempAt, "2026-08-24T12:00:00.000Z");
  assert.ok(Math.abs(analytics.rainfallTotalIn - 0.55) < 0.0001);
  assert.deepEqual(analytics.wettestDay, { day: "2026-08-23", rainIn: 0.35 });
  assert.deepEqual(store.integrityCheck(), { ok: true, result: "ok" });

  const backupPath = path.join(directory, "backups", "weather-test.db");
  const backup = store.createBackup(backupPath);
  assert.equal(backup.integrity.ok, true);
  assert.ok(backup.bytes > 0);
  assert.equal(fs.existsSync(backupPath), true);

  assert.throws(
    () => store.getHistory(macAddress, { startDate: "not-a-date" }),
    (error) => error.statusCode === 400 && /startDate/.test(error.message)
  );
  assert.throws(
    () => store.getAnalytics(macAddress, "not-a-date", Date.now()),
    (error) => error.statusCode === 400 && /startDate/.test(error.message)
  );
  assert.throws(
    () => store.getAnalytics(macAddress, Date.now(), Date.now() - 1),
    (error) => error.statusCode === 400 && /earlier than endDate/.test(error.message)
  );
});

test("empty analytics preserve missing values instead of reporting false zeroes", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-empty-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createWeatherStore({
    dbPath: path.join(directory, "weather.db"),
    retentionDays: 365
  });
  context.after(() => store.close());

  const analytics = store.getAnalytics("missing", Date.now() - 86400000, Date.now());
  assert.equal(analytics.readingCount, 0);
  assert.equal(analytics.averageTempf, null);
  assert.equal(analytics.minimumTempAt, null);
  assert.equal(analytics.maximumTempAt, null);
  assert.equal(analytics.rainfallTotalIn, 0);
  assert.equal(analytics.wettestDay, null);
});

test("daily rainfall follows the configured station timezone", (context) => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  context.after(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-timezone-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createWeatherStore({
    dbPath: path.join(directory, "weather.db"),
    retentionDays: 365
  });
  context.after(() => store.close());

  const macAddress = "timezone-test-station";
  for (const [date, rain] of [
    ["2026-08-24T01:00:00Z", 0.4],
    ["2026-08-24T08:00:00Z", 0.2]
  ]) {
    store.saveReading({
      macAddress,
      dateutc: Date.parse(date),
      tempf: 70,
      dailyrainin: rain,
      hourlyrainin: rain
    }, "test");
  }

  const analytics = store.getAnalytics(
    macAddress,
    Date.parse("2026-08-23T00:00:00Z"),
    Date.parse("2026-08-25T00:00:00Z")
  );
  assert.deepEqual(analytics.dailyRain, [
    { day: "2026-08-23", rainIn: 0.4 },
    { day: "2026-08-24", rainIn: 0.2 }
  ]);
});
