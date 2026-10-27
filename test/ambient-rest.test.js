const assert = require("node:assert/strict");
const test = require("node:test");
const { createAmbientRestClient } = require("../src/ambient-rest");

test("Ambient requests coalesce and different operations share one paced lane", async () => {
  let clock = 10_000;
  let release;
  const calls = [];
  const client = createAmbientRestClient({
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchJson: (url) => {
      calls.push({ url: String(url), at: clock });
      if (calls.length === 1) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ ok: true });
    }
  });
  const first = client.request("https://fixture/devices?apiKey=one");
  const duplicates = Array.from({ length: 20 }, () => client.request("https://fixture/devices?apiKey=one"));
  assert.ok(duplicates.every((operation) => operation === first));
  const history = client.request("https://fixture/history?apiKey=one");
  const otherKey = client.request("https://fixture/devices?apiKey=two");
  assert.equal(calls.length, 1);
  release({ ok: true });
  await Promise.all([first, ...duplicates, history, otherKey]);
  assert.deepEqual(calls.map((call) => call.at), [10_000, 11_100, 12_200]);
});

test("Ambient pending requests are bounded, and capacity returns after completion", async () => {
  let clock = 1000;
  let release;
  let count = 0;
  const client = createAmbientRestClient({
    maxPending: 2, now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchJson: async () => {
      count += 1;
      if (count === 1) await new Promise((resolve) => { release = resolve; });
      return [];
    }
  });
  const first = client.request("first");
  const second = client.request("second");
  await assert.rejects(client.request("overflow"), (error) => error.statusCode === 429);
  release();
  await Promise.all([first, second]);
  await client.request("after");
  assert.equal(count, 3);
});

test("provider throttling rejects queued work and honors a shared retry interval", async () => {
  let clock = 1000;
  let reject;
  let count = 0;
  const client = createAmbientRestClient({
    now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; },
    fetchJson: async () => {
      count += 1;
      if (count === 1) await new Promise((resolve, fail) => { reject = fail; });
      return [];
    }
  });
  const first = client.request("first");
  const queued = client.request("queued");
  const results = Promise.allSettled([first, queued]);
  reject(Object.assign(new Error("rate limited"), { providerStatus: 429, retryAfterMs: 60_000 }));
  assert.ok((await results).every((result) => result.status === "rejected"));
  await assert.rejects(client.request("during-cooldown"), (error) => error.retryAfterMs === 60_000);
  assert.equal(count, 1);
  clock += 60_001;
  await client.request("after");
  assert.equal(count, 2);
});

test("an ordinary provider error does not strand the request queue", async () => {
  let clock = 1000;
  let count = 0;
  const client = createAmbientRestClient({
    now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; },
    fetchJson: async () => { if (++count === 1) throw new Error("offline"); return []; }
  });
  const results = await Promise.allSettled([client.request("first"), client.request("second")]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
});
