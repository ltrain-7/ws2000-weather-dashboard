"use strict";

// Socket.IO 2 expects the shape produced by the abandoned parseuri package.
// URL parsing itself is delegated to Node's linear-time WHATWG implementation.
module.exports = function parseUri(input) {
  const source = String(input || "");
  if (source.length > 8192) throw new TypeError("URL exceeds the supported length");
  const parsed = new URL(source);
  const protocol = parsed.protocol.slice(0, -1);
  const path = parsed.pathname || "/";
  const slash = path.lastIndexOf("/");
  const user = decode(parsed.username);
  const password = decode(parsed.password);
  const userInfo = user ? `${user}${password ? `:${password}` : ""}` : "";

  return {
    source,
    protocol,
    authority: parsed.host,
    userInfo,
    user,
    password,
    host: parsed.hostname,
    port: parsed.port,
    relative: `${path}${parsed.search}${parsed.hash}`,
    path,
    directory: path.slice(0, slash + 1),
    file: path.slice(slash + 1),
    query: parsed.search.slice(1),
    anchor: parsed.hash.slice(1)
  };
};

function decode(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
