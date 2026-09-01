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
  assert.match(worker, /startsWith\("\/api\/admin"\)/);
  assert.match(worker, /startsWith\("\/api\/auth"\)/);
  assert.doesNotMatch(worker.split("\n")[1], /admin|login/);
  assert.match(dockerIgnore, /^certs$/m);
  assert.match(dockerIgnore, /^secrets$/m);
});

test("dashboard controls retain accessible interaction states", () => {
  const dashboard = read("public/index.html");
  const script = read("public/app.js");
  const styles = read("public/styles.css");

  assert.match(dashboard, /role="tablist" aria-label="Chart metric"/);
  assert.match(dashboard, /aria-pressed="true" data-range-days="0"/);
  assert.match(dashboard, /data-range-days="1">1D<\/button>/);
  assert.match(dashboard, /aria-describedby="chartSummary chartMessage"/);
  assert.match(dashboard, /id="chartDataTable"/);
  assert.match(script, /addEventListener\("keydown"/);
  assert.match(script, /setAttribute\("aria-selected"/);
  assert.match(script, /max-height: 900px/);
  assert.match(script, /shortDesktopConditionsOpen/);
  assert.match(script, /\["High temp", current\.maximumTempf/);
  assert.match(script, /\["Low temp", current\.minimumTempf/);
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
  assert.match(dashboard, new RegExp(`app\\.js\\?v=${version}`));
  assert.match(admin, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(admin, new RegExp(`admin\\.js\\?v=${version}`));
  assert.match(login, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(login, new RegExp(`login\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`ws2000-v${version}`));
  assert.match(worker, new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(worker, new RegExp(`app\\.js\\?v=${version}`));
  assert.doesNotMatch(worker, new RegExp(`(?:admin|login)\\.js\\?v=${version}`));
});
