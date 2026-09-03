const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createDeploymentStatus } = require("../src/deployment-status");

test("deployment status reports updater metadata and both backup types", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-deployment-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const backupDir = path.join(directory, "backups");
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(backupDir, "weather-data-20260901-010203.tgz"), "deployment");
  fs.writeFileSync(path.join(backupDir, "weather-20260901T010203Z.db"), "database");
  const metadataPath = path.join(directory, "deployment.json");
  fs.writeFileSync(metadataPath, JSON.stringify({
    image: "ghcr.io/ltrain-7/ws2000-weather-dashboard:v1.8.0",
    digest: "ghcr.io/ltrain-7/ws2000-weather-dashboard@sha256:abc123",
    revision: "1234567890abcdef",
    updatedAt: "2026-09-01T01:02:03Z"
  }));

  const deployment = createDeploymentStatus({
    backupDir,
    metadataPath,
    packageInfo: { version: "1.8.0" },
    startedAt: "2026-09-01T00:00:00Z"
  });
  assert.deepEqual(deployment.status(), {
    version: "1.8.0",
    revision: "1234567890abcdef",
    image: "ghcr.io/ltrain-7/ws2000-weather-dashboard:v1.8.0",
    digest: "ghcr.io/ltrain-7/ws2000-weather-dashboard@sha256:abc123",
    updatedAt: "2026-09-01T01:02:03.000Z",
    metadataSource: "updater"
  });
  assert.deepEqual(new Set(deployment.listBackups().map((backup) => backup.type)), new Set(["database", "deployment"]));
  assert.deepEqual(
    new Set(deployment.listBackups().map((backup) => backup.createdAt)),
    new Set(["2026-09-01T01:02:03.000Z"])
  );
});

test("backup pruning uses filename timestamps for database and deployment archives", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-pruning-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const filename of [
    "weather-20200101T010203Z.db",
    "weather-data-20200101-010203.tgz",
    "weather-20990101T010203Z.db",
    "weather-data-20990101-010203.tgz"
  ]) {
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, filename);
    fs.utimesSync(filePath, new Date(), new Date());
  }
  const deployment = createDeploymentStatus({
    backupDir: directory,
    metadataPath: path.join(directory, "missing.json"),
    packageInfo: { version: "test" },
    startedAt: new Date().toISOString()
  });
  deployment.pruneBackups(30, 12);
  assert.deepEqual(
    deployment.listBackups().map((backup) => backup.filename).sort(),
    ["weather-20990101T010203Z.db", "weather-data-20990101-010203.tgz"].sort()
  );
});

test("guarded updater records deployment metadata only after a healthy start", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-updater-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "data"));
  fs.writeFileSync(path.join(directory, "data", "weather.db"), "database");
  fs.writeFileSync(path.join(directory, "docker-compose.yml"), "services: {}\n");
  const docker = path.join(directory, "fake-docker");
  fs.writeFileSync(docker, `#!/bin/sh
case "$*" in
  *State.Health*) echo healthy ;;
  "inspect --format {{.Image}} ws2000-dashboard") echo sha256:old ;;
  "image inspect --format {{.Id}} "*) echo sha256:new ;;
  *RepoDigests*) echo ghcr.io/ltrain-7/ws2000-weather-dashboard@sha256:abc123 ;;
  *org.opencontainers.image.revision*) echo 1234567890abcdef ;;
esac
exit 0
`);
  fs.chmodSync(docker, 0o755);

  const result = spawnSync("sh", [path.resolve(__dirname, "../scripts/update.sh")], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, BACKUP_DIR: path.join(directory, "backups"), DOCKER_BIN: docker, PROJECT_DIR: directory }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "data", "deployment.json"), "utf8"));
  assert.equal(metadata.digest, "ghcr.io/ltrain-7/ws2000-weather-dashboard@sha256:abc123");
  assert.equal(metadata.revision, "1234567890abcdef");
  assert.ok(Number.isFinite(Date.parse(metadata.updatedAt)));
  assert.equal(fs.readdirSync(path.join(directory, "backups")).filter((name) => name.endsWith(".tgz")).length, 1);
});
