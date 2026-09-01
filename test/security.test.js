const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const parseUri = require("../vendor/parseuri");

const root = path.resolve(__dirname, "..");

test("Socket.IO 2 uses the bounded local URL parser", () => {
  const parsed = parseUri("https://rt2.ambientweather.net/socket.io/?api=1#realtime");
  assert.equal(parsed.protocol, "https");
  assert.equal(parsed.host, "rt2.ambientweather.net");
  assert.equal(parsed.path, "/socket.io/");
  assert.equal(parsed.query, "api=1");
  assert.equal(parsed.anchor, "realtime");
  assert.throws(() => parseUri(`https://example.test/${"a".repeat(8192)}`), /supported length/);

  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["vendor/parseuri"].version, "2.0.0");
  assert.equal(lock.packages["node_modules/parseuri"].resolved, "vendor/parseuri");
});
