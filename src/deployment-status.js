const fs = require("node:fs");
const path = require("node:path");

function createDeploymentStatus(options) {
  const backupDir = options.backupDir;
  const metadataPath = options.metadataPath;
  const packageInfo = options.packageInfo;
  const startedAt = options.startedAt;

  function status() {
    const metadata = readJson(metadataPath);
    return {
      version: packageInfo.version,
      revision: clean(metadata.revision) || clean(process.env.APP_REVISION) || null,
      image: clean(metadata.image) || clean(process.env.APP_IMAGE) || clean(process.env.WS2000_IMAGE) || null,
      digest: clean(metadata.digest) || clean(process.env.APP_IMAGE_DIGEST) || null,
      updatedAt: validDate(metadata.updatedAt) || validDate(process.env.APP_DEPLOYED_AT) || startedAt,
      metadataSource: metadata.updatedAt ? "updater" : "runtime"
    };
  }

  function listBackups() {
    try {
      return fs.readdirSync(backupDir)
        .filter((name) => /^weather-(?:data-.*\.tgz|.*\.db)$/.test(name))
        .map((name) => {
          const stats = fs.statSync(path.join(backupDir, name));
          return {
            filename: name,
            type: name.endsWith(".tgz") ? "deployment" : "database",
            bytes: stats.size,
            createdAt: backupCreatedAt(name, stats.mtime)
          };
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch {
      return [];
    }
  }

  function pruneBackups(retentionDays, maximumFiles) {
    const now = Date.now();
    for (const type of ["database", "deployment"]) {
      const files = listBackups().filter((file) => file.type === type);
      files.forEach((file, index) => {
        const tooOld = retentionDays > 0
          && now - Date.parse(file.createdAt) > retentionDays * 86400000;
        const tooMany = maximumFiles > 0 && index >= maximumFiles;
        if (tooOld || tooMany) fs.unlinkSync(path.join(backupDir, file.filename));
      });
    }
  }

  return { listBackups, pruneBackups, status };
}

function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function backupCreatedAt(filename, fallback) {
  const database = /^weather-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/.exec(filename);
  const deployment = /^weather-data-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.tgz$/.exec(filename);
  const parts = database || deployment;
  if (!parts) return fallback.toISOString();
  const values = parts.slice(1).map(Number);
  const timestamp = Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]);
  const date = new Date(timestamp);
  const valid = date.getUTCFullYear() === values[0]
    && date.getUTCMonth() + 1 === values[1]
    && date.getUTCDate() === values[2]
    && date.getUTCHours() === values[3]
    && date.getUTCMinutes() === values[4]
    && date.getUTCSeconds() === values[5];
  return valid ? date.toISOString() : fallback.toISOString();
}

module.exports = { createDeploymentStatus };
