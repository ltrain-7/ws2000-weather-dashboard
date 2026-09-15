"use strict";

const tlsEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.TLS_ENABLED || "").toLowerCase()
);
const transport = require(tlsEnabled ? "node:https" : "node:http");

function isHealthyResponse(statusCode, body) {
  if (statusCode !== 200) return false;
  try {
    const payload = JSON.parse(body);
    return payload.ok === true && payload.storage?.enabled === true;
  } catch {
    return false;
  }
}

function runHealthcheck() {
  const request = transport.get({
    hostname: "127.0.0.1",
    port: Number(process.env.PORT || 3000),
    path: "/api/health",
    rejectUnauthorized: false,
    timeout: 4000
  }, (response) => {
    response.setEncoding("utf8");
    let body = "";
    response.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) request.destroy(new Error("Health response is too large."));
    });
    response.on("end", () => process.exit(isHealthyResponse(response.statusCode, body) ? 0 : 1));
  });

  request.on("timeout", () => request.destroy(new Error("Health check timed out.")));
  request.on("error", () => process.exit(1));
}

if (require.main === module) runHealthcheck();

module.exports = { isHealthyResponse };
