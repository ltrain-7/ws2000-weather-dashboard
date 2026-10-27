const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("public history cannot invoke Ambient, while maintenance backfill still imports observations", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "weather-history-api-"));
  const now = Date.now();
  let deviceCalls = 0;
  let historyCalls = 0;
  const provider = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (new URL(req.url, "http://fixture").pathname === "/v1/devices") {
      deviceCalls += 1;
      res.end(JSON.stringify([{ macAddress: "fixture", info: { name: "Fixture" }, lastData: { dateutc: now, tempf: 70 } }]));
    } else {
      historyCalls += 1;
      res.end(JSON.stringify([{ dateutc: now - 2 * 86400000, tempf: 60 }]));
    }
  });
  context.after(() => { provider.closeAllConnections(); provider.close(); });
  await listen(provider);
  const upstream = `http://127.0.0.1:${provider.address().port}`;
  const reservation = http.createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["--no-warnings", "src/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      SQLITE_DB_PATH: path.join(directory, "weather.db"), BACKUP_DIR: path.join(directory, "backups"),
      BACKUP_INTERVAL_HOURS: "0", ADMIN_AUTH_ENABLED: "false", ADMIN_TRUST_PROXY: "false",
      HTTPS_REDIRECT_ENABLED: "false", TLS_ENABLED: "false", FORECAST_ENABLED: "false",
      PUBLIC_QUERY_RATE_LIMIT: "120", AMBIENT_APPLICATION_KEY: "fake-application-key",
      AMBIENT_API_KEY: "fake-key", AMBIENT_API_KEYS: "fake-key", AMBIENT_DEVICE_MAC: "fixture",
      AMBIENT_REST_ORIGIN: upstream, AMBIENT_REALTIME_ORIGIN: upstream },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  context.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(logs);
    try { return (await request(port, "/api/latest")).body.devices.length === 1; } catch { return false; }
  });
  assert.equal(deviceCalls, 1);
  const blocked = await Promise.all(Array.from({ length: 20 }, () => request(port, "/api/history?source=ambient&limit=1")));
  assert.ok(blocked.every((result) => result.status === 400));
  const local = await request(port, "/api/history?limit=96");
  assert.equal(local.status, 200);
  assert.equal(local.body.source, "sqlite");
  assert.equal(local.body.count, 1);
  const empty = await request(port, "/api/history?endDate=2000-01-01");
  assert.equal(empty.body.count, 0);
  assert.equal(deviceCalls, 1);
  assert.equal(historyCalls, 0);

  const accepted = await request(port, "/api/admin/backfill?days=1", "POST");
  assert.equal(accepted.status, 202);
  await until(async () => {
    const result = await request(port, "/api/admin");
    return historyCalls === 1 && result.body.backfill.running === false;
  });
  const imported = await request(port, "/api/history?limit=96&source=local");
  assert.equal(imported.body.count, 2);
  assert.equal(historyCalls, 1);
});

function listen(server) {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
}

function request(port, url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: url, method }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function until(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the fixture server.");
}
