const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  AdminAuth,
  LoginLimiter,
  hashPassword,
  parsePasswordHash,
  verifyPassword
} = require("../src/auth");

const root = path.resolve(__dirname, "..");
const testPassword = "correct horse weather battery";

test("scrypt password hashes are salted, portable, and timing-safe to verify", async () => {
  const encoded = await hashPassword(testPassword, {
    N: 16384,
    r: 8,
    p: 1,
    salt: Buffer.alloc(16, 7)
  });
  const parsed = parsePasswordHash(encoded);
  assert.equal(parsed.N, 16384);
  assert.equal(parsed.r, 8);
  assert.equal(parsed.p, 1);
  assert.equal(await verifyPassword(testPassword, encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
  assert.equal(await verifyPassword(testPassword, "sha256$not-supported"), false);
});

test("administrator sessions expire and login attempts are rate limited", async () => {
  let now = 10_000;
  const limiter = new LoginLimiter({ now: () => now, maxAttempts: 2, windowMs: 60_000 });
  const encoded = await hashPassword(testPassword, {
    N: 16384,
    r: 8,
    p: 1,
    salt: Buffer.alloc(16, 8)
  });
  const auth = new AdminAuth({
    enabled: true,
    username: "admin",
    passwordHash: encoded,
    sessionTtlMs: 5_000,
    now: () => now,
    limiter,
    randomBytes: (size) => Buffer.alloc(size, 9)
  });

  assert.equal((await auth.authenticate("admin", "bad", "client-a")).ok, false);
  const secondFailure = await auth.authenticate("admin", "bad", "client-a");
  assert.equal(secondFailure.allowed, false);
  assert.equal((await auth.authenticate("admin", testPassword, "client-a")).reason, "rate-limited");
  assert.equal((await auth.authenticate("admin", testPassword, "client-b")).ok, true);

  now += 60_001;
  const login = await auth.authenticate("admin", testPassword, "client-a");
  assert.equal(login.ok, true);
  assert.equal(auth.getSession(login.token).username, "admin");
  now += 5_001;
  assert.deepEqual(auth.sweep(), { limiterEntries: 0, sessions: 0 });
  assert.equal(auth.getSession(login.token), null);
});

test("enabled authentication fails closed when its password hash is invalid", () => {
  assert.throws(
    () => new AdminAuth({ enabled: true, username: "admin", passwordHash: "not-a-valid-hash" }),
    /not a supported scrypt hash/
  );
});

test("server protects administration routes, requires HTTPS and CSRF, and clears logout sessions", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws2000-auth-server-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const port = await availablePort();
  const encoded = await hashPassword(testPassword, {
    N: 16384,
    r: 8,
    p: 1,
    salt: Buffer.alloc(16, 10)
  });
  const child = spawn(process.execPath, ["--no-warnings", "src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AMBIENT_APPLICATION_KEY: "",
      AMBIENT_API_KEY: "",
      AMBIENT_API_KEYS: "",
      SQLITE_DB_PATH: path.join(directory, "weather.db"),
      BACKUP_DIR: path.join(directory, "backups"),
      BACKUP_INTERVAL_HOURS: "0",
      ADMIN_AUTH_ENABLED: "true",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD_HASH: encoded,
      ADMIN_TRUST_PROXY: "true",
      ADMIN_SESSION_TTL_MINUTES: "30",
      TLS_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  context.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  await waitForServer(port, child, () => logs);

  const unauthorizedApi = await request(port, { path: "/api/admin" });
  assert.equal(unauthorizedApi.statusCode, 401);
  assert.equal(unauthorizedApi.headers["cache-control"], "no-store");
  assert.match(unauthorizedApi.headers["content-security-policy"], /form-action 'self'/);
  assert.match(unauthorizedApi.headers["permissions-policy"], /camera=\(\)/);
  assert.equal(unauthorizedApi.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(unauthorizedApi.headers["strict-transport-security"], "max-age=31536000");

  const unauthorizedPage = await request(port, { path: "/admin.html" });
  assert.equal(unauthorizedPage.statusCode, 302);
  assert.equal(unauthorizedPage.headers.location, "/login.html?next=%2Fadmin.html");

  const insecureLogin = await request(port, {
    method: "POST",
    path: "/api/auth/login",
    headers: jsonHeaders("weather.test"),
    body: JSON.stringify({ username: "admin", password: testPassword })
  });
  assert.equal(insecureLogin.statusCode, 400);

  const login = await request(port, {
    method: "POST",
    path: "/api/auth/login",
    headers: { ...jsonHeaders("weather.test"), "x-forwarded-proto": "https" },
    body: JSON.stringify({ username: "admin", password: testPassword })
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.match(login.headers["set-cookie"][0], /^__Host-weather_session=.*; Path=\/; Max-Age=1800; Secure; HttpOnly; SameSite=Strict$/);
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  const loginBody = JSON.parse(login.body);
  assert.ok(loginBody.csrfToken);

  const authorizedApi = await request(port, {
    path: "/api/admin",
    headers: { cookie, "x-forwarded-proto": "https" }
  });
  assert.equal(authorizedApi.statusCode, 200, authorizedApi.body);

  const staticAsset = await request(port, { path: "/styles.css" });
  assert.equal(staticAsset.statusCode, 200);
  assert.ok(staticAsset.headers["last-modified"]);
  const unchangedAsset = await request(port, {
    path: "/styles.css",
    headers: { "if-modified-since": staticAsset.headers["last-modified"] }
  });
  assert.equal(unchangedAsset.statusCode, 304);
  assert.equal(unchangedAsset.body, "");

  const missingCsrf = await request(port, {
    method: "POST",
    path: "/api/admin/integrity",
    headers: { cookie, origin: "https://weather.test", host: "weather.test", "x-forwarded-proto": "https" }
  });
  assert.equal(missingCsrf.statusCode, 403);

  const integrity = await request(port, {
    method: "POST",
    path: "/api/admin/integrity",
    headers: {
      cookie,
      origin: "https://weather.test",
      host: "weather.test",
      "x-forwarded-proto": "https",
      "x-csrf-token": loginBody.csrfToken
    }
  });
  assert.equal(integrity.statusCode, 200, integrity.body);

  const logout = await request(port, {
    method: "POST",
    path: "/api/auth/logout",
    headers: {
      cookie,
      origin: "https://weather.test",
      host: "weather.test",
      "x-forwarded-proto": "https",
      "x-csrf-token": loginBody.csrfToken
    }
  });
  assert.equal(logout.statusCode, 200, logout.body);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);

  const afterLogout = await request(port, {
    path: "/api/admin",
    headers: { cookie, "x-forwarded-proto": "https" }
  });
  assert.equal(afterLogout.statusCode, 401);
});

test("trusted proxy mode refuses a non-loopback application exposure", async () => {
  const child = spawn(process.execPath, ["--no-warnings", "src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: "3000",
      DASHBOARD_PORT: "3000",
      CONTAINERIZED: "false",
      ADMIN_TRUST_PROXY: "true",
      ADMIN_AUTH_ENABLED: "false",
      BACKUP_INTERVAL_HOURS: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server did not reject unsafe proxy mode:\n${logs}`));
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.notEqual(exitCode, 0);
  assert.match(logs, /ADMIN_TRUST_PROXY requires HOST to be loopback/);
});

function jsonHeaders(host) {
  return {
    host,
    origin: `https://${host}`,
    "content-type": "application/json"
  };
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: options.method || "GET",
        path: options.path,
        headers: options.headers || {}
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        }));
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(port, child, readLogs) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${readLogs()}`);
    try {
      const response = await request(port, { path: "/api/health" });
      if (response.statusCode === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready:\n${readLogs()}`);
}
