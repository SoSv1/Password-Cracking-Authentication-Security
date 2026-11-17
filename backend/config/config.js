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
    this.loginWindowMs = 60_000;
    this.loginAttemptsPerWindow = 10;

    this.#validate();
    Object.freeze(this);
  }

  #validate() {
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
