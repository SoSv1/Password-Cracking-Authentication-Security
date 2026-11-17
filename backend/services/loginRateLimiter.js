export class LoginRateLimiter {
  #attempts = new Map();
  #windowMs;
  #limit;

  constructor(config) {
    this.#windowMs = config.loginWindowMs;
    this.#limit = config.loginAttemptsPerWindow;
  }

  check(address) {
    const now = Date.now();

    // A bounded map prevents arbitrary client addresses from growing memory forever.
    for (const [key, entry] of this.#attempts) {
      if (entry.resetAt <= now) this.#attempts.delete(key);
    }

    const entry = this.#attempts.get(address) || { count: 0, resetAt: now + this.#windowMs };

    if (entry.count >= this.#limit || (!this.#attempts.has(address) && this.#attempts.size >= 10_000)) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }

    entry.count += 1;
    this.#attempts.set(address, entry);

    return 0;
  }
}
