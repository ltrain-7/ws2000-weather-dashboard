const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

function createHttpResponder(options) {
  const publicDir = options.publicDir;
  const strictTransport = Boolean(options.strictTransport);

  function securityHeaders() {
    return {
      "content-security-policy": "default-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; base-uri 'none'",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-permitted-cross-domain-policies": "none",
      ...(strictTransport ? { "strict-transport-security": "max-age=31536000" } : {})
    };
  }

  function sendJson(res, statusCode, payload, headers = {}) {
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
      ...securityHeaders(),
      ...headers
    });
    res.end(JSON.stringify(payload));
  }

  function sendText(res, statusCode, text, headers = {}) {
    res.writeHead(statusCode, {
      "content-type": "text/plain; charset=utf-8",
      ...securityHeaders(),
      ...headers
    });
    res.end(text);
  }

  function redirect(res, location) {
    res.writeHead(302, {
      location,
      "cache-control": "no-store",
      ...securityHeaders()
    });
    res.end();
  }

  async function serveStatic(requestUrl, res) {
    const requestPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestPath);
    } catch {
      sendText(res, 400, "Bad request.");
      return;
    }

    const filePath = path.normalize(path.join(publicDir, decodedPath));
    const relativePath = path.relative(publicDir, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      sendText(res, 403, "Forbidden.");
      return;
    }

    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch {
      sendText(res, 404, "Not found.");
      return;
    }
    if (!stats.isFile()) {
      sendText(res, 404, "Not found.");
      return;
    }

    const contentType = MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream";
    const sensitiveAsset = ["/admin.html", "/admin.js", "/login.html", "/login.js"].includes(decodedPath);
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": sensitiveAsset ? "no-store" : "no-cache, must-revalidate",
      ...securityHeaders()
    });
    fs.createReadStream(filePath).pipe(res);
  }

  return { redirect, securityHeaders, sendJson, sendText, serveStatic };
}

module.exports = { createHttpResponder };
