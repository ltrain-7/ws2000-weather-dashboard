const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("offline navigation caches only the public dashboard and clears older caches", async () => {
  const handlers = {};
  const writes = [];
  const removed = [];
  const worker = fs.readFileSync(path.join(__dirname, "../public/service-worker.js"), "utf8");
  const cache = {
    addAll: async () => {},
    put: async (request) => { writes.push(new URL(request.url).pathname); },
    match: async () => null
  };
  const context = {
    self: {
      location: { origin: "https://weather.test" },
      clients: { claim: () => {} },
      skipWaiting: () => {},
      addEventListener: (name, handler) => { handlers[name] = handler; }
    },
    caches: {
      open: async () => cache,
      keys: async () => ["previous-version"],
      delete: async (name) => { removed.push(name); }
    },
    fetch: async () => ({ ok: true, clone() { return this; } }),
    URL, Response
  };
  vm.runInNewContext(worker, context);
  let activation;
  handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(removed, ["previous-version"]);

  for (const pathname of ["/admin.html", "/login.html", "/%61dmin.html", "/"]) {
    let response;
    const request = { method: "GET", mode: "navigate", url: `https://weather.test${pathname}` };
    handlers.fetch({ request, respondWith: promise => { response = promise; } });
    await response;
    await new Promise(setImmediate);
  }
  assert.deepEqual(writes, ["/"]);
});
