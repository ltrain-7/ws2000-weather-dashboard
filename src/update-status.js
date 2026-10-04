const RELEASES_URL = "https://github.com/ltrain-7/ws2000-weather-dashboard/releases";
const API_URL = "https://api.github.com/repos/ltrain-7/ws2000-weather-dashboard/releases/latest";

// Check only stable numeric releases. Never infer ordering from a Git revision.
function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || "");
  return match ? match.slice(1).map(BigInt) : null;
}

function createUpdateStatus({ installedVersion, fetchImpl = fetch, now = Date.now }) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  async function check() {
    if (cached && now() < expiresAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchImpl(API_URL, {
          headers: { accept: "application/vnd.github+json", "user-agent": "ws2000-weather-dashboard" },
          signal: AbortSignal.timeout(5000),
          redirect: "error"
        });
        if (!response.ok) throw new Error("Release lookup failed");
        const release = await response.json();
        const latest = versionParts(release.tag_name);
        const installed = versionParts(installedVersion);
        if (!latest || release.draft || release.prerelease) throw new Error("Invalid stable release");
        const difference = installed ? latest.findIndex((part, index) => part !== installed[index]) : -1;
        const state = !installed ? "unknown" : difference < 0 ? "current"
          : latest[difference] > installed[difference] ? "available" : "ahead";
        cached = {
          state, installedVersion, latestVersion: release.tag_name,
          releaseUrl: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`,
          checkedAt: new Date(now()).toISOString()
        };
        expiresAt = now() + 60 * 60 * 1000;
      } catch {
        cached = { state: "unavailable", installedVersion, latestVersion: null,
          releaseUrl: RELEASES_URL, checkedAt: new Date(now()).toISOString() };
        expiresAt = now() + 60 * 1000;
      } finally {
        pending = null;
      }
      return cached;
    })();
    return pending;
  }
  return { check };
}
module.exports = { createUpdateStatus };
