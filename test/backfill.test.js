const assert = require("node:assert/strict");
const test = require("node:test");
const { startBackfill } = require("../scripts/backfill");

test("backfill CLI starts the maintenance job without using public history reads", async () => {
  const requests = [];
  const result = await startBackfill({
    baseUrl: "http://localhost:3000", days: 90,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return { ok: true, status: 202, json: async () => ({ accepted: true, days: 90 }) };
    }
  });
  assert.equal(result.accepted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/api/admin/backfill");
  assert.equal(requests[0].url.searchParams.get("days"), "90");
  assert.equal(requests[0].options.method, "POST");
});

test("backfill CLI explains how to import history when login is required", async () => {
  await assert.rejects(startBackfill({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  }), /Sign in to Administration/);
});
