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

  getAnalytics() {
    return emptyAnalytics();
  }

  getReadingStats() {
    return { readingCount: 0, firstReadingAt: null, latestReadingAt: null };
  }

  integrityCheck() {
    return { ok: false, result: this.message };
  }

  createBackup() {
    throw new Error(this.message);
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
      `),
      readingStatsByDevice: this.db.prepare(`
        SELECT COUNT(*) AS count, MIN(dateutc) AS first_dateutc, MAX(dateutc) AS latest_dateutc
        FROM weather_readings
        WHERE mac_address = ?
      `),
      periodSummary: this.db.prepare(`
        SELECT
          COUNT(*) AS reading_count,
          AVG(tempf) AS average_tempf,
          MIN(tempf) AS minimum_tempf,
          MAX(tempf) AS maximum_tempf,
          AVG(humidity) AS average_humidity,
          AVG(windspeedmph) AS average_wind_mph,
          MAX(windgustmph) AS maximum_gust_mph,
          MAX(hourlyrainin) AS maximum_rain_rate_in
        FROM weather_readings
        WHERE mac_address = ? AND dateutc >= ? AND dateutc < ?
      `),
      minimumTemperature: this.db.prepare(`
        SELECT tempf AS value, dateutc
        FROM weather_readings
        WHERE mac_address = ? AND dateutc >= ? AND dateutc < ? AND tempf IS NOT NULL
        ORDER BY tempf ASC, dateutc ASC
        LIMIT 1
      `),
      maximumTemperature: this.db.prepare(`
        SELECT tempf AS value, dateutc
        FROM weather_readings
        WHERE mac_address = ? AND dateutc >= ? AND dateutc < ? AND tempf IS NOT NULL
        ORDER BY tempf DESC, dateutc ASC
        LIMIT 1
      `),
      dailyRain: this.db.prepare(`
        SELECT
          date(dateutc / 1000, 'unixepoch', 'localtime') AS day,
          MAX(dailyrainin) AS rain_in
        FROM weather_readings
        WHERE mac_address = ? AND dateutc >= ? AND dateutc < ?
        GROUP BY day
        ORDER BY day ASC
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
    const startDate = options.startDate ? requireDateutc(options.startDate, "startDate") : null;
    const endDate = options.endDate ? requireDateutc(options.endDate, "endDate") : null;
    if (startDate && endDate && startDate > endDate) {
      throw clientError("startDate must not be later than endDate.");
    }
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
    let databaseBytes = null;
    if (this.dbPath !== ":memory:") {
      try {
        databaseBytes = fs.statSync(this.dbPath).size;
      } catch {}
    }
    return {
      ...this.getStatus(),
      deviceCount,
      readingCount: readingStats.count,
      firstReadingAt: readingStats.first_dateutc
        ? new Date(readingStats.first_dateutc).toISOString()
        : null,
      latestReadingAt: readingStats.latest_dateutc
        ? new Date(readingStats.latest_dateutc).toISOString()
        : null,
      databaseBytes
    };
  }

  getAnalytics(macAddress, startDate, endDate) {
    if (!macAddress) return emptyAnalytics();
    const start = requireDateutc(startDate, "startDate");
    const end = requireDateutc(endDate, "endDate");
    if (start >= end) throw clientError("startDate must be earlier than endDate.");
    const summary = this.statements.periodSummary.get(macAddress, start, end);
    const minimumTemperature = this.statements.minimumTemperature.get(macAddress, start, end);
    const maximumTemperature = this.statements.maximumTemperature.get(macAddress, start, end);
    const dailyRain = this.statements.dailyRain
      .all(macAddress, start, end)
      .map((row) => ({ day: row.day, rainIn: numberOrZero(row.rain_in) }));
    return {
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
      readingCount: summary.reading_count,
      averageTempf: numberOrNull(summary.average_tempf),
      minimumTempf: numberOrNull(summary.minimum_tempf),
      maximumTempf: numberOrNull(summary.maximum_tempf),
      minimumTempAt: minimumTemperature?.dateutc
        ? new Date(minimumTemperature.dateutc).toISOString()
        : null,
      maximumTempAt: maximumTemperature?.dateutc
        ? new Date(maximumTemperature.dateutc).toISOString()
        : null,
      averageHumidity: numberOrNull(summary.average_humidity),
      averageWindMph: numberOrNull(summary.average_wind_mph),
      maximumGustMph: numberOrNull(summary.maximum_gust_mph),
      maximumRainRateIn: numberOrNull(summary.maximum_rain_rate_in),
      rainfallTotalIn: dailyRain.reduce((sum, row) => sum + row.rainIn, 0),
      wettestDay: dailyRain.reduce(
        (wettest, row) => (!wettest || row.rainIn > wettest.rainIn ? row : wettest),
        null
      ),
      dailyRain
    };
  }

  getReadingStats(macAddress) {
    const stats = this.statements.readingStatsByDevice.get(macAddress);
    return {
      readingCount: stats.count,
      firstReadingAt: stats.first_dateutc ? new Date(stats.first_dateutc).toISOString() : null,
      latestReadingAt: stats.latest_dateutc ? new Date(stats.latest_dateutc).toISOString() : null
    };
  }

  integrityCheck() {
    const rows = this.db.prepare("PRAGMA quick_check").all();
    const result = rows.map((row) => Object.values(row)[0]).join("; ");
    return { ok: result === "ok", result };
  }

  createBackup(backupPath) {
    if (this.dbPath === ":memory:") {
      throw new Error("In-memory databases cannot be backed up.");
    }
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    if (fs.existsSync(backupPath)) {
      throw new Error("Backup destination already exists.");
    }
    // SQLite does not allow binding VACUUM INTO's filename. backupPath is generated
    // exclusively by the server; retain SQL quote escaping if that ever changes.
    const escapedPath = String(backupPath).replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escapedPath}'`);
    const integrity = verifyDatabaseFile(backupPath);
    if (!integrity.ok) {
      fs.unlinkSync(backupPath);
      throw new Error(`Backup integrity check failed: ${integrity.result}`);
    }
    return {
      path: backupPath,
      filename: path.basename(backupPath),
      bytes: fs.statSync(backupPath).size,
      createdAt: new Date().toISOString(),
      integrity
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
  const parsed = parseDateutc(data);
  return parsed === null ? Date.now() : parsed;
}

function requireDateutc(value, name) {
  const parsed = parseDateutc({ dateutc: value });
  if (parsed === null) throw clientError(`${name} must be a valid date or timestamp.`);
  return parsed;
}

function parseDateutc(data) {
  const direct = Number(data.dateutc);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const parsed = Date.parse(data.dateutc || data.date || data.observed_at || data.created_at || "");
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function emptyAnalytics() {
  return {
    readingCount: 0,
    averageTempf: null,
    minimumTempf: null,
    maximumTempf: null,
    minimumTempAt: null,
    maximumTempAt: null,
    rainfallTotalIn: 0,
    wettestDay: null,
    dailyRain: []
  };
}

function verifyDatabaseFile(filePath) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = database.prepare("PRAGMA quick_check").all();
    const result = rows.map((row) => Object.values(row)[0]).join("; ");
    return { ok: result === "ok", result };
  } finally {
    database.close();
  }
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
