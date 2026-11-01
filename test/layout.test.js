const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "public", "layout.js"), "utf8"),
  context
);
const layout = context.window.WeatherDashboardLayout;

test("dashboard layout keeps known modules and appends newly registered modules", () => {
  const normalized = layout.normalizeLayout(
    { order: ["history", "missing", "history", "current"], hidden: ["forecast", "missing"] },
    ["current", "conditions", "forecast", "history"]
  );
  assert.deepEqual(Array.from(normalized.order), ["history", "current", "conditions", "forecast"]);
  assert.deepEqual(Array.from(normalized.hidden), ["forecast"]);
});

test("dashboard layout moves modules and always keeps one visible", () => {
  const initial = { order: ["current", "forecast", "history"], hidden: ["current", "forecast"] };
  const moved = layout.moveModule(initial, "history", -1);
  assert.deepEqual(Array.from(moved.order), ["current", "history", "forecast"]);
  const attemptedHide = layout.setModuleHidden(moved, "history", true);
  assert.deepEqual(Array.from(attemptedHide.hidden), ["current", "forecast"]);
  const restored = layout.setModuleHidden(attemptedHide, "current", false);
  assert.deepEqual(Array.from(restored.hidden), ["forecast"]);
});
