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
            createdAt: stats.mtime.toISOString()
          };
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch {
      return [];
    }
  }

  function pruneBackups(retentionDays, maximumFiles) {
    const now = Date.now();
    const files = listBackups().filter((file) => file.type === "database");
    files.forEach((file, index) => {
      const tooOld = retentionDays > 0
        && now - Date.parse(file.createdAt) > retentionDays * 86400000;
      const tooMany = maximumFiles > 0 && index >= maximumFiles;
      if (tooOld || tooMany) fs.unlinkSync(path.join(backupDir, file.filename));
    });
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

module.exports = { createDeploymentStatus };
