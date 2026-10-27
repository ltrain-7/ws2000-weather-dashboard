// SSE connections are disposable: reconnecting gets a fresh state snapshot.
// Drop stalled consumers instead of retaining an unbounded per-client queue.
class EventClient {
  constructor(res, { address, onClose = () => {} } = {}) {
    this.res = res;
    this.address = address;
    this.onClose = onClose;
    this.closed = false;
    this.heartbeat = null;
    res.once("close", () => this.close());
    res.on("error", () => this.close());
  }

  start(state) {
    if (!this.write(": connected\n\n") || !this.send("state", state)) return;
    this.heartbeat = setInterval(() => this.write(": heartbeat\n\n"), 25000);
    this.heartbeat.unref?.();
  }

  send(event, payload) {
    if (this.closed) return false;
    return this.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  write(frame) {
    if (this.closed) return false;
    if (this.res.destroyed || this.res.writableEnded) {
      this.close();
      return false;
    }
    try {
      if (this.res.write(frame)) return true;
    } catch {
      // The same cleanup handles synchronous transport failures and backpressure.
    }
    this.close();
    return false;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.onClose(this);
    this.res.destroy();
  }
}

module.exports = { EventClient };
