// A single paced lane stays below both Ambient limits, including when several
// callers share a user key. Pending duplicate URLs share the same operation.
function createAmbientRestClient({ fetchJson, now = Date.now, sleep = delay,
  intervalMs = 1100, maxPending = 8 } = {}) {
  const pending = new Map();
  const queue = [];
  let running = false;
  let nextStartAt = 0;
  let cooldownUntil = 0;

  function request(url) {
    const key = String(url);
    if (pending.has(key)) return pending.get(key);
    if (now() < cooldownUntil) return Promise.reject(throttled(cooldownUntil - now()));
    if (pending.size >= maxPending) return Promise.reject(throttled(intervalMs));
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    pending.set(key, promise);
    queue.push({ key, url, resolve, reject });
    void drain();
    return promise;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        try {
          const wait = Math.max(0, nextStartAt - now());
          if (wait) await sleep(wait);
          nextStartAt = now() + intervalMs;
          item.resolve(await fetchJson(item.url));
        } catch (error) {
          if (error.providerStatus === 429 || error.statusCode === 429) {
            cooldownUntil = now() + Math.max(30_000, Number(error.retryAfterMs) || 0);
            nextStartAt = Math.max(nextStartAt, cooldownUntil);
            for (const queued of queue.splice(0)) {
              pending.delete(queued.key);
              queued.reject(throttled(cooldownUntil - now()));
            }
          }
          item.reject(error);
        } finally {
          pending.delete(item.key);
        }
      }
    } finally {
      running = false;
    }
  }

  return { request };
}

function throttled(milliseconds) {
  const error = new Error("Ambient requests are temporarily busy. Try again later.");
  error.statusCode = 429;
  error.retryAfterMs = milliseconds;
  return error;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { createAmbientRestClient };
