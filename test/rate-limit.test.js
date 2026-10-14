const assert = require("node:assert/strict");
const test = require("node:test");
const { RequestRateLimiter } = require("../src/rate-limit");

test("public query limiter isolates clients and resets after its window", () => {
  let now = 1_000;
  const limiter = new RequestRateLimiter({
    now: () => now,
    maxRequests: 2,
    windowMs: 60_000,
    maxEntries: 2
  });

  assert.equal(limiter.check("client-a").allowed, true);
  assert.equal(limiter.check("client-a").allowed, true);
  const blocked = limiter.check("client-a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(limiter.check("client-b").allowed, true);

  now += 60_001;
  assert.equal(limiter.check("client-a").allowed, true);
  assert.equal(limiter.sweep(), 1);
});

test("public query limiter bounds retained client entries", () => {
  const limiter = new RequestRateLimiter({ maxRequests: 1, maxEntries: 2 });
  limiter.check("client-a");
  limiter.check("client-b");
  limiter.check("client-c");
  assert.equal(limiter.entries.size, 2);
  assert.equal(limiter.entries.has("client-a"), false);
});
