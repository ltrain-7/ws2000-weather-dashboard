const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../public/history-time.js"), "utf8");

test("history time module honors daylight-saving station days", () => {
  const window = {};
  vm.runInNewContext(source, { window, Date, Intl, Number, Object });
  const range = window.WeatherHistoryTime.historyDateRange("2026-03-08", "America/New_York");
  assert.equal(range.start, "2026-03-08T05:00:00.000Z");
  assert.equal(range.end, "2026-03-09T03:59:59.999Z");
  assert.equal(Date.parse(range.end) - Date.parse(range.start) + 1, 23 * 60 * 60 * 1000);
});
