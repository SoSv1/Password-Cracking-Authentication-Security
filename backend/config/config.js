import { isIP } from 'node:net';

export class Config {
  constructor(environment = process.env) {
    this.isProduction = environment.NODE_ENV === 'production';
    this.host = environment.HOST || '127.0.0.1';
    this.port = Number(environment.PORT || 3000);
    this.frontendOrigin = environment.FRONTEND_ORIGIN || 'http://localhost:8080';

    this.jwtSigningKey = environment.JWT_SIGNING_KEY || '';
    this.adminUsername = environment.ADMIN_USERNAME ?? 'admin';
    this.adminPassword = environment.ADMIN_PASSWORD ?? 'BCIT12';
    this.adminSecret = environment.ADMIN_SECRET ?? 'defaultSecret';

    this.jwtLifetimeSeconds = 3 * 60 * 60;
    this.cookieName = this.isProduction ? '__Host-authToken' : 'authToken';
    this.cookieSameSite = environment.COOKIE_SAME_SITE || (this.isProduction ? 'None' : 'Lax');

    this.bodyLimitBytes = 1024;
    this.loginBodyTimeoutMs = this.#integer(environment, 'LOGIN_BODY_TIMEOUT_MS', 2000, 100, 3000);
    this.loginConcurrency = this.#integer(environment, 'LOGIN_CONCURRENCY', 4, 1, 4);
    this.loginQueueSize = this.#integer(environment, 'LOGIN_QUEUE_SIZE', 24, 0, 64);
    this.loginQueueWaitMs = this.#integer(environment, 'LOGIN_QUEUE_WAIT_MS', 1000, 50, 1500);
    this.loginWindowMs = this.#integer(environment, 'LOGIN_WINDOW_MS', 60_000, 1000, 300_000);
    this.loginAttemptsPerWindow = this.#integer(environment, 'LOGIN_ATTEMPTS_PER_WINDOW', 30, 1, 300);
    this.loginMaxClients = this.#integer(environment, 'LOGIN_MAX_CLIENTS', 4096, 1, 10_000);
    // Unknown hosting topology: shared socket addresses must not lock out all clients.
    this.loginClientIpMode = environment.LOGIN_CLIENT_IP_MODE || 'unknown';
    this.trustedProxyIps = Object.freeze((environment.TRUSTED_PROXY_IPS || '')
      .split(',').map((address) => address.trim()).filter(Boolean));

    this.#validate();
    Object.freeze(this);
  }

  #integer(environment, name, fallback, minimum, maximum) {
    const value = Number(environment[name] ?? fallback);

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }

    return value;
  }

  #validate() {
    if (!['unknown', 'direct'].includes(this.loginClientIpMode)
      || this.trustedProxyIps.some((address) => address.includes('%') || !isIP(address))) {
      throw new Error('Use LOGIN_CLIENT_IP_MODE=unknown|direct and exact IPs in TRUSTED_PROXY_IPS.');
    }

    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new Error('PORT must be an integer between 1 and 65535.');
    }

    const origin = new URL(this.frontendOrigin);

    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== this.frontendOrigin) {
      throw new Error('FRONTEND_ORIGIN must be an exact HTTP(S) origin without a trailing slash.');
    }

    if (this.isProduction && origin.protocol !== 'https:') {
      throw new Error('Production requires an HTTPS frontend origin.');
    }

    if (Buffer.byteLength(this.jwtSigningKey) < 32 || this.jwtSigningKey.startsWith('REPLACE_')) {
      throw new Error('Set JWT_SIGNING_KEY to a private random key of at least 32 bytes.');
    }

    if (!this.adminUsername || this.adminUsername.length > 64) {
      throw new Error('ADMIN_USERNAME must contain 1 to 64 characters.');
    }

    if (!this.adminPassword || [...this.adminPassword].length > 6) {
      throw new Error('ADMIN_PASSWORD must contain 1 to 6 characters.');
    }

    if (!this.adminSecret || [...this.adminSecret].length >= 20 || /\s/u.test(this.adminSecret)) {
      throw new Error('ADMIN_SECRET must contain 1 to 19 characters without whitespace.');
    }

    if (!['Lax', 'Strict', 'None'].includes(this.cookieSameSite)) {
      throw new Error('COOKIE_SAME_SITE must be Lax, Strict, or None.');
    }

    if (this.cookieSameSite === 'None' && !this.isProduction) {
      throw new Error('SameSite=None requires Secure cookies; use production HTTPS or local Lax.');
    }
  }
}
