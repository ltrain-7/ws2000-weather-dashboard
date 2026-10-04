const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const baseUrl = process.env.BROWSER_TEST_BASE_URL || "http://127.0.0.1:3100";
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const stationMac = "browser-test-station";
const now = Date.now();
const latest = {
  macAddress: stationMac,
  dateutc: now,
  tempf: 78,
  feelsLike: 79,
  humidity: 55,
  windspeedmph: 4,
  windgustmph: 8,
  baromrelin: 30.02,
  dailyrainin: 0.2,
  hourlyrainin: 0,
  tempinf: 72,
  humidityin: 48,
  solarradiation: 400,
  uv: 3,
  dewPoint: 61,
  battout: 1,
  winddir: 180
};

async function main() {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    await testDashboardInteractions(browser);
    await testOfflineShell(browser);
    await testUpdateStatus(browser);
    console.log("Browser interaction and offline-shell checks passed.");
  } finally {
    await browser.close();
  }
}

async function testDashboardInteractions(browser) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  let lastHistoryRequest = null;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return json(route, {
        configured: true,
        historyLimit: 96,
        historyMaxPoints: 480,
        stationTimezone: "America/New_York",
        forecastEnabled: true
      });
    }
    if (url.pathname === "/api/latest") {
      return json(route, {
        configured: true,
        targetMac: stationMac,
        devices: [{ macAddress: stationMac, info: { name: "Browser Test Station" }, lastData: latest }],
        latest: [latest],
        stationHealth: [{ macAddress: stationMac, status: "online", batteryLow: false }],
        realtime: { status: "live" },
        rest: { status: "ok" }
      });
    }
    if (url.pathname === "/api/forecast") {
      return json(route, {
        enabled: true,
        available: true,
        locationName: "Browser Test Station",
        updatedAt: new Date(now).toISOString(),
        days: [
          { date: "2026-09-03", weatherCode: 2, highF: 78, lowF: 61, precipitationProbability: 42, maximumGustMph: 12 },
          { date: "2026-09-04", weatherCode: 61, highF: 74, lowF: 58, precipitationProbability: 60, maximumGustMph: 18 }
        ]
      });
    }
    if (url.pathname === "/api/history") {
      lastHistoryRequest = url;
      return json(route, {
        data: [
          { ...latest, dateutc: now - 60 * 60 * 1000, tempf: 72 },
          { ...latest, dateutc: now, tempf: 78 }
        ]
      });
    }
    if (url.pathname === "/api/analytics") {
      return json(route, {
        timezone: "America/New_York",
        coverage: {
          readingCount: 12000,
          firstReadingAt: new Date(now - 44.5 * 86400000).toISOString(),
          latestReadingAt: new Date(now).toISOString()
        },
        current: {
          averageTempf: 75,
          minimumTempf: 61,
          maximumTempf: 88,
          minimumTempAt: new Date(now - 18 * 60 * 60 * 1000).toISOString(),
          maximumTempAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
          averageHumidity: 55,
          maximumGustMph: 12,
          rainfallTotalIn: 0.2
        },
        previous: {
          averageTempf: 73,
          minimumTempf: 59,
          maximumTempf: 85,
          averageHumidity: 58,
          maximumGustMph: 10,
          rainfallTotalIn: 0.1
        },
        rainfall: {}
      });
    }
    if (url.pathname === "/api/events") return route.abort();
    return json(route, {});
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Browser Test Station", exact: true }).waitFor();
  assert.match(await page.locator("#forecastGrid").innerText(), /Today[\s\S]*Partly cloudy[\s\S]*78° \/ 61°[\s\S]*42% rain/);
  await page.getByRole("button", { name: "1D", exact: true }).click();
  await page.getByRole("heading", { name: "Last 1 day", exact: true }).waitFor();

  const summary = await page.locator("#summaryGrid").innerText();
  assert.match(summary, /High temp\s*88(?:\.0)?°F/i);
  assert.match(summary, /Low temp\s*61(?:\.0)?°F/i);
  assert.match(summary, /Observed\s+[A-Z][a-z]{2}\s+\d{1,2}/);
  assert.ok(lastHistoryRequest, "The 1D control should request stored history.");
  assert.equal(
    Date.parse(lastHistoryRequest.searchParams.get("endDate")) - Date.parse(lastHistoryRequest.searchParams.get("startDate")),
    86400000
  );

  for (const days of [7, 30, 90]) {
    await page.getByRole("button", { name: `${days}D`, exact: true }).click();
    await page.getByRole("heading", { name: new RegExp(`^Last ${days} days`) }).waitFor();
  }

  await page.getByRole("button", { name: "180D", exact: true }).click();
  await page.getByRole("heading", { name: /^Last 180 days/ }).waitFor();
  assert.match(await page.locator("#historyCoverage").innerText(), /Partial range: \d+ of 180 days available/);

  await page.locator("#historyOptions > summary").click();
  await page.locator("#historyDate").fill("2026-03-08");
  await page.locator("#historyDate").press("Tab");
  await page.getByRole("heading", { name: /Mar 8, 2026/ }).waitFor();
  const selectedDuration = Date.parse(lastHistoryRequest.searchParams.get("endDate"))
    - Date.parse(lastHistoryRequest.searchParams.get("startDate")) + 1;
  assert.ok(
    Math.abs(selectedDuration - (23 * 60 * 60 * 1000)) <= 1,
    "DST transition days should use the station timezone."
  );

  const firstRow = await Promise.all(["Latest", "1D", "7D"].map(async (name) => {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    return box.y;
  }));
  const secondRow = await page.getByRole("button", { name: "30D", exact: true }).boundingBox();
  assert.ok(Math.max(...firstRow) - Math.min(...firstRow) < 2, "The first three mobile ranges should share a row.");
  assert.ok(secondRow.y > firstRow[0] + 20, "The remaining mobile ranges should use a second row.");

  await context.close();
}

async function testOfflineShell(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "domcontentloaded" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "1D", exact: true }).waitFor();
  await context.close();
}

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function testUpdateStatus(browser) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let state = "available";
  let checks = 0;
  await page.route("**/api/admin/updates", async (route) => {
    checks++;
    if (state === "network-error") return route.abort();
    return json(route, { state, installedVersion: "1.9.2", latestVersion: state === "unavailable" ? null : "v1.10.0", checkedAt: new Date().toISOString() });
  });
  await page.goto(`${baseUrl}/admin.html`);
  await page.getByText("Status refreshed.", { exact: true }).waitFor();
  assert.equal(checks, 0, "Opening Administration should not contact GitHub");
  for (const [next, label] of [
    ["available", "Update available"],
    ["current", "Version matches the latest stable release"],
    ["ahead", "Installed version is newer than the latest stable release"],
    ["unknown", "Installed version cannot be compared"],
    ["unavailable", "Could not check for updates. Try again in a minute."],
    ["network-error", "Could not check for updates. Check your connection and try again."]
  ]) {
    state = next;
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();
    await page.getByText(label, { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Check for updates", exact: true }).isEnabled(), true);
    const releaseUrl = await page.locator("#releaseLink").getAttribute("href");
    assert.equal(releaseUrl, `https://github.com/ltrain-7/ws2000-weather-dashboard/releases${["unavailable", "network-error"].includes(state) ? "" : "/tag/v1.10.0"}`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await context.close();
}
