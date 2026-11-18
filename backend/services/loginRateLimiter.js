import { isIP } from 'node:net';

export class LoginRateLimiter {
  #attempts = new Map();
  #windowMs;
  #limit;
  #maxClients;
  #direct;
  #trustedProxies;

  constructor(config) {
    this.#windowMs = config.loginWindowMs;
    this.#limit = config.loginAttemptsPerWindow;
    this.#maxClients = config.loginMaxClients;
    this.#direct = config.loginClientIpMode === 'direct';
    this.#trustedProxies = new Set(config.trustedProxyIps.map((address) => this.#normalize(address)));
  }

  check(request) {
    const address = this.#clientAddress(request);

    // Without verified client identity, the bounded auth admission/queue is the fallback.
    if (!address) return 0;

    const now = Date.now();

    // Fixed windows expire in insertion order. Cleanup work is capped per request.
    let removed = 0;
    for (const [key, entry] of this.#attempts) {
      if (entry.resetAt > now || removed >= 16) break;
      this.#attempts.delete(key);
      removed += 1;
    }

    let entry = this.#attempts.get(address);

    if (entry && entry.resetAt <= now) {
      this.#attempts.delete(address);
      entry = undefined;
    }

    if (entry && entry.count >= this.#limit) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }

    // A full tracking map must not deny new, unrelated clients. Auth work remains bounded.
    if (!entry && this.#attempts.size >= this.#maxClients) return 0;

    entry ??= { count: 0, resetAt: now + this.#windowMs };
    entry.count += 1;
    this.#attempts.set(address, entry);

    return 0;
  }

  #clientAddress(request) {
    const peer = this.#normalize(request.socket.remoteAddress);

    if (this.#trustedProxies.has(peer)) {
      // Opt in only after verifying this peer OVERWRITES XFF with ONE client IP.
      // Chains, ports, invalid values and missing headers fall back to bounded auth work.
      return this.#normalize(request.headers['x-forwarded-for']);
    }

    return this.#direct ? peer : null;
  }

  #normalize(address) {
    if (typeof address !== 'string' || address.includes('%') || !isIP(address)) return null;
    if (isIP(address) === 4) return address;

    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);

    if (!mapped) return canonical;

    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
}
