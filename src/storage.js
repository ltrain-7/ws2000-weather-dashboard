const fs = require("node:fs");
const path = require("node:path");

class DisabledWeatherStore {
  constructor(message) {
    this.enabled = false;
    this.message = message;
  }

  getStatus() {
    return {
      enabled: false,
      message: this.message
    };
  }

  getStats() {
    return {
      enabled: false,
      message: this.message,
      deviceCount: 0,
      readingCount: 0,
      firstReadingAt: null,
      latestReadingAt: null
    };
  }

  saveDevice() {}

  saveReading() {}

  prune() {
    return 0;
  }

  close() {}

  getDevices() {
    return [];
  }

  getLatestReadings() {
    return [];
  }

  getHistory() {
    return [];
  }
}

class WeatherStore {
  constructor(options) {
    this.enabled = true;
    this.dbPath = options.dbPath;
    this.retentionDays = options.retentionDays;
    this.message = "SQLite persistence is enabled.";

    const { DatabaseSync } = require("node:sqlite");

    if (this.dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.prepareStatements();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        mac_address TEXT PRIMARY KEY,
        name TEXT,
        location TEXT,
        elevation REAL,
        last_seen TEXT NOT NULL,
        device_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weather_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mac_address TEXT NOT NULL,
        dateutc INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        source TEXT NOT NULL,
        tempf REAL,
        humidity REAL,
        windspeedmph REAL,
        windgustmph REAL,
        dailyrainin REAL,
        hourlyrainin REAL,
        baromrelin REAL,
        solarradiation REAL,
        uv REAL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(mac_address, dateutc)
      );

      CREATE INDEX IF NOT EXISTS idx_weather_readings_mac_date
        ON weather_readings(mac_address, dateutc DESC);
    `);
  }

  prepareStatements() {
    this.statements = {
      saveDevice: this.db.prepare(`
        INSERT INTO devices (
          mac_address,
          name,
          location,
          elevation,
          last_seen,
          device_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(mac_address) DO UPDATE SET
          name = excluded.name,
          location = excluded.location,
          elevation = excluded.elevation,
          last_seen = excluded.last_seen,
          device_json = excluded.device_json
      `),
      saveReading: this.db.prepare(`
        INSERT INTO weather_readings (
          mac_address,
          dateutc,
          observed_at,
          source,
          tempf,
          humidity,
          windspeedmph,
          windgustmph,
          dailyrainin,
          hourlyrainin,
          baromrelin,
          solarradiation,
          uv,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mac_address, dateutc) DO UPDATE SET
          observed_at = excluded.observed_at,
          source = excluded.source,
          tempf = excluded.tempf,
          humidity = excluded.humidity,
          windspeedmph = excluded.windspeedmph,
          windgustmph = excluded.windgustmph,
          dailyrainin = excluded.dailyrainin,
          hourlyrainin = excluded.hourlyrainin,
          baromrelin = excluded.baromrelin,
          solarradiation = excluded.solarradiation,
          uv = excluded.uv,
          payload_json = excluded.payload_json,
          updated_at = CURRENT_TIMESTAMP
      `),
      devices: this.db.prepare(`
        SELECT device_json
        FROM devices
        ORDER BY name COLLATE NOCASE, mac_address
      `),
      latestReadings: this.db.prepare(`
        SELECT wr.payload_json
        FROM weather_readings wr
        JOIN (
          SELECT mac_address, MAX(dateutc) AS max_dateutc
          FROM weather_readings
          GROUP BY mac_address
        ) latest
          ON latest.mac_address = wr.mac_address
          AND latest.max_dateutc = wr.dateutc
        ORDER BY wr.mac_address
      `),
      history: this.db.prepare(`
        SELECT payload_json
        FROM (
          SELECT payload_json, dateutc
          FROM weather_readings
          WHERE mac_address = ?
            AND (? IS NULL OR dateutc >= ?)
            AND (? IS NULL OR dateutc <= ?)
          ORDER BY dateutc DESC
          LIMIT ?
        )
        ORDER BY dateutc ASC
      `),
      sampledHistory: this.db.prepare(`
        WITH filtered AS (
          SELECT payload_json, dateutc
          FROM weather_readings
          WHERE mac_address = ?
            AND (? IS NULL OR dateutc >= ?)
            AND (? IS NULL OR dateutc <= ?)
        ),
        numbered AS (
          SELECT
            payload_json,
            dateutc,
            ROW_NUMBER() OVER (ORDER BY dateutc ASC) AS row_num,
            COUNT(*) OVER () AS total_rows
          FROM filtered
        )
        SELECT payload_json
        FROM numbered
        WHERE row_num = 1
          OR row_num = total_rows
          OR (row_num - 1) % MAX(1, (total_rows + ? - 1) / ?) = 0
        ORDER BY dateutc ASC
      `),
      prune: this.db.prepare(`
        DELETE FROM weather_readings
        WHERE dateutc < ?
      `),
      deviceCount: this.db.prepare("SELECT COUNT(*) AS count FROM devices"),
      readingStats: this.db.prepare(`
        SELECT
          COUNT(*) AS count,
          MIN(dateutc) AS first_dateutc,
          MAX(dateutc) AS latest_dateutc
        FROM weather_readings
      `)
    };
  }

  saveDevice(device) {
    if (!device || !device.macAddress) return;

    const info = device.info || {};
    this.statements.saveDevice.run(
      device.macAddress,
      info.name || "Weather Station",
      info.location || "",
      numberOrNull(info.elevation),
      device.lastSeen || new Date().toISOString(),
      JSON.stringify(device)
    );
  }

  saveReading(data, source) {
    if (!data || !data.macAddress) return;

    const dateutc = normalizeDateutc(data);
    const payload = {
      ...data,
      dateutc,
      date: data.date || new Date(dateutc).toISOString(),
      source
    };

    this.statements.saveReading.run(
      payload.macAddress,
      dateutc,
      new Date(dateutc).toISOString(),
      source,
      numberOrNull(payload.tempf),
      numberOrNull(payload.humidity),
      numberOrNull(payload.windspeedmph),
      numberOrNull(payload.windgustmph),
      numberOrNull(payload.dailyrainin),
      numberOrNull(payload.hourlyrainin),
      numberOrNull(payload.baromrelin),
      numberOrNull(payload.solarradiation),
      numberOrNull(payload.uv),
      JSON.stringify(payload)
    );
  }

  getDevices() {
    return this.statements.devices.all().map((row) => parseJson(row.device_json));
  }

  getLatestReadings() {
    return this.statements.latestReadings.all().map((row) => parseJson(row.payload_json));
  }

  getHistory(macAddress, options = {}) {
    if (!macAddress) return [];
    const limit = clamp(Number(options.limit || 288), 1, 10000);
    const startDate = options.startDate ? normalizeDateutc({ dateutc: options.startDate }) : null;
    const endDate = options.endDate ? normalizeDateutc({ dateutc: options.endDate }) : null;
    const maxPoints = clamp(Number(options.maxPoints || 0), 0, 2000);
    if (maxPoints >= 2 && (startDate || endDate)) {
      return this.statements.sampledHistory
        .all(macAddress, startDate, startDate, endDate, endDate, maxPoints, maxPoints)
        .map((row) => parseJson(row.payload_json));
    }
    return this.statements.history
      .all(macAddress, startDate, startDate, endDate, endDate, limit)
      .map((row) => parseJson(row.payload_json));
  }

  prune() {
    if (!this.retentionDays) return 0;

    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const result = this.statements.prune.run(cutoff);
    return result.changes || 0;
  }

  getStatus() {
    return {
      enabled: true,
      message: this.message,
      retentionDays: this.retentionDays,
      database: this.dbPath === ":memory:" ? ":memory:" : path.basename(this.dbPath)
    };
  }

  getStats() {
    const deviceCount = this.statements.deviceCount.get().count;
    const readingStats = this.statements.readingStats.get();
    return {
      ...this.getStatus(),
      deviceCount,
      readingCount: readingStats.count,
      firstReadingAt: readingStats.first_dateutc
        ? new Date(readingStats.first_dateutc).toISOString()
        : null,
      latestReadingAt: readingStats.latest_dateutc
        ? new Date(readingStats.latest_dateutc).toISOString()
        : null
    };
  }

  close() {
    this.db.close();
  }
}

function createWeatherStore(options) {
  try {
    return new WeatherStore(options);
  } catch (error) {
    return new DisabledWeatherStore(error.message);
  }
}

function normalizeDateutc(data) {
  const direct = Number(data.dateutc);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const parsed = Date.parse(data.dateutc || data.date || data.observed_at || data.created_at || "");
  if (Number.isFinite(parsed)) return parsed;

  return Date.now();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  createWeatherStore
};
