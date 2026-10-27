async function startBackfill({ baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:3000",
  days = process.argv[2] || process.env.BACKFILL_DAYS || 90, fetchImpl = fetch } = {}) {
  const requestedDays = Math.min(365, Math.max(1, Number(days) || 90));
  const url = new URL("/api/admin/backfill", baseUrl);
  url.searchParams.set("days", String(requestedDays));
  const response = await fetchImpl(url, { method: "POST", headers: { accept: "application/json" } });
  const body = await response.json();
  if (response.status === 401) throw new Error("Sign in to Administration and start Backfill there when administrator authentication is enabled.");
  if (!response.ok) throw new Error(body.error || `Backfill request failed (${response.status}).`);
  return body;
}

if (require.main === module) {
  startBackfill().then((result) => {
    console.log(`Backfill accepted for ${result.days} days. Monitor progress in Administration.`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { startBackfill };
