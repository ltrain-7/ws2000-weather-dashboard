const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);
const DEFAULT_SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3, keyLength: 64 });
const HASH_PREFIX = "scrypt";

async function hashPassword(password, options = {}) {
  const value = String(password || "");
  if (value.length < 12) throw new Error("Administrator passwords must be at least 12 characters.");
  if (value.length > 256) throw new Error("Administrator passwords must be no more than 256 characters.");

  const params = validateScryptParams({ ...DEFAULT_SCRYPT, ...options });
  const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);
  const derived = await derive(value, salt, params);
  return [
    HASH_PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

async function verifyPassword(password, encodedHash) {
  let parsed;
  try {
    parsed = parsePasswordHash(encodedHash);
  } catch {
    return false;
  }

  const derived = await derive(String(password || ""), parsed.salt, parsed);
  return derived.length === parsed.derived.length && crypto.timingSafeEqual(derived, parsed.derived);
}

function parsePasswordHash(encodedHash) {
  const parts = String(encodedHash || "").trim().split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("ADMIN_PASSWORD_HASH is not a supported scrypt hash.");
  }

  const params = validateScryptParams({
    N: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
    keyLength: Buffer.from(parts[5], "base64url").length
  });
  const salt = Buffer.from(parts[4], "base64url");
  const derived = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || derived.length < 32) {
    throw new Error("ADMIN_PASSWORD_HASH has an invalid salt or derived key.");
  }
  return { ...params, salt, derived };
}

function validateScryptParams(params) {
  const N = Number(params.N);
  const r = Number(params.r);
  const p = Number(params.p);
  const keyLength = Number(params.keyLength);
  if (!Number.isInteger(N) || N < 16384 || N > 1048576 || (N & (N - 1)) !== 0) {
    throw new Error("Invalid scrypt cost parameter.");
  }
  if (!Number.isInteger(r) || r < 1 || r > 32) throw new Error("Invalid scrypt block size.");
  if (!Number.isInteger(p) || p < 1 || p > 16) throw new Error("Invalid scrypt parallelism.");
  if (!Number.isInteger(keyLength) || keyLength < 32 || keyLength > 128) {
    throw new Error("Invalid scrypt key length.");
  }
  return { N, r, p, keyLength };
}

async function derive(password, salt, params) {
  const estimatedMemory = 128 * params.N * params.r;
  const maxmem = Math.max(64 * 1024 * 1024, estimatedMemory + 16 * 1024 * 1024);
  return scryptAsync(password, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem
  });
}

class LoginLimiter {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this.maxAttempts = options.maxAttempts || 5;
    this.globalMaxAttempts = options.globalMaxAttempts || this.maxAttempts * 4;
    this.entries = new Map();
  }

  check(key) {
    const now = this.now();
    const local = this.current(String(key || "unknown"), now, this.maxAttempts);
    const global = this.current("__global__", now, this.globalMaxAttempts);
    const blockedUntil = Math.max(local.blockedUntil || 0, global.blockedUntil || 0);
    return {
      allowed: blockedUntil <= now,
      retryAfterSeconds: blockedUntil > now ? Math.max(1, Math.ceil((blockedUntil - now) / 1000)) : 0
    };
  }

  recordFailure(key) {
    const now = this.now();
    const local = this.increment(String(key || "unknown"), now, this.maxAttempts);
    this.increment("__global__", now, this.globalMaxAttempts);
    return {
      delayMs: Math.min(2000, local.count * 250),
      ...this.check(key)
    };
  }

  reset(key) {
    this.entries.delete(String(key || "unknown"));
  }

  current(key, now, maximum) {
    const existing = this.entries.get(key);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      const fresh = { count: 0, startedAt: now, blockedUntil: 0 };
      this.entries.set(key, fresh);
      return fresh;
    }
    if (existing.count >= maximum && existing.blockedUntil <= now) {
      existing.blockedUntil = existing.startedAt + this.windowMs;
    }
    return existing;
  }

  increment(key, now, maximum) {
    const entry = this.current(key, now, maximum);
    entry.count += 1;
    if (entry.count >= maximum) entry.blockedUntil = entry.startedAt + this.windowMs;
    return entry;
  }
}

class AdminAuth {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.username = String(options.username || "admin").trim() || "admin";
    this.passwordHash = String(options.passwordHash || "").trim();
    this.sessionTtlMs = options.sessionTtlMs || 8 * 60 * 60 * 1000;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.verify = options.verifyPassword || verifyPassword;
    this.sessions = new Map();
    this.limiter = options.limiter || new LoginLimiter({ now: this.now });

    if (this.enabled) parsePasswordHash(this.passwordHash);
  }

  async authenticate(username, password, clientKey) {
    if (!this.enabled) return { ok: false, reason: "disabled" };
    const limit = this.limiter.check(clientKey);
    if (!limit.allowed) return { ok: false, reason: "rate-limited", ...limit };

    const [usernameMatches, passwordMatches] = await Promise.all([
      Promise.resolve(safeStringEqual(String(username || ""), this.username)),
      this.verify(String(password || ""), this.passwordHash)
    ]);
    if (!usernameMatches || !passwordMatches) {
      const failure = this.limiter.recordFailure(clientKey);
      return { ok: false, reason: "invalid", ...failure };
    }

    this.limiter.reset(clientKey);
    const token = this.randomBytes(32).toString("base64url");
    const csrfToken = this.randomBytes(32).toString("base64url");
    const now = this.now();
    const session = {
      username: this.username,
      csrfToken,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    };
    this.sessions.set(hashToken(token), session);
    return { ok: true, token, session };
  }

  getSession(token) {
    if (!this.enabled || !token) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return session;
  }

  destroySession(token) {
    if (token) this.sessions.delete(hashToken(token));
  }

  clearSessions() {
    this.sessions.clear();
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

function safeStringEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(left).digest();
  const rightDigest = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

module.exports = {
  AdminAuth,
  DEFAULT_SCRYPT,
  LoginLimiter,
  hashPassword,
  parsePasswordHash,
  verifyPassword
};
