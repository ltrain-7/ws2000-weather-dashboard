const adminGrid = document.getElementById("adminGrid");
const adminMessage = document.getElementById("adminMessage");
const refreshAdmin = document.getElementById("refreshAdmin");
const integrityBtn = document.getElementById("integrityBtn");
const backupBtn = document.getElementById("backupBtn");
const backfillBtn = document.getElementById("backfillBtn");
const backfillDays = document.getElementById("backfillDays");
let statusTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindActions();
  loadStatus();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
});

function bindActions() {
  refreshAdmin.addEventListener("click", () => loadStatus());
  integrityBtn.addEventListener("click", () => runAction("/api/admin/integrity", "Database integrity check"));
  backupBtn.addEventListener("click", () => runAction("/api/admin/backup", "Backup"));
  backfillBtn.addEventListener("click", () => {
    const days = Math.min(365, Math.max(1, Number(backfillDays.value) || 90));
    runAction(`/api/admin/backfill?days=${days}`, `${days}-day backfill`);
  });
}

async function loadStatus(preserveMessage = false) {
  setBusy(refreshAdmin, true);
  try {
    const status = await fetchJson("/api/admin");
    renderStatus(status);
    if (!preserveMessage) adminMessage.textContent = "Status refreshed.";
    clearTimeout(statusTimer);
    if (status.backfill?.running) statusTimer = setTimeout(() => loadStatus(true), 5000);
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    setBusy(refreshAdmin, false);
  }
}

async function runAction(url, label) {
  const button = url.includes("integrity") ? integrityBtn : url.includes("backup") ? backupBtn : backfillBtn;
  setBusy(button, true);
  try {
    const result = await fetchJson(url, { method: "POST" });
    adminMessage.textContent = `${label}: ${JSON.stringify(result, null, 2)}`;
    await loadStatus(true);
  } catch (error) {
    adminMessage.textContent = `${label} failed: ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function renderStatus(status) {
  const app = status.application || {};
  const storage = status.storage || {};
  const backups = status.backups || {};
  const health = status.stationHealth?.[0];
  const backfill = status.backfill || {};
  const cards = [
    ["Version", app.version || "--", `Node ${app.nodeVersion || "--"}`],
    ["Uptime", duration(app.uptimeSeconds), `Started ${formatDate(app.startedAt)}`],
    ["Station", health?.status || "No reading", health ? `${health.ageMinutes} minutes old` : "Waiting for data"],
    ["Realtime", status.connections?.realtime?.status || "--", status.connections?.realtime?.message || ""],
    ["Stored readings", number(storage.readingCount), `${formatDate(storage.firstReadingAt)} to ${formatDate(storage.latestReadingAt)}`],
    ["Database", bytes(storage.databaseBytes), storage.integrity?.ok ? "Integrity OK" : `Integrity: ${storage.integrity?.result || "unknown"}`],
    ["Backups", number(backups.files?.length), backups.enabled ? `Every ${backups.intervalHours} hours` : "Automatic backups disabled"],
    ["Latest backup", backups.files?.[0]?.filename || "None", backups.files?.[0] ? `${bytes(backups.files[0].bytes)} · ${formatDate(backups.files[0].createdAt)}` : "Create one now"],
    ["Backfill", backfill.running ? "Running" : "Idle", backfill.running ? `${backfill.pages} pages · oldest ${formatDate(backfill.oldestReadingAt)}` : backfill.completedAt ? `Completed ${formatDate(backfill.completedAt)}` : "Not run this session"]
  ];
  adminGrid.innerHTML = "";
  for (const [label, value, detail] of cards) {
    const panel = document.createElement("article");
    panel.className = "admin-panel";
    const labelNode = document.createElement("span");
    labelNode.className = "admin-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("div");
    valueNode.className = "admin-value";
    valueNode.textContent = value;
    const detailNode = document.createElement("small");
    detailNode.textContent = detail;
    panel.append(labelNode, valueNode, detailNode);
    adminGrid.append(panel);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { accept: "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  return data;
}

function setBusy(button, busy) { button.disabled = busy; }
function number(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "--"; }
function bytes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`;
  return `${(amount / 1024 / 1024).toFixed(1)} MB`;
}
function duration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "--";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((value % 3600) / 60)}m`;
}
function formatDate(value) { return value ? new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "--"; }
