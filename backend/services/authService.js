import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export class AuthService {
  #salt = randomBytes(16);
  #passwordHash;
  #usernameHash;
  #pendingChecks = 0;

  async initialize(username, password) {
    this.#usernameHash = this.#hashUsername(username);

    this.#passwordHash = await deriveKey(password, this.#salt, 64);
  }

  async verifyCredentials(username, password) {
    // Bound concurrent scrypt work to protect memory and the crypto worker pool.
    if (this.#pendingChecks >= 4) return null;

    this.#pendingChecks += 1;

    try {
      const candidate = await deriveKey(password, this.#salt, 64);

      const passwordMatches = timingSafeEqual(candidate, this.#passwordHash);
      const usernameMatches = timingSafeEqual(this.#hashUsername(username), this.#usernameHash);

      return passwordMatches && usernameMatches;
    } finally {
      this.#pendingChecks -= 1;
    }
  }

  #hashUsername(username) {
    return createHash('sha256').update(username).digest();
  }
}
