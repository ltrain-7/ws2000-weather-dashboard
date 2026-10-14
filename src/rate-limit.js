class RequestRateLimiter {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.windowMs = options.windowMs || 60_000;
    this.maxRequests = options.maxRequests || 120;
    this.maxEntries = options.maxEntries || 1024;
    this.entries = new Map();
  }

  check(key) {
    const now = this.now();
    const normalizedKey = String(key || "unknown");
    let entry = this.entries.get(normalizedKey);
    if (!entry || now - entry.startedAt >= this.windowMs) {
      if (!entry && this.entries.size >= this.maxEntries) this.evict(now);
      entry = { count: 0, startedAt: now };
      this.entries.set(normalizedKey, entry);
    }

    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + this.windowMs - now) / 1000))
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - entry.count),
      retryAfterSeconds: 0
    };
  }

  sweep(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= this.windowMs) this.entries.delete(key);
    }
    return this.entries.size;
  }

  evict(now) {
    this.sweep(now);
    if (this.entries.size < this.maxEntries) return;
    const oldestKey = this.entries.keys().next().value;
    if (oldestKey !== undefined) this.entries.delete(oldestKey);
  }
}

module.exports = { RequestRateLimiter };
