const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("late REST observations are persisted without rolling back live state", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8");
  const saved = [];
  const live = [];
  const broadcasted = [];
  const context = {
    latestByMac: new Map(), devicesByMac: new Map([["station", {}]]),
    sanitizeData: data => ({ ...data }), persistReading: data => saved.push(data),
    pushLiveHistory: (mac, data) => live.push(data),
    broadcast: (event, data) => broadcasted.push(data), publicState: () => ({}),
    upsertDevice: device => context.devicesByMac.set(device.macAddress, device)
  };
  vm.runInNewContext(source.slice(source.indexOf("function upsertData("), source.indexOf("function sanitizeDevice(")), context);
  context.upsertData({ macAddress: "station", dateutc: 2000, tempf: 75 }, "realtime", true);
  context.upsertData({ macAddress: "station", dateutc: 1000, tempf: 60,
    device: { macAddress: "station", lastData: { dateutc: 1000 } } }, "rest", true);
  assert.equal(context.latestByMac.get("station").tempf, 75);
  assert.equal(context.devicesByMac.get("station").lastData.tempf, 75);
  assert.equal(saved.length, 2);
  assert.equal(live.length, 1);
  assert.equal(broadcasted.length, 1);
  context.upsertData({ macAddress: "station", dateutc: 3000, tempf: 80 }, "rest", true);
  assert.equal(context.latestByMac.get("station").tempf, 80);
});
