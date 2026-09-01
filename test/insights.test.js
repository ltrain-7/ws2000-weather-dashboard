const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../public/insights.js"), "utf8");

test("insight cards include high and low occurrence times", () => {
  const window = {};
  vm.runInNewContext(source, { window, Number, Object });
  const view = window.WeatherInsights.render({
    analytics: {
      current: {
        averageTempf: 75,
        maximumTempf: 88,
        maximumTempAt: "2026-09-01T18:15:00Z",
        minimumTempf: 61,
        minimumTempAt: "2026-09-01T10:05:00Z"
      },
      previous: {},
      rainfall: {}
    },
    historyDate: "",
    historyRangeDays: 1,
    normalizeHistory: (rows) => rows,
    history: [],
    comparisonHistory: []
  }, {
    formatDateOnly: (value) => value,
    formatSelectedDate: (value) => value,
    formatTime: (value) => value.endsWith("18:15:00Z") ? "Sep 1, 2:15 PM" : "Sep 1, 6:05 AM",
    formatUnitValue: (value, unit, digits) => `${Number(value).toFixed(digits ?? 1)}${unit}`,
    rangeLabel: (days) => `Last ${days} day`
  });
  assert.match(view.summaryHtml, /High temp.*88\.0°F.*Observed Sep 1, 2:15 PM/);
  assert.match(view.summaryHtml, /Low temp.*61\.0°F.*Observed Sep 1, 6:05 AM/);
});
