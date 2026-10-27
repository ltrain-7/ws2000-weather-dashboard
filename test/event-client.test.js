const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { EventClient } = require("../src/event-client");

test("stalled event streams disconnect at backpressure instead of growing a queue", () => {
  const res = new PassThrough({ highWaterMark: 1024 });
  let removed = 0;
  const client = new EventClient(res, { onClose: () => { removed += 1; } });
  client.start({ current: true });
  for (let index = 0; index < 1000; index += 1) client.send("update", { value: "x".repeat(8192) });
  assert.equal(client.closed, true);
  assert.equal(res.destroyed, true);
  assert.ok(res.writableLength < 10_000);
  assert.equal(client.heartbeat, null);
  client.close();
  assert.equal(removed, 1);
});

test("initial-state backpressure cleans up without starting a heartbeat", () => {
  const res = new PassThrough({ highWaterMark: 1024 });
  let removed = false;
  const client = new EventClient(res, { onClose: () => { removed = true; } });
  client.start({ value: "x".repeat(8192) });
  assert.equal(removed, true);
  assert.equal(client.heartbeat, null);
  assert.equal(client.send("update", {}), false);
});

test("healthy consumers receive framed events and transport errors clean up timers", () => {
  const res = new PassThrough();
  const frames = [];
  res.on("data", (chunk) => frames.push(chunk.toString()));
  const client = new EventClient(res);
  client.start({ current: true });
  assert.equal(client.send("update", { temperature: 70 }), true);
  assert.match(frames.join(""), /event: state\ndata: \{"current":true\}\n\n/);
  assert.match(frames.join(""), /event: update\ndata: \{"temperature":70\}\n\n/);
  res.emit("error", new Error("peer disconnected"));
  assert.equal(client.closed, true);
  assert.equal(client.heartbeat, null);
});

test("heartbeat backpressure uses the same disconnect policy", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const res = new PassThrough({ highWaterMark: 256 });
  const client = new EventClient(res);
  client.start({});
  context.mock.timers.tick(25_000 * 100);
  assert.equal(client.closed, true);
  assert.equal(client.heartbeat, null);
  assert.ok(res.writableLength < 512);
});
