"use strict";

const tlsEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.TLS_ENABLED || "").toLowerCase()
);
const transport = require(tlsEnabled ? "node:https" : "node:http");

const request = transport.get({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  path: "/api/health",
  rejectUnauthorized: false,
  timeout: 4000
}, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});

request.on("timeout", () => request.destroy(new Error("Health check timed out.")));
request.on("error", () => process.exit(1));
