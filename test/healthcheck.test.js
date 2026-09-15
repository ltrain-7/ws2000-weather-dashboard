const assert = require("node:assert/strict");
const test = require("node:test");
const { isHealthyResponse } = require("../scripts/healthcheck");

test("container health requires an available persistent store", () => {
  assert.equal(
    isHealthyResponse(200, JSON.stringify({ ok: true, storage: { enabled: true } })),
    true
  );
  assert.equal(
    isHealthyResponse(200, JSON.stringify({ ok: true, storage: { enabled: false } })),
    false
  );
  assert.equal(isHealthyResponse(503, JSON.stringify({ ok: true, storage: { enabled: true } })), false);
  assert.equal(isHealthyResponse(200, "not json"), false);
});
