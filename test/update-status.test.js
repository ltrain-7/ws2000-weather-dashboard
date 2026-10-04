const assert = require("node:assert/strict");
const test = require("node:test");
const { createUpdateStatus } = require("../src/update-status");
const release = (tag_name = "v1.10.0", extras = {}) => ({ ok: true, json: async () => ({ tag_name, draft: false, prerelease: false, ...extras }) });

test("stable release comparison uses numeric versions and preserves unknown builds", async () => {
  for (const [installedVersion, latest, state] of [
    ["1.9.2", "v1.10.0", "available"], ["1.10.0", "v1.9.2", "ahead"],
    ["1.9.2", "v1.9.2", "current"], ["1.10.0-dev", "v1.9.2", "unknown"]
  ]) {
    const service = createUpdateStatus({ installedVersion, fetchImpl: async () => release(latest) });
    const result = await service.check();
    assert.equal(result.state, state);
    assert.equal(result.latestVersion, latest);
    assert.ok(result.releaseUrl.startsWith("https://github.com/ltrain-7/ws2000-weather-dashboard/releases/tag/"));
  }
});

test("release requests coalesce and cache for an hour without sending station information", async () => {
  let timestamp = Date.now();
  let calls = 0;
  const service = createUpdateStatus({ installedVersion: "1.9.2", now: () => timestamp, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://api.github.com/repos/ltrain-7/ws2000-weather-dashboard/releases/latest");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
    return release();
  }});
  await Promise.all([service.check(), service.check(), service.check()]);
  await service.check();
  assert.equal(calls, 1);
  timestamp += 3600001;
  await service.check();
  assert.equal(calls, 2);
});

test("errors, rate limits and invalid releases never report up to date", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: false, status: 404 }),
    async () => release("v2.0.0-rc.1"),
    async () => release("v2.0.0", { prerelease: true }),
    async () => release("v2.0.0", { draft: true }),
    async () => release("../../malicious")
  ]) {
    const result = await createUpdateStatus({ installedVersion: "1.9.2", fetchImpl }).check();
    assert.equal(result.state, "unavailable");
    assert.equal(result.latestVersion, null);
  }
});

test("failed rechecks clear stale success and retry after one minute", async () => {
  let timestamp = Date.now();
  let calls = 0;
  const service = createUpdateStatus({ installedVersion: "1.9.2", now: () => timestamp, fetchImpl: async () => {
    calls++;
    if (calls === 2) throw new Error("offline");
    return release();
  }});
  assert.equal((await service.check()).state, "available");
  timestamp += 3600001;
  assert.equal((await service.check()).state, "unavailable");
  await service.check();
  assert.equal(calls, 2);
  timestamp += 60001;
  assert.equal((await service.check()).state, "available");
});
