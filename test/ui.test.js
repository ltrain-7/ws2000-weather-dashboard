const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("dashboard keeps technical station fields in Administration", () => {
  const dashboard = read("public/index.html");
  const admin = read("public/admin.html");

  assert.doesNotMatch(dashboard, /adminRawTable|Raw station|MAC address/i);
  assert.match(admin, /Advanced station fields/);
  assert.match(admin, /id="adminRawTable"/);
});

test("administrator login is accessible and authenticated actions carry CSRF protection", () => {
  const dockerIgnore = read(".dockerignore");
  const login = read("public/login.html");
  const loginScript = read("public/login.js");
  const adminScript = read("public/admin.js");
  const worker = read("public/service-worker.js");

  assert.match(login, /autocomplete="username"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.match(loginScript, /\/api\/auth\/login/);
  assert.match(adminScript, /x-csrf-token/);
  assert.match(adminScript, /\/api\/auth\/logout/);
  assert.match(adminScript, /Container image/);
  assert.match(adminScript, /Last deployment/);
  assert.match(adminScript, /Deployment backup/);
  assert.match(worker, /startsWith\("\/api\/admin"\)/);
  assert.match(worker, /startsWith\("\/api\/auth"\)/);
  assert.doesNotMatch(worker.split("\n")[1], /admin|login/);
  assert.match(dockerIgnore, /^certs$/m);
  assert.match(dockerIgnore, /^secrets$/m);
});

test("dashboard controls retain accessible interaction states", () => {
  const dashboard = read("public/index.html");
  const script = read("public/app.js");
  const historyTime = read("public/history-time.js");
  const insights = read("public/insights.js");
  const forecast = read("public/forecast.js");
  const styles = read("public/styles.css");
  const worker = read("public/service-worker.js");

  assert.match(dashboard, /role="tablist" aria-label="Chart metric"/);
  assert.match(dashboard, /aria-pressed="true" data-range-days="0"/);
  assert.match(dashboard, /data-range-days="1">1D<\/button>/);
  assert.match(dashboard, /id="historyCoverage"/);
  assert.match(dashboard, /id="updateBanner"/);
  assert.match(dashboard, /aria-describedby="chartSummary chartMessage"/);
  assert.match(dashboard, /id="chartDataTable"/);
  assert.match(dashboard, /id="forecastSection"[^>]*aria-labelledby="forecastTitle"/);
  assert.match(dashboard, /Weather data by Open-Meteo/);
  assert.match(forecast, /accessibleLabel/);
  assert.match(script, /addEventListener\("keydown"/);
  assert.match(script, /setAttribute\("aria-selected"/);
  assert.match(script, /max-height: 900px/);
  assert.match(script, /shortDesktopConditionsOpen/);
  assert.match(insights, /\["High temp", current\.maximumTempf/);
  assert.match(insights, /\["Low temp", current\.minimumTempf/);
  assert.match(insights, /Observed/);
  assert.match(script, /updateViaCache: "none"/);
  assert.match(script, /Partial range:/);
  assert.match(historyTime, /zonedTimeToUtc/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /min-height:\s*180px/);
  assert.match(styles, /calc\(100vh - 680px\)/);
});

test("release version and service-worker assets stay synchronized", () => {
  const version = require(path.join(root, "package.json")).version;
  const dashboard = read("public/index.html");
  const admin = read("public/admin.html");
  const login = read("public/login.html");
  const worker = read("public/service-worker.js");

  assert.match(dashboard, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(dashboard, new RegExp(`history-time\\.js\\?v=${version}`));
  assert.match(dashboard, new RegExp(`insights\\.js\\?v=${version}`));
  assert.match(dashboard, new RegExp(`forecast\\.js\\?v=${version}`));
  assert.match(dashboard, new RegExp(`app\\.js\\?v=${version}`));
  assert.match(admin, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(admin, new RegExp(`admin\\.js\\?v=${version}`));
  assert.match(login, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(login, new RegExp(`login\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`ws2000-v${version}`));
  assert.match(worker, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(worker, new RegExp(`history-time\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`insights\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`forecast\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`app\\.js\\?v=${version}`));
  assert.doesNotMatch(worker, new RegExp(`(?:admin|login)\\.js\\?v=${version}`));
});

test("compose reports its configured image to Administration", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /APP_IMAGE:.*WS2000_IMAGE/);
});
