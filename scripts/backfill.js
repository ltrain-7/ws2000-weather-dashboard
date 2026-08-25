const baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";
const requestedDays = clamp(Number(process.argv[2] || process.env.BACKFILL_DAYS || 90), 1, 365);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const latest = await fetchJson(`${baseUrl}/api/latest`);
const macAddress = latest.devices?.[0]?.macAddress || latest.latest?.[0]?.macAddress;
if (!macAddress) throw new Error("No weather station is available yet.");

const stats = await fetchJson(`${baseUrl}/api/storage`);
if (!stats.enabled) throw new Error(`SQLite storage is unavailable: ${stats.message}`);

const cutoff = Date.now() - requestedDays * 24 * 60 * 60 * 1000;
let oldest = stats.firstReadingAt ? Date.parse(stats.firstReadingAt) : Date.now();
let cursor = oldest - 1;
let pages = 0;

console.log(`Backfilling ${requestedDays} days to ${new Date(cutoff).toISOString()}.`);

while (oldest > cutoff) {
  const url = new URL("/api/history", baseUrl);
  url.searchParams.set("mac", macAddress);
  url.searchParams.set("limit", "288");
  url.searchParams.set("source", "ambient");
  url.searchParams.set("endDate", new Date(cursor).toISOString());

  let result;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      result = await fetchJson(url);
      break;
    } catch (error) {
      if (!error.message.includes("429") || attempt === 6) throw error;
      console.log("Ambient rate limit reached; cooling down for 10 seconds.");
      await sleep(10000);
    }
  }

  const timestamps = (result.data || [])
    .map((item) => Number(item.dateutc) || Date.parse(item.date || ""))
    .filter(Number.isFinite);
  if (!timestamps.length) break;

  const nextOldest = Math.min(...timestamps);
  if (nextOldest >= oldest) break;
  oldest = nextOldest;
  cursor = oldest - 1;
  pages += 1;

  if (pages % 10 === 0 || oldest <= cutoff) {
    console.log(`Fetched ${pages} pages; oldest reading is ${new Date(oldest).toISOString()}.`);
  }
  if (oldest > cutoff) await sleep(2200);
}

const finalStats = await fetchJson(`${baseUrl}/api/storage`);
console.log(`Stored ${finalStats.readingCount} readings from ${finalStats.firstReadingAt}.`);

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Unexpected response (${response.status}): ${body.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}
