import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export class AuthService {
  #salt = randomBytes(16);
  #passwordHash;
  #usernameHash;
  #activeChecks = 0;
  #queue = [];
  #concurrency;
  #queueSize;
  #queueWaitMs;

  constructor(config) {
    this.#concurrency = config.loginConcurrency;
    this.#queueSize = config.loginQueueSize;
    this.#queueWaitMs = config.loginQueueWaitMs;
  }

  async initialize(username, password) {
    this.#usernameHash = this.#hashUsername(username);

    this.#passwordHash = await deriveKey(password, this.#salt, 64);
  }

  async verifyCredentials(username, password, signal) {
    if (!await this.#acquire(signal)) return null;

    try {
      const candidate = await deriveKey(password, this.#salt, 64);

      const passwordMatches = timingSafeEqual(candidate, this.#passwordHash);
      const usernameMatches = timingSafeEqual(this.#hashUsername(username), this.#usernameHash);

      return passwordMatches && usernameMatches;
    } finally {
      // Hand the slot directly to the next waiter; active crypto is never overbooked.
      const next = this.#queue.shift();
      if (next) next.finish(true);
      else this.#activeChecks -= 1;
    }
  }

  #acquire(signal) {
    if (signal?.aborted) return Promise.resolve(false);

    if (this.#activeChecks < this.#concurrency) {
      this.#activeChecks += 1;
      return Promise.resolve(true);
    }

    if (this.#queue.length >= this.#queueSize) return Promise.resolve(false);

    return new Promise((resolve) => {
      const cancel = () => {
        const index = this.#queue.indexOf(entry);
        if (index !== -1) this.#queue.splice(index, 1);
        entry.finish(false);
      };
      const entry = {
        finish: (admitted) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          resolve(admitted);
        },
      };
      const timer = setTimeout(cancel, this.#queueWaitMs);
      signal?.addEventListener('abort', cancel, { once: true });
      this.#queue.push(entry);
    });
  }

  #hashUsername(username) {
    return createHash('sha256').update(username).digest();
  }
}
